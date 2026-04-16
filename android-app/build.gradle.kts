import java.io.File

plugins {
    id("com.android.application") version "8.2.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.22" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "1.9.22" apply false
}

val androidBuildRoot = System.getenv("AGENTFLOW_ANDROID_BUILD_DIR")?.let(::File)
    ?: rootProject.projectDir.toPath().root.toFile()
        .resolve("agentflow-android-build")
        .resolve(rootProject.name)

allprojects {
    val projectBuildDirName = if (path == ":") {
        "root"
    } else {
        path.removePrefix(":").replace(':', '-')
    }
    // Keep build outputs on an ASCII path so Windows unit-test workers can load classes reliably.
    layout.buildDirectory.set(androidBuildRoot.resolve(projectBuildDirName))
}
