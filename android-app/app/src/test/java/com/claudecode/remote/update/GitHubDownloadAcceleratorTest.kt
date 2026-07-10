package com.claudecode.remote.update

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URI
import java.util.concurrent.TimeUnit

class GitHubDownloadAcceleratorTest {
    @Test
    fun buildGitHubDownloadCandidatesAddsHttpsMirrorsForGitHubReleaseAssets() {
        val originalUrl = "https://github.com/714307168/AgentFlow/releases/download/v1.2.50/AgentFlow-android-1.2.50-134-release.apk"
        val candidates = buildGitHubDownloadCandidates(
            originalUrl,
            listOf(
                "https://fast.example/{url}",
                "http://unsafe.example/{url}",
                "https://encoded.example/download?target={encodedUrl}"
            )
        )

        assertEquals(
            listOf(
                originalUrl,
                "https://fast.example/https://github.com/714307168/AgentFlow/releases/download/v1.2.50/AgentFlow-android-1.2.50-134-release.apk",
                "https://encoded.example/download?target=https%3A%2F%2Fgithub.com%2F714307168%2FAgentFlow%2Freleases%2Fdownload%2Fv1.2.50%2FAgentFlow-android-1.2.50-134-release.apk"
            ),
            candidates.map { it.url }
        )
    }

    @Test
    fun buildGitHubDownloadCandidatesDoesNotMirrorRelayDownloads() {
        val originalUrl = "https://relay.example/downloads/AgentFlow.apk"

        assertEquals(
            listOf(originalUrl),
            buildGitHubDownloadCandidates(
                originalUrl,
                listOf("https://fast.example/{url}")
            ).map { it.url }
        )
    }

    @Test
    fun isGitHubReleaseDownloadUrlOnlyAcceptsGitHubReleaseAssets() {
        assertTrue(isGitHubReleaseDownloadUrl("https://github.com/714307168/AgentFlow/releases/download/v1.2.50/app.apk"))
        assertFalse(isGitHubReleaseDownloadUrl("https://github.com/714307168/AgentFlow/archive/refs/tags/v1.2.50.zip"))
        assertFalse(isGitHubReleaseDownloadUrl("https://example.com/714307168/AgentFlow/releases/download/v1.2.50/app.apk"))
    }

    @Test
    fun selectFastestChoosesFastestHealthyMirror() = kotlinx.coroutines.runBlocking {
        val fastServer = MockWebServer()
        val slowServer = MockWebServer()
        val originalServer = MockWebServer()
        try {
            fastServer.enqueue(MockResponse().setResponseCode(200))
            slowServer.enqueue(MockResponse().setHeadersDelay(150, TimeUnit.MILLISECONDS).setResponseCode(200))
            originalServer.enqueue(MockResponse().setHeadersDelay(80, TimeUnit.MILLISECONDS).setResponseCode(200))
            fastServer.start()
            slowServer.start()
            originalServer.start()

            val originalUrl = "https://github.com/714307168/AgentFlow/releases/download/v1.2.50/app.apk"
            val accelerator = GitHubDownloadAccelerator(
                client = OkHttpClient.Builder()
                    .connectTimeout(1, TimeUnit.SECONDS)
                    .readTimeout(1, TimeUnit.SECONDS)
                    .callTimeout(1, TimeUnit.SECONDS)
                    .build(),
                mirrorTemplates = listOf(
                    "https://slow.example/{encodedUrl}",
                    "https://fast.example/{encodedUrl}"
                ),
                probeRequestFactory = { candidate ->
                    val probeUrl = when (URI(candidate.url).host) {
                        "slow.example" -> slowServer.url("/slow").toString()
                        "fast.example" -> fastServer.url("/fast").toString()
                        else -> originalServer.url("/original").toString()
                    }
                    Request.Builder().url(probeUrl).head().build()
                }
            )

            val selected = accelerator.selectFastest(originalUrl)

            assertEquals("fast.example", URI(selected.url).host)
        } finally {
            fastServer.shutdown()
            slowServer.shutdown()
            originalServer.shutdown()
        }
    }

    @Test
    fun selectFastestFallsBackToGitHubWhenEveryProbeFails() = kotlinx.coroutines.runBlocking {
        val originalUrl = "https://github.com/714307168/AgentFlow/releases/download/v1.2.50/app.apk"
        val accelerator = GitHubDownloadAccelerator(
            client = OkHttpClient(),
            mirrorTemplates = listOf("https://broken.example/{url}"),
            probeRequestFactory = { candidate ->
                Request.Builder().url(candidate.url).head().build()
            }
        )

        val selected = accelerator.selectFastest(originalUrl)

        assertEquals(originalUrl, selected.url)
        assertTrue(selected.original)
    }
}
