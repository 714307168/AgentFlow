package com.claudecode.remote.ui.transfer

import com.claudecode.remote.domain.TransferCenterItem

internal fun mergeUpdatedTransfer(
    transfers: List<TransferCenterItem>,
    updated: TransferCenterItem
): List<TransferCenterItem> = transfers.map { candidate ->
    if (candidate.id == updated.id) updated else candidate
}

internal fun resolveTransferActionMessage(
    error: Throwable?,
    fallback: String
): String = error?.message?.trim()?.takeIf { it.isNotEmpty() } ?: fallback
