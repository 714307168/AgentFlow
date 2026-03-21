package com.claudecode.remote.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import com.claudecode.remote.BuildConfig
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.remote.RelayApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
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
    private val tokenStore: TokenStore,
    private val relayApiProvider: () -> RelayApi
) {
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.MINUTES)
        .build()

    private val _state = MutableStateFlow(AppUpdateState())
    val state: StateFlow<AppUpdateState> = _state.asStateFlow()

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
                message = if (manual) "Checking for updates..." else null
            )
        }

        return try {
            val response = relayApiProvider().checkForUpdate(
                platform = "android",
                channel = "stable",
                arch = "",
                version = BuildConfig.VERSION_NAME,
                build = BuildConfig.VERSION_CODE
            )

            if (!response.available || (response.downloadUrl ?: response.url).isNullOrBlank()) {
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
                        message = if (manual) "You already have the latest version." else null
                    )
                }
                state.value
            } else {
                _state.update {
                    it.copy(
                        status = AppUpdateStatus.AVAILABLE,
                        latestVersion = response.latestVersion,
                        notes = response.notes.orEmpty(),
                        mandatory = response.mandatory == true,
                        downloadUrl = response.downloadUrl ?: response.url,
                        sha256 = response.sha256,
                        filename = response.filename,
                        downloadedApkPath = null,
                        message = "Version ${response.latestVersion} is available."
                    )
                }
                if (tokenStore.isAutoUpdateDownloadEnabled()) {
                    downloadLatestUpdate()
                } else {
                    state.value
                }
            }
        } catch (error: Exception) {
            _state.update {
                it.copy(
                    status = AppUpdateStatus.ERROR,
                    message = error.message ?: "Update check failed."
                )
            }
            state.value
        }
    }

    suspend fun downloadLatestUpdate(): AppUpdateState = withContext(Dispatchers.IO) {
        val snapshot = state.value
        val downloadUrl = snapshot.downloadUrl
        if (downloadUrl.isNullOrBlank()) {
            _state.update {
                it.copy(
                    status = AppUpdateStatus.ERROR,
                    message = "No update is ready to download."
                )
            }
            return@withContext state.value
        }

        _state.update {
            it.copy(
                status = AppUpdateStatus.DOWNLOADING,
                message = "Downloading ${snapshot.latestVersion ?: "update"}..."
            )
        }

        try {
            val request = Request.Builder().url(downloadUrl).build()
            val targetDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.cacheDir
            if (!targetDir.exists()) {
                targetDir.mkdirs()
            }
            val fileName = snapshot.filename?.takeIf { it.isNotBlank() }
                ?: "ClaudeCodeRemote-${snapshot.latestVersion ?: BuildConfig.VERSION_NAME}.apk"
            val targetFile = File(targetDir, fileName)

            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IllegalStateException("Download failed with status ${response.code}")
                }

                val body = response.body ?: throw IllegalStateException("Empty update response body")
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
                        throw IllegalStateException("Downloaded APK failed SHA-256 verification.")
                    }
                }
            }

            _state.update {
                it.copy(
                    status = AppUpdateStatus.DOWNLOADED,
                    downloadedApkPath = targetFile.absolutePath,
                    message = "Version ${snapshot.latestVersion ?: ""} is ready to install."
                )
            }
        } catch (error: Exception) {
            _state.update {
                it.copy(
                    status = AppUpdateStatus.ERROR,
                    message = error.message ?: "Update download failed."
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
                    message = "Downloaded APK is missing."
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
                it.copy(message = "Enable \"Install unknown apps\" for this app, then tap install again.")
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
            it.copy(message = "Installer opened.")
        }
        return true
    }
}
