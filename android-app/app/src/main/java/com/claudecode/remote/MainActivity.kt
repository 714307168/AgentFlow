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
import com.claudecode.remote.data.remote.LoginRequest
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
import kotlinx.serialization.json.Json
import java.util.Locale

class MainActivity : ComponentActivity() {
    private lateinit var appContainer: AppContainer

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appContainer = applicationContext.appContainer()

        CrashLogger.init(applicationContext)
        CrashLogger.logInfo("MainActivity", "App started")

        applySavedLanguage()
        requestNotificationPermissionIfNeeded()
        appContainer.chatNavigationBus.publishFromIntent(intent)

        if (!appContainer.tokenStore.getToken().isNullOrBlank()) {
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
                val json = remember {
                    Json { ignoreUnknownKeys = true; encodeDefaults = true }
                }
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
                            ChatViewModel(messageRepository, relayWebSocket)
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
                                e2eEnabled = tokenStore.isE2EEnabled(),
                                e2ePublicKey = e2eCrypto.getPublicKeyBase64(),
                                language = tokenStore.getLanguage(),
                                autoUpdateCheckEnabled = tokenStore.isAutoUpdateCheckEnabled(),
                                autoUpdateDownloadEnabled = tokenStore.isAutoUpdateDownloadEnabled(),
                                updateState = updateState,
                                isLoggedIn = tokenStore.getToken()?.isNotEmpty() == true
                            ),
                            onSave = { url, devId, e2e, autoCheckUpdates, autoDownloadUpdates ->
                                val normalizedUrl = normalizeHttpBaseUrl(url)
                                appContainer.updateServerUrl(normalizedUrl)
                                tokenStore.saveDeviceId(devId)
                                tokenStore.saveE2EEnabled(e2e)
                                tokenStore.saveAutoUpdateCheckEnabled(autoCheckUpdates)
                                tokenStore.saveAutoUpdateDownloadEnabled(autoDownloadUpdates)
                                if (!tokenStore.getToken().isNullOrBlank()) {
                                    relayWebSocket.disconnect()
                                    coroutineScope.launch {
                                        relayWebSocket.connect()
                                    }
                                    RelayConnectionService.start(applicationContext)
                                }
                            },
                            onLogin = { url, username, password, deviceId ->
                                val normalizedUrl = normalizeHttpBaseUrl(url)
                                appContainer.updateServerUrl(normalizedUrl)
                                tokenStore.saveDeviceId(deviceId)
                                tokenStore.saveUsername(username)

                                coroutineScope.launch {
                                    try {
                                        val response = createRelayApi(normalizedUrl, json).login(
                                            LoginRequest(
                                                username = username,
                                                password = password,
                                                clientType = "device",
                                                clientId = deviceId
                                            )
                                        )
                                        tokenStore.saveToken(response.token)
                                        CrashLogger.logInfo("MainActivity", "Login successful: ${response.user.username}")

                                        relayWebSocket.disconnect()
                                        relayWebSocket.connect()
                                        RelayConnectionService.start(applicationContext)
                                        sessionRepository.syncFromServer()
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
