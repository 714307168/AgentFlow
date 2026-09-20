package com.claudecode.remote.ui.common

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

class BundledVoiceModelTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test
    fun realPackagedModelInstallsAndReopensWithoutNetwork() {
        // Gradle provides the same verified archive that mergeAssets places in the APK.
        val archive = File(checkNotNull(System.getProperty("agentflow.voice.archive")))
        assertTrue("The actual speech model must be included", archive.isFile)
        val root = temporary.newFolder()
        val installed = OfflineVoiceModelStore(root, archive::inputStream).installIfNeeded()
        assertTrue(File(installed, "am/final.mdl").length() > 1_000_000)
        assertTrue(File(installed, "graph/Gr.fst").length() > 1_000_000)
        val offlineOnly = OfflineVoiceModelStore(root, { error("Must not reopen or download on subsequent use") })
        assertEquals(installed, offlineOnly.installIfNeeded())
    }

    @Test
    fun speechActivityIsDiscoverableOnAndroid11AndLater() {
        val document = DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(File("src/main/AndroidManifest.xml"))
        val queries = document.getElementsByTagName("queries").item(0) as org.w3c.dom.Element
        val actions = queries.getElementsByTagName("action")
        assertTrue((0 until actions.length).any {
            (actions.item(it) as org.w3c.dom.Element).getAttribute("android:name") ==
                "android.speech.action.RECOGNIZE_SPEECH"
        })
    }
}
