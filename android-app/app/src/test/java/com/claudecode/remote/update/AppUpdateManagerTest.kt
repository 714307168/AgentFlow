package com.claudecode.remote.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateManagerTest {
    @Test
    fun `selectBestAndroidReleaseAsset prefers the newest release apk`() {
        val selected = selectBestAndroidReleaseAsset(
            listOf(
                GitHubReleaseAsset(
                    name = "agentflow-android-AgentFlow-android-1.2.31-115-release.apk",
                    browserDownloadUrl = "https://example.test/old.apk",
                    size = 100L
                ),
                GitHubReleaseAsset(
                    name = "agentflow-android-AgentFlow-android-1.2.32-116-release.apk",
                    browserDownloadUrl = "https://example.test/new.apk",
                    size = 101L
                )
            )
        )

        assertEquals("agentflow-android-AgentFlow-android-1.2.32-116-release.apk", selected?.name)
    }

    @Test
    fun `selectBestAndroidReleaseAsset ignores unsigned and missing download apk assets`() {
        val selected = selectBestAndroidReleaseAsset(
            listOf(
                GitHubReleaseAsset(
                    name = "AgentFlow-android-1.2.99-999-unsigned.apk",
                    browserDownloadUrl = "https://example.test/unsigned.apk"
                ),
                GitHubReleaseAsset(
                    name = "AgentFlow-android-1.2.98-998-release.apk",
                    browserDownloadUrl = ""
                )
            )
        )

        assertNull(selected)
    }

    @Test
    fun `shouldAutoDownloadUpdate honors wifi only policy`() {
        assertFalse(
            shouldAutoDownloadUpdate(
                autoDownloadEnabled = false,
                wifiOnly = false,
                isWifiConnected = true
            )
        )
        assertFalse(
            shouldAutoDownloadUpdate(
                autoDownloadEnabled = true,
                wifiOnly = true,
                isWifiConnected = false
            )
        )
        assertTrue(
            shouldAutoDownloadUpdate(
                autoDownloadEnabled = true,
                wifiOnly = true,
                isWifiConnected = true
            )
        )
        assertTrue(
            shouldAutoDownloadUpdate(
                autoDownloadEnabled = true,
                wifiOnly = false,
                isWifiConnected = false
            )
        )
    }
}
