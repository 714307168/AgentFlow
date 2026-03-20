package com.claudecode.remote.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialogDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.claudecode.remote.R
import com.claudecode.remote.util.CrashLogger

data class SettingsState(
    val serverUrl: String = "",
    val deviceId: String = "",
    val token: String = "",
    val username: String = "",
    val e2eEnabled: Boolean = false,
    val e2ePublicKey: String = "",
    val language: String = "en",
    val isSaving: Boolean = false,
    val message: String? = null,
    val isLoggedIn: Boolean = false
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    initialState: SettingsState,
    onSave: (serverUrl: String, deviceId: String, e2eEnabled: Boolean) -> Unit,
    onLogin: (serverUrl: String, username: String, password: String, deviceId: String) -> Unit,
    onLanguageChange: (String) -> Unit,
    onNavigateBack: () -> Unit
) {
    var serverUrl by remember { mutableStateOf(initialState.serverUrl) }
    var deviceId by remember { mutableStateOf(initialState.deviceId) }
    var username by remember { mutableStateOf(initialState.username) }
    var password by remember { mutableStateOf("") }
    var e2eEnabled by remember { mutableStateOf(initialState.e2eEnabled) }
    var selectedLang by remember { mutableStateOf(initialState.language) }
    var showLogDialog by remember { mutableStateOf(false) }
    var bannerMessage by remember { mutableStateOf(initialState.message) }
    val loginRequestSentMessage = stringResource(R.string.settings_login_request_sent)
    val saveReconnectMessage = stringResource(R.string.save_reconnect)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(
                        MaterialTheme.colorScheme.background,
                        MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.38f),
                        MaterialTheme.colorScheme.surface
                    )
                )
            )
    ) {
        Scaffold(
            containerColor = Color.Transparent,
            topBar = {
                TopAppBar(
                    title = { Text(stringResource(R.string.settings_title)) },
                    navigationIcon = {
                        IconButton(onClick = onNavigateBack) {
                            Icon(
                                Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = stringResource(R.string.back)
                            )
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = Color.Transparent,
                        titleContentColor = MaterialTheme.colorScheme.onBackground
                    )
                )
            }
        ) { padding ->
            Column(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                HeroPanel(initialState.isLoggedIn)

                bannerMessage?.let { message ->
                    Surface(
                        color = MaterialTheme.colorScheme.primaryContainer,
                        shape = MaterialTheme.shapes.medium,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = message,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp)
                        )
                    }
                }

                SettingsSection(
                    icon = Icons.Default.Link,
                    title = stringResource(R.string.settings_account_title),
                    subtitle = stringResource(R.string.settings_account_subtitle)
                ) {
                    OutlinedTextField(
                        value = serverUrl,
                        onValueChange = { serverUrl = it },
                        label = { Text(stringResource(R.string.relay_server_url)) },
                        placeholder = { Text(stringResource(R.string.settings_server_placeholder)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it },
                        label = { Text(stringResource(R.string.settings_username)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text(stringResource(R.string.settings_password)) },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier.fillMaxWidth()
                    )

                    OutlinedTextField(
                        value = deviceId,
                        onValueChange = { deviceId = it },
                        label = { Text(stringResource(R.string.device_id)) },
                        placeholder = { Text(stringResource(R.string.device_id_placeholder)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = {
                                onLogin(serverUrl.trim(), username.trim(), password, deviceId.trim())
                                bannerMessage = loginRequestSentMessage
                            },
                            enabled = serverUrl.isNotBlank() &&
                                username.isNotBlank() &&
                                password.isNotBlank() &&
                                deviceId.isNotBlank(),
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary
                            )
                        ) {
                            Text(stringResource(R.string.settings_sign_in))
                        }

                        FilledTonalButton(
                            onClick = {
                                onSave(serverUrl.trim(), deviceId.trim(), e2eEnabled)
                                bannerMessage = saveReconnectMessage
                            },
                            enabled = serverUrl.isNotBlank(),
                            modifier = Modifier.weight(1f)
                        ) {
                            Text(stringResource(R.string.settings_apply))
                        }
                    }
                }

                SettingsSection(
                    icon = Icons.Default.Lock,
                    title = stringResource(R.string.e2e_encryption),
                    subtitle = stringResource(R.string.settings_security_subtitle)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = stringResource(R.string.e2e_enable),
                                style = MaterialTheme.typography.bodyLarge
                            )
                            Text(
                                text = stringResource(R.string.settings_e2e_hint),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Switch(checked = e2eEnabled, onCheckedChange = { e2eEnabled = it })
                    }

                    if (initialState.e2ePublicKey.isNotEmpty()) {
                        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.18f))
                        Text(
                            text = stringResource(R.string.public_key),
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Surface(
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f),
                            shape = RoundedCornerShape(18.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = initialState.e2ePublicKey,
                                style = MaterialTheme.typography.bodySmall,
                                fontFamily = FontFamily.Monospace,
                                modifier = Modifier.padding(14.dp)
                            )
                        }
                    }
                }

                SettingsSection(
                    icon = Icons.Default.Language,
                    title = stringResource(R.string.language),
                    subtitle = stringResource(R.string.settings_language_subtitle)
                ) {
                    Text(
                        text = stringResource(R.string.language_label),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        LanguageOptionButton(
                            label = stringResource(R.string.lang_en),
                            selected = selectedLang == "en",
                            onClick = {
                                selectedLang = "en"
                                onLanguageChange("en")
                            },
                            modifier = Modifier.weight(1f)
                        )
                        LanguageOptionButton(
                            label = stringResource(R.string.lang_zh),
                            selected = selectedLang == "zh",
                            onClick = {
                                selectedLang = "zh"
                                onLanguageChange("zh")
                            },
                            modifier = Modifier.weight(1f)
                        )
                    }
                }

                SettingsSection(
                    icon = Icons.Default.BugReport,
                    title = stringResource(R.string.settings_diagnostics_title),
                    subtitle = stringResource(R.string.settings_diagnostics_subtitle)
                ) {
                    OutlinedButton(
                        onClick = { showLogDialog = true },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(stringResource(R.string.settings_open_crash_log))
                    }
                }
            }
        }
    }

    if (showLogDialog) {
        CrashLogDialog(onDismiss = { showLogDialog = false })
    }
}

