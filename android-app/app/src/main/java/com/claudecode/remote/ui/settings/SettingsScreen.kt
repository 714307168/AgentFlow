package com.claudecode.remote.ui.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
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
    var langExpanded by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var isLoggedIn by remember { mutableStateOf(initialState.isLoggedIn) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Server Connection Section
            Text(
                text = stringResource(R.string.server_connection),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary
            )

            OutlinedTextField(
                value = serverUrl,
                onValueChange = { serverUrl = it },
                label = { Text(stringResource(R.string.relay_server_url)) },
                placeholder = { Text("http://localhost:8080") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = username,
                onValueChange = { username = it },
                label = { Text("用户名") },
                placeholder = { Text("输入用户名") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("密码") },
                placeholder = { Text("输入密码") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
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

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = {
                        if (serverUrl.isNotBlank() && username.isNotBlank() && password.isNotBlank() && deviceId.isNotBlank()) {
                            onLogin(serverUrl, username, password, deviceId)
                        }
                    },
                    modifier = Modifier.weight(1f),
                    enabled = serverUrl.isNotBlank() && username.isNotBlank() && password.isNotBlank() && deviceId.isNotBlank()
                ) {
                    Text("登录")
                }
            }

            if (isLoggedIn) {
                Surface(
                    color = MaterialTheme.colorScheme.primaryContainer,
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "✓ 已登录",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.padding(12.dp)
                    )
                }
            }

            HorizontalDivider()

            // E2E Encryption Section
            Text(
                text = stringResource(R.string.e2e_encryption),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(stringResource(R.string.e2e_enable), style = MaterialTheme.typography.bodyLarge)
                Switch(checked = e2eEnabled, onCheckedChange = { e2eEnabled = it })
            }

            if (initialState.e2ePublicKey.isNotEmpty()) {
                Text(
                    text = stringResource(R.string.public_key),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = initialState.e2ePublicKey,
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.padding(12.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            HorizontalDivider()

            // Language Section
            Text(
                text = stringResource(R.string.language),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary
            )

            ExposedDropdownMenuBox(
                expanded = langExpanded,
                onExpandedChange = { langExpanded = it }
            ) {
                OutlinedTextField(
                    value = if (selectedLang == "zh") stringResource(R.string.lang_zh) else stringResource(R.string.lang_en),
                    onValueChange = {},
                    readOnly = true,
                    label = { Text(stringResource(R.string.language_label)) },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = langExpanded) },
                    modifier = Modifier.menuAnchor().fillMaxWidth()
                )
                ExposedDropdownMenu(
                    expanded = langExpanded,
                    onDismissRequest = { langExpanded = false }
                ) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.lang_en)) },
                        onClick = {
                            selectedLang = "en"
                            langExpanded = false
                            onLanguageChange("en")
                        }
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.lang_zh)) },
                        onClick = {
                            selectedLang = "zh"
                            langExpanded = false
                            onLanguageChange("zh")
                        }
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            HorizontalDivider()

            // Debug Section
            Text(
                text = "调试工具",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary
            )

            var showLogDialog by remember { mutableStateOf(false) }

            Button(
                onClick = { showLogDialog = true },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer
                )
            ) {
                Text("查看崩溃日志")
            }

            if (showLogDialog) {
                CrashLogDialog(onDismiss = { showLogDialog = false })
            }

            Spacer(modifier = Modifier.height(8.dp))

            Button(
                onClick = {
                    onSave(serverUrl.trim(), deviceId.trim(), e2eEnabled)
                    message = "Settings saved"
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = serverUrl.isNotBlank()
            ) {
                Text(stringResource(R.string.save_reconnect))
            }

            message?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }
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
            tonalElevation = 6.dp,
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.8f)
        ) {
            Column(
                modifier = Modifier
                    .padding(16.dp)
                    .fillMaxSize()
            ) {
                Text(
                    text = "崩溃日志",
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.padding(bottom = 8.dp)
                )

                Text(
                    text = "日志位置: $logPath",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 16.dp)
                )

                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = MaterialTheme.shapes.small,
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
                            .padding(12.dp)
                            .verticalScroll(scrollState)
                    )
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = {
                            CrashLogger.clearLog()
                            onDismiss()
                        },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("清除日志")
                    }

                    Button(
                        onClick = onDismiss,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("关闭")
                    }
                }
            }
        }
    }
}
