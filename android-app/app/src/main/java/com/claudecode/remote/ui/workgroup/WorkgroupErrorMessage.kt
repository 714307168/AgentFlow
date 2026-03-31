package com.claudecode.remote.ui.workgroup

import android.content.Context
import com.claudecode.remote.R
import kotlinx.coroutines.TimeoutCancellationException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeoutException

fun Context.resolveWorkgroupErrorMessage(error: Throwable?, fallback: String): String {
    val message = error?.message?.trim().orEmpty()
    return when {
        error == null -> fallback
        error is TimeoutCancellationException ||
            error is TimeoutException ||
            error is SocketTimeoutException ||
            message.contains("Timed out waiting for", ignoreCase = true) ||
            message.contains("timeout", ignoreCase = true) ->
            getString(R.string.workgroups_error_timeout)
        message.isNotEmpty() -> message
        else -> fallback
    }
}