@Composable
private fun HeroPanel(isLoggedIn: Boolean) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
        shadowElevation = 10.dp,
        tonalElevation = 3.dp,
        shape = MaterialTheme.shapes.large,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(
                text = stringResource(R.string.settings_hero_title),
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = stringResource(R.string.settings_hero_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Surface(
                color = if (isLoggedIn) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.secondaryContainer
                },
                shape = RoundedCornerShape(999.dp)
            ) {
                Text(
                    text = if (isLoggedIn) {
                        stringResource(R.string.settings_signed_in)
                    } else {
                        stringResource(R.string.settings_sign_in_required)
                    },
                    style = MaterialTheme.typography.labelLarge,
                    color = if (isLoggedIn) {
                        MaterialTheme.colorScheme.onPrimaryContainer
                    } else {
                        MaterialTheme.colorScheme.onSecondaryContainer
                    },
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp)
                )
            }
        }
    }
}

@Composable
private fun LanguageOptionButton(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    if (selected) {
        FilledTonalButton(
            onClick = onClick,
            modifier = modifier
        ) {
            Text(label)
        }
    } else {
        OutlinedButton(
            onClick = onClick,
            modifier = modifier
        ) {
            Text(label)
        }
    }
}

@Composable
private fun SettingsSection(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    content: @Composable ColumnScope.() -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
        shadowElevation = 8.dp,
        tonalElevation = 2.dp,
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Surface(
                    color = MaterialTheme.colorScheme.primaryContainer,
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.padding(10.dp)
                    )
                }
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            content()
        }
    }
}

@Composable
private fun CrashLogDialog(onDismiss: () -> Unit) {
    val logContent = remember { CrashLogger.getLogContent() }
    val logPath = remember { CrashLogger.getLogFilePath() }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = MaterialTheme.shapes.large,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = AlertDialogDefaults.TonalElevation,
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.82f)
        ) {
            Column(
                modifier = Modifier
                    .padding(18.dp)
                    .fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    text = stringResource(R.string.settings_crash_log_title),
                    style = MaterialTheme.typography.titleLarge
                )
                Text(
                    text = logPath,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.65f),
                    shape = MaterialTheme.shapes.medium,
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                ) {
                    val scrollState = rememberScrollState()
                    Text(
                        text = logContent,
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier
                            .padding(14.dp)
                            .verticalScroll(scrollState)
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(
                        onClick = {
                            CrashLogger.clearLog()
                            onDismiss()
                        },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(stringResource(R.string.settings_clear))
                    }
                    Button(
                        onClick = onDismiss,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(stringResource(R.string.settings_close))
                    }
                }
            }
        }
    }
}
