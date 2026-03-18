package com.claudecode.remote.util

import android.content.Context
import android.util.Log
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object CrashLogger {
    private const val TAG = "CrashLogger"
    private const val LOG_FILE_NAME = "crash.log"
    private const val MAX_LOG_SIZE = 1024 * 1024 // 1MB

    private var context: Context? = null
    private var defaultHandler: Thread.UncaughtExceptionHandler? = null

    fun init(appContext: Context) {
        context = appContext.applicationContext
        defaultHandler = Thread.getDefaultUncaughtExceptionHandler()

        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            logCrash(throwable, thread)
            defaultHandler?.uncaughtException(thread, throwable)
        }

        Log.d(TAG, "CrashLogger initialized")
    }

    fun logCrash(throwable: Throwable, thread: Thread? = null) {
        try {
            val logFile = getLogFile() ?: return

            val timestamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.getDefault()).format(Date())
            val threadName = thread?.name ?: Thread.currentThread().name

            val sw = StringWriter()
            val pw = PrintWriter(sw)
            throwable.printStackTrace(pw)
            val stackTrace = sw.toString()

            val logEntry = buildString {
                appendLine("=" .repeat(80))
                appendLine("CRASH REPORT - $timestamp")
                appendLine("Thread: $threadName")
                appendLine("Exception: ${throwable.javaClass.name}")
                appendLine("Message: ${throwable.message}")
                appendLine("-" .repeat(80))
                appendLine(stackTrace)
                appendLine("=" .repeat(80))
                appendLine()
            }

            // Rotate log if too large
            if (logFile.exists() && logFile.length() > MAX_LOG_SIZE) {
                val backupFile = File(logFile.parent, "$LOG_FILE_NAME.old")
                logFile.renameTo(backupFile)
            }

            logFile.appendText(logEntry)
            Log.e(TAG, "Crash logged to: ${logFile.absolutePath}")

        } catch (e: Exception) {
            Log.e(TAG, "Failed to log crash", e)
        }
    }

    fun logError(tag: String, message: String, throwable: Throwable? = null) {
        try {
            val logFile = getLogFile() ?: return

            val timestamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.getDefault()).format(Date())

            val logEntry = buildString {
                appendLine("[$timestamp] ERROR [$tag] $message")
                if (throwable != null) {
                    val sw = StringWriter()
                    val pw = PrintWriter(sw)
                    throwable.printStackTrace(pw)
                    appendLine(sw.toString())
                }
                appendLine()
            }

            logFile.appendText(logEntry)
            Log.e(tag, message, throwable)

        } catch (e: Exception) {
            Log.e(TAG, "Failed to log error", e)
        }
    }

    fun logInfo(tag: String, message: String) {
        try {
            val logFile = getLogFile() ?: return

            val timestamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.getDefault()).format(Date())
            val logEntry = "[$timestamp] INFO [$tag] $message\n"

            logFile.appendText(logEntry)
            Log.i(tag, message)

        } catch (e: Exception) {
            Log.e(TAG, "Failed to log info", e)
        }
    }

    fun getLogContent(): String {
        return try {
            val logFile = getLogFile()
            if (logFile?.exists() == true) {
                logFile.readText()
            } else {
                "No crash log found"
            }
        } catch (e: Exception) {
            "Error reading log: ${e.message}"
        }
    }

    fun clearLog() {
        try {
            getLogFile()?.delete()
            Log.d(TAG, "Log cleared")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to clear log", e)
        }
    }

    private fun getLogFile(): File? {
        val ctx = context ?: return null

        // Try external files dir first (accessible via file manager)
        val externalDir = ctx.getExternalFilesDir(null)
        if (externalDir != null) {
            return File(externalDir, LOG_FILE_NAME)
        }

        // Fallback to internal files dir
        return File(ctx.filesDir, LOG_FILE_NAME)
    }

    fun getLogFilePath(): String {
        return getLogFile()?.absolutePath ?: "Log file not available"
    }
}
