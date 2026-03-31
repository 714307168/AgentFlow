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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.claudecode.remote.service.RelayConnectionService
import com.claudecode.remote.ui.agent.AgentHubScreen
import com.claudecode.remote.ui.agent.AgentHubViewModel
import com.claudecode.remote.ui.chat.ChatScreen
import com.claudecode.remote.ui.chat.ChatViewModel
import com.claudecode.remote.ui.session.SessionListScreen
import com.claudecode.remote.ui.session.SessionViewModel
import com.claudecode.remote.ui.settings.SettingsScreen
import com.claudecode.remote.ui.settings.SettingsState
import com.claudecode.remote.ui.theme.RemoteTheme
import com.claudecode.remote.ui.workgroup.WorkgroupChatScreen
import com.claudecode.remote.ui.workgroup.WorkgroupChatViewModel
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.launch
import java.util.Locale

private data class BottomNavItem(
    val route: String,
    val labelResId: Int,
    val icon: androidx.compose.ui.graphics.vector.ImageVector
)

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
                val workgroupRepository = appContainer.workgroupRepository
                val appUpdateManager = appContainer.appUpdateManager
                val e2eCrypto = appContainer.e2eCrypto
                val sessionViewModel = remember {
                    SessionViewModel(
                        repository = sessionRepository,
                        messageRepository = messageRepository,
                        webSocket = relayWebSocket,
                        tokenStore = tokenStore,
                        workgroupRepository = workgroupRepository
                    )
                }
                val agentHubViewModel = remember {
                    AgentHubViewModel(
                        context = applicationContext,
                        sessionRepository = sessionRepository,
                        messageRepository = messageRepository,
                        workgroupRepository = workgroupRepository,
                        webSocket = relayWebSocket,
                        tokenStore = tokenStore
                    )
                }
                val navigationTarget by appContainer.chatNavigationBus.target.collectAsState()
                val updateState by appUpdateManager.state.collectAsState()
                val backStackEntry by navController.currentBackStackEntryAsState()
                val currentDestination = backStackEntry?.destination
                val darkTheme = isSystemInDarkTheme()
                val colorScheme = MaterialTheme.colorScheme
                val bottomNavItems = listOf(
                    BottomNavItem("messages", R.string.nav_messages, Icons.AutoMirrored.Filled.Chat),
                    BottomNavItem("agents", R.string.nav_agents, Icons.Default.Dns),
                    BottomNavItem("settings", R.string.settings_title, Icons.Default.Settings),
                )
                val bottomBarColor = if (darkTheme) {
                    lerp(
                        colorScheme.surface,
                        colorScheme.surfaceVariant,
                        0.42f
                    ).copy(alpha = 0.98f)
                } else {
                    colorScheme.surface.copy(alpha = 0.96f)
                }
                val bottomBarOutline = colorScheme.outline.copy(alpha = if (darkTheme) 0.24f else 0.12f)
                val showBottomBar = bottomNavItems.any { item ->
                    currentDestination?.hierarchy?.any { destination -> destination.route == item.route } == true
                }

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

                Scaffold(
                    containerColor = MaterialTheme.colorScheme.background,
                    contentWindowInsets = WindowInsets(0, 0, 0, 0),
                    bottomBar = {
                        if (showBottomBar) {
                            Surface(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .navigationBarsPadding()
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                                shape = RoundedCornerShape(26.dp),
                                color = bottomBarColor,
                                tonalElevation = 4.dp,
                                shadowElevation = if (darkTheme) 4.dp else 10.dp,
                                border = androidx.compose.foundation.BorderStroke(1.dp, bottomBarOutline)
                            ) {
                                NavigationBar(
                                    containerColor = androidx.compose.ui.graphics.Color.Transparent,
                                    windowInsets = WindowInsets(0, 0, 0, 0)
                                ) {
                                    bottomNavItems.forEach { item ->
                                        val selected = currentDestination?.hierarchy?.any { destination ->
                                            destination.route == item.route
                                        } == true
                                        NavigationBarItem(
                                            selected = selected,
                                            colors = NavigationBarItemDefaults.colors(
                                                selectedIconColor = colorScheme.onPrimaryContainer,
                                                selectedTextColor = colorScheme.onPrimaryContainer,
                                                unselectedIconColor = colorScheme.onSurfaceVariant.copy(alpha = if (darkTheme) 0.92f else 0.78f),
                                                unselectedTextColor = colorScheme.onSurfaceVariant.copy(alpha = if (darkTheme) 0.92f else 0.78f),
                                                indicatorColor = colorScheme.primaryContainer.copy(alpha = if (darkTheme) 0.72f else 0.9f)
                                            ),
                                            onClick = {
                                                navController.navigate(item.route) {
                                                    popUpTo(navController.graph.findStartDestination().id) {
                                                        saveState = true
                                                    }
                                                    launchSingleTop = true
                                                    restoreState = true
                                                }
                                            },
                                            icon = {
                                                Icon(
                                                    imageVector = item.icon,
                                                    contentDescription = stringResource(item.labelResId)
                                                )
                                            },
                                            label = { Text(stringResource(item.labelResId)) }
                                        )
                                    }
                                }
                            }
                        }
                    }
                ) { innerPadding ->
                    NavHost(
                        navController = navController,
                        startDestination = "messages",
                        modifier = Modifier.padding(innerPadding)
                    ) {
                        composable("messages") {
                            SessionListScreen(
                                viewModel = sessionViewModel,
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
                                onNavigateToWorkgroupChat = { agentId, workgroupId, workgroupName ->
                                    val encodedAgentId = android.net.Uri.encode(agentId)
                                    val encodedWorkgroupId = android.net.Uri.encode(workgroupId)
                                    val encodedGroupName = android.net.Uri.encode(workgroupName.ifEmpty { "Workgroup" })
                                    navController.navigate("workgroups/chat/$encodedAgentId/$encodedWorkgroupId/$encodedGroupName")
                                },
                                onRefreshSessions = {
                                    sessionViewModel.syncFromDesktop()
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
                                }
                            )
                        }
                        composable("agents") {
                            AgentHubScreen(
                                viewModel = agentHubViewModel,
                                webSocket = relayWebSocket,
                                onNavigateToChat = { session ->
                                    val encodedName = android.net.Uri.encode(session.name.ifEmpty { "Project" })
                                    val encodedAgentId = android.net.Uri.encode(session.agentId)
                                    navController.navigate("chat/${session.projectId}/$encodedName/$encodedAgentId")
                                },
                                onOpenWorkgroupChat = { agentId, workgroupId, groupName ->
                                    val encodedAgentId = android.net.Uri.encode(agentId)
                                    val encodedWorkgroupId = android.net.Uri.encode(workgroupId)
                                    val encodedGroupName = android.net.Uri.encode(groupName.ifEmpty { "Workgroup" })
                                    navController.navigate("workgroups/chat/$encodedAgentId/$encodedWorkgroupId/$encodedGroupName")
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
                                }
                            )
                        }
                        composable("workgroups/chat/{agentId}/{workgroupId}/{workgroupName}") { backStackEntry ->
                            val agentId = android.net.Uri.decode(
                                backStackEntry.arguments?.getString("agentId") ?: ""
                            )
                            val workgroupId = android.net.Uri.decode(
                                backStackEntry.arguments?.getString("workgroupId") ?: ""
                            )
                            val workgroupName = android.net.Uri.decode(
                                backStackEntry.arguments?.getString("workgroupName") ?: "Workgroup"
                            )
                            val viewModel = remember(agentId, workgroupId) {
                                WorkgroupChatViewModel(applicationContext, workgroupRepository, relayWebSocket, tokenStore)
                            }

                            WorkgroupChatScreen(
                                agentId = agentId,
                                workgroupId = workgroupId,
                                workgroupName = workgroupName,
                                viewModel = viewModel,
                                onNavigateBack = { navController.popBackStack() }
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
                                    relayWebSocket.setE2EEnabled(enabled)
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
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        appContainer.chatNavigationBus.publishFromIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        appContainer.uiPresenceTracker.setAppInForeground(true)
        if (appContainer.tokenStore.shouldAutoStartRelay()) {
            RelayConnectionService.start(applicationContext)
            lifecycleScope.launch {
                try {
                    appContainer.relayWebSocket.ensureHealthyConnection("activity-start")
                } catch (e: Exception) {
                    CrashLogger.logError("MainActivity", "Failed to restore relay connection on foreground", e)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (appContainer.tokenStore.shouldAutoStartRelay()) {
            lifecycleScope.launch {
                try {
                    appContainer.relayWebSocket.ensureHealthyConnection(
                        reason = "activity-resume",
                        staleTimeoutMs = RESUME_STALE_CONNECTION_TIMEOUT_MS
                    )
                } catch (e: Exception) {
                    CrashLogger.logError("MainActivity", "Failed to verify relay connection on resume", e)
                }
            }
        }
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

    companion object {
        private const val RESUME_STALE_CONNECTION_TIMEOUT_MS = 20_000L
    }
}
