package com.claudecode.remote.update

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import kotlin.system.measureTimeMillis

internal data class GitHubDownloadCandidate(
    val id: String,
    val label: String,
    val url: String,
    val original: Boolean
)

internal data class GitHubDownloadProbeResult(
    val candidate: GitHubDownloadCandidate,
    val ok: Boolean,
    val elapsedMs: Long,
    val statusCode: Int? = null,
    val error: String? = null
)

internal class GitHubDownloadAccelerator(
    private val client: OkHttpClient,
    private val mirrorTemplates: List<String> = DEFAULT_GITHUB_DOWNLOAD_MIRROR_TEMPLATES,
    private val probeRequestFactory: (GitHubDownloadCandidate) -> Request = ::defaultProbeRequest
) {
    suspend fun selectFastest(originalUrl: String): GitHubDownloadCandidate = withContext(Dispatchers.IO) {
        val candidates = buildGitHubDownloadCandidates(originalUrl, mirrorTemplates)
        if (candidates.size <= 1 || !isGitHubReleaseDownloadUrl(originalUrl)) {
            return@withContext candidates.firstOrNull() ?: GitHubDownloadCandidate(
                id = "github",
                label = "GitHub",
                url = originalUrl,
                original = true
            )
        }

        val results = coroutineScope {
            candidates.map { candidate ->
                async { probe(candidate) }
            }.awaitAll()
        }
        results
            .filter { it.ok }
            .sortedWith(compareBy<GitHubDownloadProbeResult> { it.elapsedMs }.thenBy { if (it.candidate.original) 1 else 0 })
            .firstOrNull()
            ?.candidate
            ?: candidates.first()
    }

    private fun probe(candidate: GitHubDownloadCandidate): GitHubDownloadProbeResult {
        var statusCode: Int? = null
        var errorMessage: String? = null
        val elapsed = measureTimeMillis {
            try {
                client.newCall(probeRequestFactory(candidate)).execute().use { response ->
                    statusCode = response.code
                }
            } catch (error: Exception) {
                errorMessage = error.message ?: error::class.java.simpleName
            }
        }
        return GitHubDownloadProbeResult(
            candidate = candidate,
            ok = statusCode in 200..399,
            elapsedMs = elapsed,
            statusCode = statusCode,
            error = errorMessage
        )
    }
}

internal fun buildGitHubDownloadCandidates(
    originalUrl: String,
    mirrorTemplates: List<String> = DEFAULT_GITHUB_DOWNLOAD_MIRROR_TEMPLATES
): List<GitHubDownloadCandidate> {
    val normalizedOriginalUrl = originalUrl.trim()
    if (!isGitHubReleaseDownloadUrl(normalizedOriginalUrl)) {
        return listOf(
            GitHubDownloadCandidate(
                id = "github",
                label = "GitHub",
                url = normalizedOriginalUrl,
                original = true
            )
        )
    }

    val candidates = mutableListOf(
        GitHubDownloadCandidate(
            id = "github",
            label = "GitHub",
            url = normalizedOriginalUrl,
            original = true
        )
    )
    val seen = mutableSetOf(normalizedOriginalUrl)
    mirrorTemplates.forEach { template ->
        val mirrorUrl = applyGitHubDownloadMirrorTemplate(template, normalizedOriginalUrl) ?: return@forEach
        if (!seen.add(mirrorUrl)) {
            return@forEach
        }
        candidates += GitHubDownloadCandidate(
            id = URI(mirrorUrl).host?.lowercase().orEmpty().ifBlank { "mirror" },
            label = URI(mirrorUrl).host?.lowercase().orEmpty().ifBlank { "mirror" },
            url = mirrorUrl,
            original = false
        )
    }
    return candidates
}

internal fun isGitHubReleaseDownloadUrl(downloadUrl: String): Boolean {
    return runCatching {
        val uri = URI(downloadUrl)
        val host = uri.host?.lowercase().orEmpty()
        val path = uri.path.orEmpty()
        (host == "github.com" || host == "www.github.com") && path.contains("/releases/download/")
    }.getOrDefault(false)
}

private fun applyGitHubDownloadMirrorTemplate(template: String, originalUrl: String): String? {
    val normalizedTemplate = template.trim()
    if (normalizedTemplate.isBlank()) {
        return null
    }
    val encodedUrl = URLEncoder.encode(originalUrl, StandardCharsets.UTF_8.name())
    val mirrorUrl = if (normalizedTemplate.contains("{url}") || normalizedTemplate.contains("{encodedUrl}")) {
        normalizedTemplate
            .replace("{url}", originalUrl)
            .replace("{encodedUrl}", encodedUrl)
    } else {
        normalizedTemplate.trimEnd('/') + "/" + originalUrl
    }
    val uri = runCatching { URI(mirrorUrl) }.getOrNull() ?: return null
    return if (uri.scheme == "https" && !uri.host.isNullOrBlank()) {
        mirrorUrl
    } else {
        null
    }
}

private fun defaultProbeRequest(candidate: GitHubDownloadCandidate): Request =
    Request.Builder()
        .url(candidate.url)
        .head()
        .header("Accept", "application/octet-stream")
        .header("User-Agent", "AgentFlow-Android-Updater")
        .build()

private val DEFAULT_GITHUB_DOWNLOAD_MIRROR_TEMPLATES = listOf(
    "https://gh.llkk.cc/{url}",
    "https://gh-proxy.com/{url}",
    "https://ghproxy.net/{url}"
)
