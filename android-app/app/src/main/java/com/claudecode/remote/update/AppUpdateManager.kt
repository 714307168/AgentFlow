package com.claudecode.remote.update

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import com.claudecode.remote.BuildConfig
import com.claudecode.remote.R
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.remote.applyRelayApiHeaders
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

enum class AppUpdateStatus {
    IDLE,
    CHECKING,
    AVAILABLE,
    DOWNLOADING,
    DOWNLOADED,
    UP_TO_DATE,
    ERROR
}

data class AppUpdateState(
    val status: AppUpdateStatus = AppUpdateStatus.IDLE,
    val currentVersion: String = BuildConfig.VERSION_NAME,
    val latestVersion: String? = null,
    val notes: String = "",
    val mandatory: Boolean = false,
    val downloadUrl: String? = null,
    val sha256: String? = null,
    val filename: String? = null,
    val downloadedApkPath: String? = null,
    val message: String? = null
)

class AppUpdateManager(
    private val context: Context,
    private val tokenStore: TokenStore
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.MINUTES)
        .build()

    private val _state = MutableStateFlow(AppUpdateState())
    val state: StateFlow<AppUpdateState> = _state.asStateFlow()

    private fun text(resId: Int, vararg args: Any): String = context.getString(resId, *args)

    suspend fun maybeAutoCheck() {
        if (!tokenStore.isAutoUpdateCheckEnabled()) {
            return
        }
        checkForUpdates(manual = false)
    }

    suspend fun checkForUpdates(manual: Boolean): AppUpdateState {
        _state.update {
            it.copy(
                status = AppUpdateStatus.CHECKING,
                currentVersion = BuildConfig.VERSION_NAME,
                message = if (manual) text(R.string.update_message_checking_manual) else null
            )
        }

        return try {
            val update = checkGitHubReleaseForUpdate()

            if (update == null) {
                _state.update {
                    it.copy(
                        status = AppUpdateStatus.UP_TO_DATE,
                        latestVersion = null,
                        notes = "",
                        mandatory = false,
                        downloadUrl = null,
                        sha256 = null,
                        filename = null,
                        downloadedApkPath = null,
                        message = if (manual) text(R.string.settings_update_uptodate) else null
                    )
                }
                state.value
            } else {
                _state.update {
                    it.copy(
                        status = AppUpdateStatus.AVAILABLE,
                        latestVersion = update.latestVersion,
                        notes = update.notes,
                        mandatory = false,
                        downloadUrl = update.downloadUrl,
                        sha256 = update.sha256,
                        filename = update.filename,
                        downloadedApkPath = null,
                        message = text(
                            R.string.update_message_available,
                            update.latestVersion
                        )
                    )
                }
                if (shouldAutoDownloadUpdate(
                        autoDownloadEnabled = tokenStore.isAutoUpdateDownloadEnabled(),
                        wifiOnly = tokenStore.isAutoUpdateDownloadWifiOnly(),
                        isWifiConnected = isWifiConnected()
                    )
                ) {
                    downloadLatestUpdate()
                } else {
                    state.value
                }
            }
        } catch (error: Exception) {
            _state.update {
                it.copy(
                    status = AppUpdateStatus.ERROR,
                    message = error.message ?: text(R.string.update_error_check_failed)
                )
            }
            state.value
        }
    }

    private suspend fun checkGitHubReleaseForUpdate(): GitHubUpdateCandidate? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(GITHUB_RELEASE_API_URL)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "AgentFlow-Android-Updater")
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException(text(R.string.update_error_download_status, response.code))
            }
            val body = response.body?.string() ?: throw IllegalStateException(text(R.string.update_error_empty_body))
            val release = json.decodeFromString(GitHubReleaseResponse.serializer(), body)
            if (release.draft || release.prerelease) {
                return@withContext null
            }

            val asset = selectBestAndroidReleaseAsset(release.assets)
                ?: return@withContext null

            val latestVersion = extractAndroidAssetVersion(asset.name)
                ?: normalizeReleaseVersion(release.tagName ?: release.name)
                ?: return@withContext null
            if (!isNewerVersion(BuildConfig.VERSION_NAME, latestVersion)) {
                return@withContext null
            }

            GitHubUpdateCandidate(
                latestVersion = latestVersion,
                downloadUrl = asset.browserDownloadUrl,
                filename = asset.name,
                sha256 = parseGitHubAssetSha256(asset.digest),
                notes = release.body.orEmpty()
            )
        }
    }

    private fun normalizeReleaseVersion(raw: String?): String? {
        val value = raw?.trim()?.removePrefix("v")?.removePrefix("V").orEmpty()
        if (value.isBlank()) {
            return null
        }
        return Regex("\\d+(?:\\.\\d+){1,3}").find(value)?.value ?: value
    }

    private fun isNewerVersion(current: String, latest: String): Boolean {
        val currentParts = normalizeReleaseVersion(current)?.split(".")?.mapNotNull { it.toIntOrNull() }.orEmpty()
        val latestParts = normalizeReleaseVersion(latest)?.split(".")?.mapNotNull { it.toIntOrNull() }.orEmpty()
        val maxSize = maxOf(currentParts.size, latestParts.size)
        for (index in 0 until maxSize) {
            val left = currentParts.getOrElse(index) { 0 }
            val right = latestParts.getOrElse(index) { 0 }
            if (left != right) {
                return right > left
            }
        }
        return false
    }

    private fun parseGitHubAssetSha256(digest: String?): String? {
        val value = digest?.trim().orEmpty()
        val match = Regex("^sha256:([a-fA-F0-9]{64})$").find(value) ?: return null
        return match.groupValues[1].lowercase()
    }

    suspend fun downloadLatestUpdate(): AppUpdateState = withContext(Dispatchers.IO) {
        val snapshot = state.value
        val downloadUrl = snapshot.downloadUrl
        if (downloadUrl.isNullOrBlank()) {
            _state.update {
                it.copy(
                    status = AppUpdateStatus.ERROR,
                    message = text(R.string.update_error_no_download)
                )
            }
            return@withContext state.value
        }

        _state.update {
            it.copy(
                status = AppUpdateStatus.DOWNLOADING,
                message = text(
                    R.string.update_message_downloading,
                    snapshot.latestVersion ?: BuildConfig.VERSION_NAME
                )
            )
        }

        try {
            val requestBuilder = Request.Builder().url(downloadUrl)
            if (isGitHubDownloadUrl(downloadUrl)) {
                requestBuilder
                    .header("Accept", "application/octet-stream")
                    .header("User-Agent", "AgentFlow-Android-Updater")
            } else {
                requestBuilder.applyRelayApiHeaders()
            }
            val request = requestBuilder.build()
            val targetDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.cacheDir
            if (!targetDir.exists()) {
                targetDir.mkdirs()
            }
            clearOldUpdatePackages(targetDir)
            val fileName = snapshot.filename?.takeIf { it.isNotBlank() }
                ?: "AgentFlow-${snapshot.latestVersion ?: BuildConfig.VERSION_NAME}.apk"
            val targetFile = File(targetDir, fileName)

            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IllegalStateException(
                        text(R.string.update_error_download_status, response.code)
                    )
                }

                val body = response.body ?: throw IllegalStateException(text(R.string.update_error_empty_body))
                val digest = MessageDigest.getInstance("SHA-256")
                body.byteStream().use { input ->
                    FileOutputStream(targetFile).use { output ->
                        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                        while (true) {
                            val read = input.read(buffer)
                            if (read <= 0) {
                                break
                            }
                            output.write(buffer, 0, read)
                            digest.update(buffer, 0, read)
                        }
                    }
                }

                val expectedHash = snapshot.sha256?.trim()?.lowercase().orEmpty()
                if (expectedHash.isNotEmpty()) {
                    val actualHash = digest.digest().joinToString("") { byte -> "%02x".format(byte) }
                    if (actualHash.lowercase() != expectedHash) {
                        targetFile.delete()
                        throw IllegalStateException(text(R.string.update_error_sha_mismatch))
                    }
                }
            }

            _state.update {
                it.copy(
                    status = AppUpdateStatus.DOWNLOADED,
                    downloadedApkPath = targetFile.absolutePath,
                    message = text(
                        R.string.update_message_ready_install,
                        snapshot.latestVersion ?: BuildConfig.VERSION_NAME
                    )
                )
            }
        } catch (error: Exception) {
            _state.update {
                it.copy(
                    status = AppUpdateStatus.ERROR,
                    message = error.message ?: text(R.string.update_error_download_failed)
                )
            }
        }

        state.value
    }

    fun installDownloadedUpdate(): Boolean {
        val downloadedPath = state.value.downloadedApkPath ?: return false
        val targetFile = File(downloadedPath)
        if (!targetFile.exists()) {
            _state.update {
                it.copy(
                    status = AppUpdateStatus.ERROR,
                    message = text(R.string.update_error_missing_apk)
                )
            }
            return false
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !context.packageManager.canRequestPackageInstalls()
        ) {
            context.startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${context.packageName}")
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            _state.update {
                it.copy(message = text(R.string.update_message_enable_unknown_apps))
            }
            return false
        }

        val apkUri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            targetFile
        )
        context.startActivity(
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        )
        _state.update {
            it.copy(message = text(R.string.update_message_installer_opened))
        }
        return true
    }

    private fun isGitHubDownloadUrl(downloadUrl: String): Boolean = runCatching {
        val host = Uri.parse(downloadUrl).host?.lowercase().orEmpty()
        host == "github.com" || host.endsWith(".github.com") || host.endsWith(".githubusercontent.com")
    }.getOrDefault(false)

    private fun isWifiConnected(): Boolean {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return false
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }

    private fun clearOldUpdatePackages(targetDir: File) {
        val files = targetDir.listFiles() ?: return
        files.forEach { file ->
            try {
                if (file.isDirectory) {
                    file.deleteRecursively()
                } else {
                    file.delete()
                }
            } catch (_: Exception) {
                // Best-effort cleanup. Old cached packages should not block a new download.
            }
        }
    }
}

