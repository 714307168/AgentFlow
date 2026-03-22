package com.claudecode.remote.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.claudecode.remote.R
import com.claudecode.remote.update.AppUpdateState
import com.claudecode.remote.update.AppUpdateStatus
import com.claudecode.remote.util.CrashLogFileInfo
import com.claudecode.remote.util.CrashLogger
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class SettingsState(
    val serverUrl: String = "",
    val deviceId: String = "",
    val token: String = "",
    val username: String = "",
    val password: String = "",
    val e2eEnabled: Boolean = false,
    val e2ePublicKey: String = "",
    val language: String = "en",
    val autoUpdateCheckEnabled: Boolean = true,
    val autoUpdateDownloadEnabled: Boolean = false,
    val crashLogsEnabled: Boolean = true,
    val updateState: AppUpdateState = AppUpdateState(),
    val isSaving: Boolean = false,
    val message: String? = null,
    val isLoggedIn: Boolean = false
)

@Composable
fun SettingsScreen(
    initialState: SettingsState,
    onSaveConnection: (serverUrl: String, deviceId: String) -> Unit,
    onLogin: (serverUrl: String, username: String, password: String, deviceId: String) -> Unit,
    onE2EEnabledChange: (Boolean) -> Unit,
    onAutoUpdateCheckChange: (Boolean) -> Unit,
    onAutoUpdateDownloadChange: (Boolean) -> Unit,
    onCrashLogsEnabledChange: (Boolean) -> Unit,
    onCheckForUpdates: () -> Unit,
    onDownloadUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    onLanguageChange: (String) -> Unit,
    onNavigateBack: () -> Unit
) {
    var serverUrl by remember(initialState.serverUrl) { mutableStateOf(initialState.serverUrl) }
    var deviceId by remember(initialState.deviceId) { mutableStateOf(initialState.deviceId) }
    var username by remember(initialState.username) { mutableStateOf(initialState.username) }
    var password by remember(initialState.password) { mutableStateOf(initialState.password) }
    var e2eEnabled by remember(initialState.e2eEnabled) { mutableStateOf(initialState.e2eEnabled) }
    var selectedLang by remember(initialState.language) { mutableStateOf(initialState.language) }
    var autoUpdateCheckEnabled by remember(initialState.autoUpdateCheckEnabled) { mutableStateOf(initialState.autoUpdateCheckEnabled) }
    var autoUpdateDownloadEnabled by remember(initialState.autoUpdateDownloadEnabled) { mutableStateOf(initialState.autoUpdateDownloadEnabled) }
    var crashLogsEnabled by remember(initialState.crashLogsEnabled) { mutableStateOf(initialState.crashLogsEnabled) }
    var showLogDialog by remember { mutableStateOf(false) }
    var bannerMessage by remember(initialState.message) { mutableStateOf(initialState.message) }
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
        ) { padding ->
            Column(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .statusBarsPadding()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                SettingsHeader(onNavigateBack = onNavigateBack)

                HeroPanel(initialState.isLoggedIn)

                bannerMessage?.let { message ->
                    Surface(
                        color = MaterialTheme.colorScheme.primaryContainer,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)),
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
                    SettingsTextField(
                        value = serverUrl,
                        onValueChange = { serverUrl = it },
                        label = { Text(stringResource(R.string.relay_server_url)) },
                        placeholder = { Text(stringResource(R.string.settings_server_placeholder)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    SettingsTextField(
                        value = username,
                        onValueChange = { username = it },
                        label = { Text(stringResource(R.string.settings_username)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    SettingsTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text(stringResource(R.string.settings_password)) },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier.fillMaxWidth()
                    )

                    SettingsTextField(
                        value = deviceId,
                        onValueChange = { deviceId = it },
                        label = { Text(stringResource(R.string.device_id)) },
                        placeholder = { Text(stringResource(R.string.device_id_placeholder)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = {
                                onLogin(serverUrl.trim(), username.trim(), password, deviceId.trim())
                                bannerMessage = loginRequestSentMessage
                            },
                            enabled = serverUrl.isNotBlank() &&
                                username.isNotBlank() &&
                                password.isNotBlank() &&
                                deviceId.isNotBlank(),
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary
                            )
                        ) {
                            Text(stringResource(R.string.settings_sign_in))
                        }

                        FilledTonalButton(
                            onClick = {
                                onSaveConnection(
                                    serverUrl.trim(),
                                    deviceId.trim()
                                )
                                bannerMessage = saveReconnectMessage
                            },
                            enabled = serverUrl.isNotBlank(),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(stringResource(R.string.settings_apply))
                        }
                    }
                }

                SettingsSection(
                    icon = Icons.Default.Link,
                    title = stringResource(R.string.settings_updates_title),
                    subtitle = stringResource(R.string.settings_updates_subtitle)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = stringResource(R.string.settings_auto_check_updates),
                                style = MaterialTheme.typography.bodyLarge
                            )
                            Text(
                                text = stringResource(R.string.settings_auto_check_updates_hint),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Switch(
                            checked = autoUpdateCheckEnabled,
                            onCheckedChange = {
                                autoUpdateCheckEnabled = it
                                onAutoUpdateCheckChange(it)
                            }
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = stringResource(R.string.settings_auto_download_updates),
                                style = MaterialTheme.typography.bodyLarge
                            )
                            Text(
                                text = stringResource(R.string.settings_auto_download_updates_hint),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Switch(
                            checked = autoUpdateDownloadEnabled,
                            onCheckedChange = {
                                autoUpdateDownloadEnabled = it
                                onAutoUpdateDownloadChange(it)
                            }
                        )
                    }

                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f),
                        shape = RoundedCornerShape(18.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(
                                text = stringResource(R.string.settings_update_status),
                                style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = updateStatusText(initialState.updateState),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            if (initialState.updateState.notes.isNotBlank()) {
                                Text(
                                    text = initialState.updateState.notes,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(
                            onClick = onCheckForUpdates,
                            modifier = Modifier.weight(1f)
                        ) {
                            Text(stringResource(R.string.settings_check_updates))
                        }
                        OutlinedButton(
                            onClick = onDownloadUpdate,
                            enabled = initialState.updateState.status == AppUpdateStatus.AVAILABLE,
                            modifier = Modifier.weight(1f)
                        ) {
                            Text(stringResource(R.string.settings_download_update))
                        }
                    }
                    Button(
                        onClick = onInstallUpdate,
                        enabled = initialState.updateState.status == AppUpdateStatus.DOWNLOADED,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(stringResource(R.string.settings_install_update))
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
                        Switch(
                            checked = e2eEnabled,
                            onCheckedChange = {
                                e2eEnabled = it
                                onE2EEnabledChange(it)
                            }
                        )
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
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = stringResource(R.string.settings_crash_logs_enabled),
                                style = MaterialTheme.typography.bodyLarge
                            )
                            Text(
                                text = stringResource(R.string.settings_crash_logs_enabled_hint),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Switch(
                            checked = crashLogsEnabled,
                            onCheckedChange = {
                                crashLogsEnabled = it
                                onCrashLogsEnabledChange(it)
                            }
                        )
                    }

                    Text(
                        text = stringResource(R.string.settings_log_directory),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f),
                        shape = RoundedCornerShape(18.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = CrashLogger.getLogDirectoryPath(),
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.padding(14.dp)
                        )
                    }

                    OutlinedButton(
                        onClick = { showLogDialog = true },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(stringResource(R.string.settings_open_crash_logs))
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
private fun updateStatusText(updateState: AppUpdateState): String =
    when (updateState.status) {
        AppUpdateStatus.IDLE -> stringResource(R.string.settings_update_idle)
        AppUpdateStatus.CHECKING -> stringResource(R.string.settings_update_checking)
        AppUpdateStatus.AVAILABLE -> stringResource(
            R.string.settings_update_available,
            updateState.latestVersion ?: "?"
        )
        AppUpdateStatus.DOWNLOADING -> stringResource(
            R.string.settings_update_downloading,
            updateState.latestVersion ?: "?"
        )
        AppUpdateStatus.DOWNLOADED -> stringResource(
            R.string.settings_update_downloaded,
            updateState.latestVersion ?: "?"
        )
        AppUpdateStatus.UP_TO_DATE -> stringResource(R.string.settings_update_uptodate)
        AppUpdateStatus.ERROR -> updateState.message ?: stringResource(R.string.settings_update_error)
    }

@Composable
private fun SettingsHeader(onNavigateBack: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top
    ) {
        HeaderButton(
            icon = Icons.AutoMirrored.Filled.ArrowBack,
            contentDescription = stringResource(R.string.back),
            onClick = onNavigateBack
        )

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(
                text = stringResource(R.string.settings_title),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = stringResource(R.string.settings_hero_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun HeaderButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.14f)),
        shadowElevation = 6.dp
    ) {
        IconButton(
            onClick = onClick,
            modifier = Modifier.size(46.dp),
            colors = IconButtonDefaults.iconButtonColors(
                contentColor = MaterialTheme.colorScheme.onSurface
            )
        ) {
            Icon(
                imageVector = icon,
                contentDescription = contentDescription
            )
        }
    }
}

@Composable
private fun HeroPanel(isLoggedIn: Boolean) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
        shadowElevation = 10.dp,
        tonalElevation = 3.dp,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)),
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
private fun SettingsTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: @Composable (() -> Unit)? = null,
    placeholder: @Composable (() -> Unit)? = null,
    singleLine: Boolean = false,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    visualTransformation: androidx.compose.ui.text.input.VisualTransformation = androidx.compose.ui.text.input.VisualTransformation.None,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = label,
        placeholder = placeholder,
        singleLine = singleLine,
        keyboardOptions = keyboardOptions,
        visualTransformation = visualTransformation,
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = MaterialTheme.colorScheme.surface,
            unfocusedContainerColor = MaterialTheme.colorScheme.surface,
            disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.2f),
            focusedBorderColor = MaterialTheme.colorScheme.primary,
            unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.32f),
            disabledBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.16f),
            focusedTextColor = MaterialTheme.colorScheme.onSurface,
            unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
            focusedPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant,
            unfocusedPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant
        ),
        shape = RoundedCornerShape(22.dp),
        modifier = modifier
    )
}

