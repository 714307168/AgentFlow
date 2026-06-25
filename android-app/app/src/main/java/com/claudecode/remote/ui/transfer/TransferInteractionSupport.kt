package com.claudecode.remote.ui.transfer

import com.claudecode.remote.domain.TransferCenterItem
import kotlinx.coroutines.CancellationException

internal fun mergeUpdatedTransfer(
    transfers: List<TransferCenterItem>,
    updated: TransferCenterItem
): List<TransferCenterItem> = transfers.map { candidate ->
    if (candidate.id == updated.id) updated else candidate
}

internal fun resolveTransferActionMessage(
    error: Throwable?,
    fallback: String
): String {
    val message = error?.message?.trim().orEmpty()
    return when {
        error == null -> fallback
        error is CancellationException -> fallback
        message.contains("coroutine scope left the composition", ignoreCase = true) -> fallback
        message.isNotEmpty() -> message
        else -> fallback
    }
}
