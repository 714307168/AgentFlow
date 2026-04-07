package com.claudecode.remote.ui.transfer

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.claudecode.remote.R
import com.claudecode.remote.domain.TransferCenterItem
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScopedTransferSheet(
    title: String,
    subtitle: String,
    emptyMessage: String,
    transfers: List<TransferCenterItem>,
    isRefreshing: Boolean,
    busyTransferId: String?,
    onRefresh: () -> Unit,
    onDownloadTransfer: (TransferCenterItem) -> Unit,
    onOpenTransfer: (TransferCenterItem) -> Unit,
    onDismissRequest: () -> Unit
) {
    val context = LocalContext.current
    ModalBottomSheet(
        onDismissRequest = onDismissRequest,
        containerColor = MaterialTheme.colorScheme.surface
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleLarge
                    )
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Spacer(modifier = Modifier.width(12.dp))
                OutlinedButton(
                    onClick = onRefresh,
                    enabled = !isRefreshing
                ) {
                    Text(stringResource(R.string.action_refresh))
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TransferFactChip(
                    text = stringResource(R.string.settings_transfers_summary, transfers.size),
                    modifier = Modifier.weight(1f)
                )
                TransferFactChip(
                    text = stringResource(
                        R.string.chat_transfers_downloaded_summary,
                        transfers.count { it.downloaded }
                    ),
                    modifier = Modifier.weight(1f)
                )
            }

            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                if (isRefreshing && transfers.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(18.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = stringResource(R.string.settings_transfers_loading),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else if (transfers.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(18.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = emptyMessage,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 420.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(transfers, key = { it.id }) { item ->
                            Surface(
                                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.88f),
                                shape = RoundedCornerShape(16.dp),
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(14.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Text(
                                        text = item.fileName,
                                        style = MaterialTheme.typography.titleSmall,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Text(
                                        text = listOf(
                                            formatTransferFileSize(item.sizeBytes),
                                            item.mimeType,
                                            formatTransferTimestamp(item.createdAt)
                                        ).joinToString(" · "),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    Text(
                                        text = buildString {
                                            append(
                                                stringResource(
                                                    R.string.settings_transfers_sender_label,
                                                    buildTransferSenderLabel(item)
                                                )
                                            )
                                            append(" · ")
                                            append(
                                                stringResource(
                                                    R.string.settings_transfers_target_label,
                                                    buildTransferTargetLabel(
                                                        item = item,
                                                        allMobileLabel = context.getString(R.string.settings_transfers_target_all_mobile),
                                                        deviceLabel = context.getString(R.string.settings_transfers_target_device),
                                                        projectLabel = context.getString(R.string.settings_transfers_target_project),
                                                        workgroupLabel = context.getString(R.string.settings_transfers_target_workgroup)
                                                    )
                                                )
                                            )
                                        },
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    val scopeDetails = buildTransferScopeDetails(
                                        item = item,
                                        projectPrefix = context.getString(R.string.chat_transfers_project_prefix),
                                        workgroupPrefix = context.getString(R.string.chat_transfers_workgroup_prefix),
                                        expiresPrefix = context.getString(R.string.chat_transfers_expires_prefix),
                                        downloadedLabel = context.getString(R.string.settings_transfers_downloaded_flag),
                                        formatTimestamp = ::formatTransferTimestamp
                                    )
                                    if (scopeDetails.isNotEmpty()) {
                                        Text(
                                            text = scopeDetails.joinToString(" · "),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                    if (item.receipts.isNotEmpty()) {
                                        Text(
                                            text = stringResource(R.string.settings_transfers_receipts_title, item.receipts.size),
                                            style = MaterialTheme.typography.labelMedium,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                            item.receipts.forEach { receipt ->
                                                Surface(
                                                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.36f),
                                                    shape = RoundedCornerShape(12.dp),
                                                    modifier = Modifier.fillMaxWidth()
                                                ) {
                                                    Column(
                                                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                                                        verticalArrangement = Arrangement.spacedBy(2.dp)
                                                    ) {
                                                        Text(
                                                            text = buildString {
                                                                append(
                                                                    buildTransferReceiptTargetLabel(
                                                                        receipt = receipt,
                                                                        devicePrefix = context.getString(R.string.settings_transfers_receipt_device_prefix),
                                                                        agentPrefix = context.getString(R.string.settings_transfers_receipt_agent_prefix),
                                                                        unknownLabel = context.getString(R.string.settings_transfers_receipt_unknown)
                                                                    )
                                                                )
                                                                append(" · ")
                                                                append(
                                                                    receipt.status.ifBlank {
                                                                        context.getString(R.string.settings_transfers_receipt_unknown)
                                                                    }
                                                                )
                                                            },
                                                            style = MaterialTheme.typography.bodySmall
                                                        )
                                                        Text(
                                                            text = formatTransferTimestamp(receipt.createdAt),
                                                            style = MaterialTheme.typography.bodySmall,
                                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                                        )
                                                        if (!receipt.note.isNullOrBlank()) {
                                                            Text(
                                                                text = receipt.note,
                                                                style = MaterialTheme.typography.bodySmall,
                                                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                                            )
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    } else {
                                        Text(
                                            text = stringResource(R.string.settings_transfers_receipts_empty),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }

                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                                    ) {
                                        Button(
                                            onClick = { onDownloadTransfer(item) },
                                            enabled = busyTransferId == null,
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            Text(
                                                when {
                                                    busyTransferId == item.id -> stringResource(R.string.chat_downloading_attachment)
                                                    else -> stringResource(R.string.chat_download_attachment)
                                                }
                                            )
                                        }
                                        OutlinedButton(
                                            onClick = { onOpenTransfer(item) },
                                            enabled = item.downloaded,
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            Text(stringResource(R.string.chat_open_attachment))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TransferFactChip(text: String, modifier: Modifier = Modifier) {
    Surface(
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.72f),
        shape = RoundedCornerShape(999.dp),
        modifier = modifier
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
        )
    }
}

fun openTransferFile(context: Context, item: TransferCenterItem): Result<Unit> {
    return runCatching {
        val localUri = item.localUri?.takeIf { it.isNotBlank() }
            ?: throw IllegalStateException(context.getString(R.string.settings_transfers_open_failed))
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(Uri.parse(localUri), item.mimeType.ifBlank { "application/octet-stream" })
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
        } catch (error: ActivityNotFoundException) {
            throw IllegalStateException(context.getString(R.string.settings_transfers_open_failed), error)
        }
    }
}

fun resolveTransferLocalFile(context: Context, item: TransferCenterItem): File? {
    val localUri = item.localUri?.trim().orEmpty()
    if (localUri.isNotEmpty()) {
        val parsed = runCatching { Uri.parse(localUri) }.getOrNull()
        if (parsed?.scheme?.lowercase() == "file") {
            val filePath = parsed.path
            if (!filePath.isNullOrBlank()) {
                val file = File(filePath)
                if (file.exists() && file.isFile) {
                    return file
                }
            }
        }
    }

    val localPath = item.localPath?.trim().orEmpty()
    if (localPath.isNotEmpty()) {
        val file = File(localPath)
        if (file.exists() && file.isFile) {
            return file
        }
    }
    return null
}

fun resolveTransferContentUri(context: Context, item: TransferCenterItem): Uri? {
    val localUri = item.localUri?.trim().orEmpty()
    if (localUri.isNotEmpty()) {
        val parsed = runCatching { Uri.parse(localUri) }.getOrNull()
        when (parsed?.scheme?.lowercase()) {
            "content" -> return parsed
            "file" -> {
                val file = resolveTransferLocalFile(context, item)
                if (file != null) {
                    return FileProvider.getUriForFile(
                        context,
                        "${context.packageName}.fileprovider",
                        file
                    )
                }
            }
        }
    }

    val file = resolveTransferLocalFile(context, item) ?: return null
    return FileProvider.getUriForFile(
        context,
        "${context.packageName}.fileprovider",
        file
    )
}
