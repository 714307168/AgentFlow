package com.claudecode.remote

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.core.content.ContextCompat
import com.claudecode.remote.service.RelayConnectionService
import com.claudecode.remote.ui.chat.ChatScreen
import com.claudecode.remote.ui.chat.ChatViewModel
import com.claudecode.remote.ui.session.SessionListScreen
import com.claudecode.remote.ui.session.SessionViewModel
import com.claudecode.remote.ui.settings.SettingsScreen
import com.claudecode.remote.ui.settings.SettingsState
import com.claudecode.remote.ui.theme.RemoteTheme
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.launch
import java.util.Locale

class MainActivity : ComponentActivity() {
    private lateinit var appContainer: AppContainer

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appContainer = applicationContext.appContainer()

        CrashLogger.init(applicationContext, appContainer.tokenStore)
        CrashLogger.logInfo("MainActivity", "App started")

        applySavedLanguage()
        requestNotificationPermissionIfNeeded()
        appContainer.chatNavigationBus.publishFromIntent(intent)

        if (appContainer.tokenStore.shouldAutoStartRelay()) {
            RelayConnectionService.start(applicationContext)
        }

        enableEdgeToEdge()
        setContent {
            RemoteTheme {
                val navController = rememberNavController()
                val coroutineScope = rememberCoroutineScope()
                val tokenStore = appContainer.tokenStore
                val relayWebSocket = appContainer.relayWebSocket
                val sessionRepository = appContainer.sessionRepository
                val messageRepository = appContainer.messageRepository
                val appUpdateManager = appContainer.appUpdateManager
                val e2eCrypto = appContainer.e2eCrypto
                val navigationTarget by appContainer.chatNavigationBus.target.collectAsState()
                val updateState by appUpdateManager.state.collectAsState()

                LaunchedEffect(navigationTarget) {
                    val target = navigationTarget ?: return@LaunchedEffect
                    val encodedName = android.net.Uri.encode(target.projectName.ifEmpty { "Project" })
                    val encodedAgentId = android.net.Uri.encode(target.agentId)
                    navController.navigate("chat/${target.projectId}/$encodedName/$encodedAgentId") {
                        launchSingleTop = true
                    }
                    appContainer.chatNavigationBus.consume(target)
                }

                LaunchedEffect(Unit) {
                    appUpdateManager.maybeAutoCheck()
                }

                NavHost(navController = navController, startDestination = "sessions") {
                    composable("sessions") {
                        val viewModel = remember {
                            SessionViewModel(sessionRepository, messageRepository, relayWebSocket)
                        }

                        SessionListScreen(
                            viewModel = viewModel,
                            webSocket = relayWebSocket,
                            updateState = updateState,
                            onCheckForUpdates = {
                                coroutineScope.launch { appUpdateManager.checkForUpdates(manual = true) }
                            },
                            onDownloadUpdate = {
                                coroutineScope.launch { appUpdateManager.downloadLatestUpdate() }
                            },
                            onInstallUpdate = { appUpdateManager.installDownloadedUpdate() },
                            onNavigateToChat = { session ->
                                val encodedName = android.net.Uri.encode(session.name.ifEmpty { "Project" })
                                val encodedAgentId = android.net.Uri.encode(session.agentId)
                                navController.navigate("chat/${session.projectId}/$encodedName/$encodedAgentId")
                            },
                            onRefreshSessions = {
                                viewModel.syncFromDesktop()
                            },
                            onToggleConnection = {
                                when (relayWebSocket.connectionState.value) {
                                    com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.CONNECTED,
                                    com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.CONNECTING,
                                    com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.RECONNECTING ->
                                        RelayConnectionService.stop(applicationContext)
                                    com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.DISCONNECTED ->
                                        RelayConnectionService.start(applicationContext)
                                }
                            },
                            onNavigateToSettings = {
                                navController.navigate("settings")
                            }
                        )
                    }
                    composable("chat/{projectId}/{projectName}/{agentId}") { backStackEntry ->
                        val projectId = backStackEntry.arguments?.getString("projectId") ?: ""
                        val projectName = android.net.Uri.decode(
                            backStackEntry.arguments?.getString("projectName") ?: "Project"
                        )
                        val agentId = android.net.Uri.decode(
                            backStackEntry.arguments?.getString("agentId") ?: ""
                        )

                        CrashLogger.logInfo(
                            "MainActivity",
                            "Navigating to chat: projectId=$projectId, projectName=$projectName, agentId=$agentId"
                        )

                        if (projectId.isEmpty()) {
                            CrashLogger.logError("MainActivity", "Empty projectId, navigating back")
                            LaunchedEffect(Unit) {
                                navController.popBackStack()
                            }
                            return@composable
                        }

                        val viewModel = remember(projectId) {
                            ChatViewModel(messageRepository, relayWebSocket, tokenStore)
                        }
                        ChatScreen(
                            projectId = projectId,
                            projectName = projectName,
                            agentId = agentId,
                            viewModel = viewModel,
                            uiPresenceTracker = appContainer.uiPresenceTracker,
                            onNavigateBack = { navController.popBackStack() }
                        )
                    }
                    composable("settings") {
                        SettingsScreen(
                            initialState = SettingsState(
                                serverUrl = tokenStore.getServerUrl() ?: "",
                                deviceId = tokenStore.getDeviceId() ?: "",
                                token = tokenStore.getToken() ?: "",
                                username = tokenStore.getUsername() ?: "",
                                password = tokenStore.getPassword() ?: "",
                                e2eEnabled = tokenStore.isE2EEnabled(),
                                e2ePublicKey = e2eCrypto.getPublicKeyBase64(),
                                language = tokenStore.getLanguage(),
                                autoUpdateCheckEnabled = tokenStore.isAutoUpdateCheckEnabled(),
                                autoUpdateDownloadEnabled = tokenStore.isAutoUpdateDownloadEnabled(),
                                crashLogsEnabled = tokenStore.isCrashLogsEnabled(),
                                updateState = updateState,
                                isLoggedIn = tokenStore.hasSavedSession()
                            ),
                            onSaveConnection = { url, devId ->
                                val normalizedUrl = normalizeHttpBaseUrl(url)
                                appContainer.updateServerUrl(normalizedUrl)
                                tokenStore.saveDeviceId(devId)
                                if (tokenStore.hasSavedSession() && devId.isNotBlank()) {
                                    relayWebSocket.disconnect()
                                    RelayConnectionService.start(applicationContext)
                                }
                            },
                            onE2EEnabledChange = { enabled ->
                                tokenStore.saveE2EEnabled(enabled)
                            },
                            onAutoUpdateCheckChange = { enabled ->
                                tokenStore.saveAutoUpdateCheckEnabled(enabled)
                            },
                            onAutoUpdateDownloadChange = { enabled ->
                                tokenStore.saveAutoUpdateDownloadEnabled(enabled)
                            },
                            onCrashLogsEnabledChange = { enabled ->
                                tokenStore.saveCrashLogsEnabled(enabled)
                            },
                            onLogin = { url, username, password, deviceId ->
                                val normalizedUrl = normalizeHttpBaseUrl(url)
                                appContainer.updateServerUrl(normalizedUrl)
                                tokenStore.saveDeviceId(deviceId)

                                coroutineScope.launch {
                                    try {
                                        val response = appContainer.authSessionManager.login(
                                            username = username,
                                            password = password,
                                            clientId = deviceId
                                        ).getOrThrow()
                                        CrashLogger.logInfo("MainActivity", "Login successful: ${response.user.username}")

                                        relayWebSocket.disconnect()
                                        RelayConnectionService.start(applicationContext)
                                    } catch (e: Exception) {
                                        CrashLogger.logError("MainActivity", "Login failed", e)
                                    }
                                }
                            },
                            onCheckForUpdates = {
                                coroutineScope.launch { appUpdateManager.checkForUpdates(manual = true) }
                            },
                            onDownloadUpdate = {
                                coroutineScope.launch { appUpdateManager.downloadLatestUpdate() }
                            },
                            onInstallUpdate = { appUpdateManager.installDownloadedUpdate() },
                            onLanguageChange = { lang ->
                                tokenStore.saveLanguage(lang)
                                applyLanguage(lang)
                                recreate()
                            },
                            onNavigateBack = { navController.popBackStack() }
                        )
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        appContainer.chatNavigationBus.publishFromIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        appContainer.uiPresenceTracker.setAppInForeground(true)
    }

    override fun onStop() {
        appContainer.uiPresenceTracker.setAppInForeground(false)
        super.onStop()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return
        }
        if (ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun applySavedLanguage() {
        applyLanguage(appContainer.tokenStore.getLanguage())
    }

    private fun applyLanguage(lang: String) {
        val locale = Locale(lang)
        Locale.setDefault(locale)
        val config = resources.configuration
        config.setLocale(locale)
        @Suppress("DEPRECATION")
        resources.updateConfiguration(config, resources.displayMetrics)
    }
}
