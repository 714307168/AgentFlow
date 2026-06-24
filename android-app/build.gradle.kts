import java.io.File

plugins {
    id("com.android.application") version "8.2.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.22" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "1.9.22" apply false
}

fun String.containsNonAscii(): Boolean = any { it.code > 127 }

val androidBuildRoot = System.getenv("AGENTFLOW_ANDROID_BUILD_DIR")?.let(::File)
    ?: if (rootProject.projectDir.absolutePath.containsNonAscii()) {
        rootProject.projectDir.toPath().root.toFile()
            .resolve("agentflow-android-build")
            .resolve(rootProject.name)
    } else {
        rootProject.projectDir.resolve("build")
    }

allprojects {
    val projectBuildDirName = if (path == ":") {
        "root"
    } else {
        path.removePrefix(":").replace(':', '-')
    }
    // Keep build outputs on an ASCII path when the checkout path contains non-ASCII characters.
    layout.buildDirectory.set(androidBuildRoot.resolve(projectBuildDirName))
}