private const val GITHUB_RELEASE_API_URL = "https://api.github.com/repos/714307168/AgentFlow/releases/latest"

internal fun shouldAutoDownloadUpdate(
    autoDownloadEnabled: Boolean,
    wifiOnly: Boolean,
    isWifiConnected: Boolean
): Boolean = autoDownloadEnabled && (!wifiOnly || isWifiConnected)

internal fun selectBestAndroidReleaseAsset(assets: List<GitHubReleaseAsset>): GitHubReleaseAsset? =
    assets
        .filter { asset ->
            val name = asset.name.trim().lowercase()
            name.endsWith(".apk") && !name.contains("unsigned") && asset.browserDownloadUrl.isNotBlank()
        }
        .sortedWith(
            compareByDescending<GitHubReleaseAsset> { asset -> scoreAndroidAsset(asset.name) }
                .thenByDescending { asset -> versionSortValue(extractAndroidAssetVersion(asset.name)) }
                .thenByDescending { asset -> asset.size ?: 0L }
                .thenBy { asset -> asset.name.lowercase() }
        )
        .firstOrNull()

internal fun extractAndroidAssetVersion(name: String): String? =
    Regex("""(?i)(?:android|apk)[^0-9]*(\d+(?:\.\d+){1,3})""")
        .find(name)
        ?.groupValues
        ?.getOrNull(1)
        ?: Regex("""\d+(?:\.\d+){1,3}""").find(name)?.value

