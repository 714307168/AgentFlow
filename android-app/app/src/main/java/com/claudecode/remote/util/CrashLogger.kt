package com.claudecode.remote.util

import android.content.Context
import android.util.Log
import com.claudecode.remote.data.local.TokenStore
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class CrashLogFileInfo(
    val name: String,
    val sizeBytes: Long,
    val modifiedAt: Long
)

object CrashLogger {
    private const val TAG = "CrashLogger"
    private const val LOG_DIRECTORY_NAME = "logs"
    private const val SESSION_LOG_PREFIX = "app"
    private const val CRASH_LOG_PREFIX = "crash"
    private const val MAX_SESSION_FILE_SIZE_BYTES = 256 * 1024L
    private const val MAX_LOG_FILE_COUNT = 20
    private const val MAX_LOG_AGE_MILLIS = 14L * 24L * 60L * 60L * 1000L

    private val lock = Any()
    private val timestampFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
    private val filenameFormat = SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.US)

    private var context: Context? = null
    private var tokenStore: TokenStore? = null
    private var defaultHandler: Thread.UncaughtExceptionHandler? = null
    private var sessionLogFileName: String? = null
    private var isInitialized = false

    fun init(appContext: Context, store: TokenStore) {
        synchronized(lock) {
            context = appContext.applicationContext
            tokenStore = store
            cleanupLogs()
            if (isInitialized) {
                return
            }

            defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
            Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
                logCrash(throwable, thread)
                defaultHandler?.uncaughtException(thread, throwable)
            }
            isInitialized = true
            Log.d(TAG, "CrashLogger initialized")
        }
    }

    fun logCrash(throwable: Throwable, thread: Thread? = null) {
        val threadName = thread?.name ?: Thread.currentThread().name
        Log.e(TAG, "Uncaught exception on thread $threadName", throwable)
        if (!shouldPersist()) {
            return
        }

        val stackTrace = throwable.stackTraceToStringCompat()
        val logEntry = buildString {
            appendLine(separator())
            appendLine("CRASH REPORT - ${timestampNow()}")
            appendLine("Thread: $threadName")
            appendLine("Exception: ${throwable.javaClass.name}")
            appendLine("Message: ${throwable.message.orEmpty()}")
            appendLine(separator('-'))
            appendLine(stackTrace)
            appendLine(separator())
            appendLine()
        }

        appendToLog(createLogFile(CRASH_LOG_PREFIX), logEntry)
    }

    fun logError(tag: String, message: String, throwable: Throwable? = null) {
        Log.e(tag, message, throwable)
        if (!shouldPersist()) {
            return
        }

        val logEntry = buildString {
            appendLine("[${timestampNow()}] ERROR [$tag] $message")
            if (throwable != null) {
                appendLine(throwable.stackTraceToStringCompat())
            }
            appendLine()
        }

        appendToLog(getSessionLogFile(), logEntry)
    }

    fun logInfo(tag: String, message: String) {
        Log.i(tag, message)
        if (!shouldPersist()) {
            return
        }

        appendToLog(
            getSessionLogFile(),
            "[${timestampNow()}] INFO [$tag] $message\n"
        )
    }

    fun listLogFiles(): List<CrashLogFileInfo> {
        cleanupLogs()
        val logDir = getLogDirectory() ?: return emptyList()
        return logDir
            .listFiles()
            ?.filter { it.isFile && it.extension.equals("log", ignoreCase = true) }
            ?.sortedByDescending { it.lastModified() }
            ?.map { file ->
                CrashLogFileInfo(
                    name = file.name,
                    sizeBytes = file.length(),
                    modifiedAt = file.lastModified()
                )
            }
            ?: emptyList()
    }

    fun readLogFile(fileName: String): String {
        val file = resolveLogFile(fileName) ?: return "Log file not found"
        return runCatching { file.readText() }
            .getOrElse { error -> "Error reading log: ${error.message}" }
    }

    fun clearAllLogs() {
        getLogDirectory()
            ?.listFiles()
            ?.forEach { file -> file.delete() }
        synchronized(lock) {
            sessionLogFileName = null
        }
    }

    fun getLogDirectoryPath(): String =
        getLogDirectory()?.absolutePath ?: "Log directory unavailable"

    private fun shouldPersist(): Boolean = tokenStore?.isCrashLogsEnabled() != false

    private fun appendToLog(file: File?, content: String) {
        if (file == null) {
            return
        }

        synchronized(lock) {
            runCatching {
                file.parentFile?.mkdirs()
                file.appendText(content)
                cleanupLogs()
            }.onFailure { error ->
                Log.e(TAG, "Failed to write log file", error)
            }
        }
    }

    private fun getSessionLogFile(): File? {
        val logDir = getLogDirectory() ?: return null
        synchronized(lock) {
            val currentFile = sessionLogFileName
                ?.let { File(logDir, it) }
                ?.takeIf { it.exists() }

            if (currentFile != null && currentFile.length() < MAX_SESSION_FILE_SIZE_BYTES) {
                return currentFile
            }

            val nextFile = File(logDir, buildLogFileName(SESSION_LOG_PREFIX))
            sessionLogFileName = nextFile.name
            return nextFile
        }
    }

    private fun createLogFile(prefix: String): File? {
        val logDir = getLogDirectory() ?: return null
        return File(logDir, buildLogFileName(prefix))
    }

    private fun resolveLogFile(fileName: String): File? {
        val sanitizedName = fileName.substringAfterLast('/').substringAfterLast('\\')
        if (sanitizedName.isBlank() || sanitizedName != fileName) {
            return null
        }
        val logDir = getLogDirectory() ?: return null
        val file = File(logDir, sanitizedName)
        return file.takeIf { it.exists() && it.isFile }
    }

    private fun getLogDirectory(): File? {
        val ctx = context ?: return null
        val root = ctx.getExternalFilesDir(null) ?: ctx.filesDir
        return File(root, LOG_DIRECTORY_NAME).apply { mkdirs() }
    }

    private fun cleanupLogs() {
        val logDir = getLogDirectory() ?: return
        val files = logDir
            .listFiles()
            ?.filter { it.isFile && it.extension.equals("log", ignoreCase = true) }
            ?.sortedByDescending { it.lastModified() }
            ?: return

        val cutoff = System.currentTimeMillis() - MAX_LOG_AGE_MILLIS
        files
            .filter { it.lastModified() < cutoff }
            .forEach { file ->
                file.delete()
                if (sessionLogFileName == file.name) {
                    sessionLogFileName = null
                }
            }

        files
            .filter { it.exists() }
            .drop(MAX_LOG_FILE_COUNT)
            .forEach { file ->
                file.delete()
                if (sessionLogFileName == file.name) {
                    sessionLogFileName = null
                }
            }
    }

    private fun buildLogFileName(prefix: String): String =
        "$prefix-${filenameFormat.format(Date())}.log"

    private fun timestampNow(): String = timestampFormat.format(Date())

    private fun separator(char: Char = '='): String = char.toString().repeat(80)

    private fun Throwable.stackTraceToStringCompat(): String {
        val stringWriter = StringWriter()
        PrintWriter(stringWriter).use { writer ->
            printStackTrace(writer)
        }
        return stringWriter.toString()
    }
}