@Composable
private fun SettingsSection(
    icon: ImageVector,
    title: String,
    subtitle: String,
    content: @Composable ColumnScope.() -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
        shadowElevation = 8.dp,
        tonalElevation = 2.dp,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)),
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
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface
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
    var refreshToken by remember { mutableStateOf(0) }
    val logFiles = remember(refreshToken) { CrashLogger.listLogFiles() }
    var selectedFileName by remember(refreshToken) { mutableStateOf(logFiles.firstOrNull()?.name) }

    LaunchedEffect(logFiles) {
        if (selectedFileName == null || logFiles.none { it.name == selectedFileName }) {
            selectedFileName = logFiles.firstOrNull()?.name
        }
    }

    val logDirectory = remember { CrashLogger.getLogDirectoryPath() }
    val logContent = remember(selectedFileName, refreshToken) {
        selectedFileName?.let(CrashLogger::readLogFile).orEmpty()
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = MaterialTheme.shapes.large,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = AlertDialogDefaults.TonalElevation,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)),
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
                    text = logDirectory,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (logFiles.isEmpty()) {
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.65f),
                        shape = MaterialTheme.shapes.medium,
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth()
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(18.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = stringResource(R.string.settings_no_crash_logs),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                } else {
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f),
                        shape = MaterialTheme.shapes.medium,
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            LazyColumn(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .weight(0.38f, fill = true),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                items(logFiles, key = { it.name }) { fileInfo ->
                                    CrashLogFileRow(
                                        fileInfo = fileInfo,
                                        isSelected = fileInfo.name == selectedFileName,
                                        onClick = { selectedFileName = fileInfo.name }
                                    )
                                }
                            }

                            Surface(
                                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.82f),
                                shape = MaterialTheme.shapes.medium,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .weight(0.62f, fill = true)
                            ) {
                                val scrollState = rememberScrollState()
                                Text(
                                    text = logContent.ifEmpty { stringResource(R.string.settings_no_crash_logs) },
                                    style = MaterialTheme.typography.bodySmall,
                                    fontFamily = FontFamily.Monospace,
                                    modifier = Modifier
                                        .padding(14.dp)
                                        .verticalScroll(scrollState)
                                )
                            }
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(
                        onClick = {
                            CrashLogger.clearAllLogs()
                            refreshToken += 1
                        },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(stringResource(R.string.settings_clear_all))
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

@Composable
private fun CrashLogFileRow(
    fileInfo: CrashLogFileInfo,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        color = if (isSelected) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surface.copy(alpha = 0.82f)
        },
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(
            1.dp,
            if (isSelected) {
                MaterialTheme.colorScheme.primary.copy(alpha = 0.28f)
            } else {
                MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)
            }
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = fileInfo.name,
                style = MaterialTheme.typography.labelLarge,
                color = if (isSelected) {
                    MaterialTheme.colorScheme.onPrimaryContainer
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = "${formatTimestamp(fileInfo.modifiedAt)} • ${formatFileSize(fileInfo.sizeBytes)}",
                style = MaterialTheme.typography.bodySmall,
                color = if (isSelected) {
                    MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.8f)
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                }
            )
        }
    }
}

private fun formatFileSize(sizeBytes: Long): String =
    when {
        sizeBytes >= 1024 * 1024 -> String.format(Locale.US, "%.1f MB", sizeBytes / (1024f * 1024f))
        sizeBytes >= 1024 -> String.format(Locale.US, "%.1f KB", sizeBytes / 1024f)
        else -> "$sizeBytes B"
    }

private fun formatTimestamp(timestamp: Long): String =
    SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date(timestamp))