private fun scoreAndroidAsset(name: String): Int {
    val normalized = name.lowercase()
    return when {
        normalized.contains("release") -> 100
        normalized.endsWith(".apk") -> 50
        else -> 0
    }
}

private fun versionSortValue(version: String?): Long {
    val parts = version
        ?.split(".")
        ?.map { value -> value.toIntOrNull()?.coerceIn(0, 9999) ?: 0 }
        .orEmpty()
    var sortValue = 0L
    for (index in 0 until 4) {
        sortValue = sortValue * 10_000L + parts.getOrElse(index) { 0 }
    }
    return sortValue
}

private data class GitHubUpdateCandidate(
    val latestVersion: String,
    val downloadUrl: String,
    val filename: String,
    val sha256: String?,
    val notes: String
)

@Serializable
private data class GitHubReleaseResponse(
    val id: Long? = null,
    @SerialName("tag_name") val tagName: String? = null,
    val name: String? = null,
    val body: String? = null,
    val prerelease: Boolean = false,
    val draft: Boolean = false,
    val assets: List<GitHubReleaseAsset> = emptyList()
)

@Serializable
internal data class GitHubReleaseAsset(
    val name: String = "",
    @SerialName("browser_download_url") val browserDownloadUrl: String = "",
    val size: Long? = null,
    val digest: String? = null
)
