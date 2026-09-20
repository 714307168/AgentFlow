package com.claudecode.remote.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.claudecode.remote.R

internal enum class VoiceInputPhase { Preparing, Listening, Finishing }

@Composable
internal fun VoiceInputDialog(
    phase: VoiceInputPhase?,
    partialText: String,
    onCancel: () -> Unit,
    onFinish: () -> Unit
) {
    if (phase == null) return
    AlertDialog(
        onDismissRequest = onCancel,
        icon = {
            if (phase == VoiceInputPhase.Listening) {
                Icon(Icons.Default.Mic, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            } else {
                CircularProgressIndicator(modifier = Modifier.size(24.dp))
            }
        },
        title = {
            Text(stringResource(when (phase) {
                VoiceInputPhase.Preparing -> R.string.voice_input_preparing_title
                VoiceInputPhase.Listening -> R.string.voice_input_listening_title
                VoiceInputPhase.Finishing -> R.string.voice_input_finishing
            }))
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(if (phase == VoiceInputPhase.Preparing) {
                    R.string.voice_input_offline_preparing
                } else {
                    R.string.voice_input_listening_hint
                }))
                if (partialText.isNotBlank()) Text(partialText)
            }
        },
        confirmButton = {
            if (phase == VoiceInputPhase.Listening) {
                TextButton(onClick = onFinish) { Text(stringResource(R.string.voice_input_finish)) }
            }
        },
        dismissButton = {
            TextButton(onClick = onCancel) { Text(stringResource(R.string.voice_input_cancel)) }
        }
    )
}
