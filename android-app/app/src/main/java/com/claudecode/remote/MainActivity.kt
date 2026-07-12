package com.claudecode.remote

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import com.claudecode.remote.domain.resolveProjectRouteAccessState
import com.claudecode.remote.service.RelayConnectionService
import com.claudecode.remote.ui.projectAccessNoticeMessageResId
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
import com.claudecode.remote.ui.workgroup.WorkgroupTaskManageScreen
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
    private var lastAutoRelayServiceStartAtMs: Long = 0L

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
        startRelayServiceIfSessionCanResume("app-create")

        enableEdgeToEdge()
        setContent {
            RemoteTheme {
                val navController = rememberNavController()
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
                        authSessionManager = appContainer.authSessionManager,
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
                val settingsRefreshTrigger = remember { mutableStateOf(0) }
                val backStackEntry by navController.currentBackStackEntryAsState()
                val currentDestination = backStackEntry?.destination
                val darkTheme = isSystemInDarkTheme()
                val colorScheme = MaterialTheme.colorScheme
                val bottomNavItems = listOf(
                    BottomNavItem("messages", R.string.nav_messages, Icons.AutoMirrored.Filled.Chat),
                    BottomNavItem("agents", R.string.nav_agents, Icons.Default.Dns),
                    BottomNavItem("settings", R.string.settings_title, Icons.Default.Settings),
                )
                val bottomBarColor = lerp(
                    colorScheme.surface,
                    colorScheme.surfaceVariant,
                    if (darkTheme) 0.18f else 0.12f
                ).copy(alpha = if (darkTheme) 0.98f else 0.97f)
                val bottomBarOutline = colorScheme.outline.copy(alpha = if (darkTheme) 0.9f else 0.72f)
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
                                shape = RoundedCornerShape(14.dp),
                                color = bottomBarColor,
                                tonalElevation = 2.dp,
                                shadowElevation = if (darkTheme) 4.dp else 8.dp,
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
                                                unselectedIconColor = colorScheme.onSurfaceVariant.copy(alpha = if (darkTheme) 0.84f else 0.74f),
                                                unselectedTextColor = colorScheme.onSurfaceVariant.copy(alpha = if (darkTheme) 0.84f else 0.74f),
                                                indicatorColor = lerp(
                                                    colorScheme.primaryContainer,
                                                    colorScheme.tertiaryContainer,
                                                    0.18f
                                                ).copy(alpha = if (darkTheme) 0.78f else 0.9f)
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
                                    lifecycleScope.launch { appUpdateManager.checkForUpdates(manual = true) }
                                },
                                onDownloadUpdate = {
                                    lifecycleScope.launch { appUpdateManager.downloadLatestUpdate() }
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
                                onOpenWorkgroupTasks = { agentId, workgroupId, groupName ->
                                    val encodedAgentId = android.net.Uri.encode(agentId)
                                    val encodedWorkgroupId = android.net.Uri.encode(workgroupId)
                                    val encodedGroupName = android.net.Uri.encode(groupName.ifEmpty { "Workgroup" })
                                    navController.navigate("workgroups/manage/$encodedAgentId/$encodedWorkgroupId/$encodedGroupName")
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
                        composable("workgroups/manage/{agentId}/{workgroupId}/{workgroupName}") { backStackEntry ->
                            val agentId = android.net.Uri.decode(
                                backStackEntry.arguments?.getString("agentId") ?: ""
                            )
                            val workgroupId = android.net.Uri.decode(
                                backStackEntry.arguments?.getString("workgroupId") ?: ""
                            )
                            val workgroupName = android.net.Uri.decode(
                                backStackEntry.arguments?.getString("workgroupName") ?: "Workgroup"
                            )
                            WorkgroupTaskManageScreen(
                                agentId = agentId,
                                workgroupId = workgroupId,
                                workgroupName = workgroupName,
                                viewModel = agentHubViewModel,
                                onNavigateBack = { navController.popBackStack() },
                                onOpenChat = {
                                    val encodedAgentId = android.net.Uri.encode(agentId)
                                    val encodedWorkgroupId = android.net.Uri.encode(workgroupId)
                                    val encodedGroupName = android.net.Uri.encode(workgroupName.ifEmpty { "Workgroup" })
                                    navController.navigate("workgroups/chat/$encodedAgentId/$encodedWorkgroupId/$encodedGroupName")
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
                                onListWorkgroupTransfers = { scopedWorkgroupId ->
                                    appContainer.transferRepository.listRecentTransfers(workgroupId = scopedWorkgroupId)
                                },
                                onDownloadTransfer = { transferId ->
                                    appContainer.transferRepository.downloadTransfer(transferId)
                                },
                                onMarkTransferOpened = { transferId ->
                                    appContainer.transferRepository.markTransferOpened(transferId)
                                },
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
                            val routeAccessState = remember(projectId, agentId) {
                                resolveProjectRouteAccessState(
                                    effectiveScopeJson = tokenStore.getEffectiveScopeJson(),
                                    agentId = agentId,
                                    projectId = projectId
                                )
                            }

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

                            if (routeAccessState.isBlocked) {
                                CrashLogger.logInfo(
                                    "MainActivity",
                                    "Blocked out-of-scope chat route: projectId=$projectId agentId=$agentId"
                                )
                                LaunchedEffect(projectId, agentId) {
                                    tokenStore.clearDraft(projectId)
                                    tokenStore.clearProjectChatSnapshot(projectId)
                                    Toast.makeText(
                                        applicationContext,
                                        getString(projectAccessNoticeMessageResId(routeAccessState.noticeKind)),
                                        Toast.LENGTH_SHORT
                                    ).show()
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
                                onListProjectTransfers = { scopedProjectId ->
                                    appContainer.transferRepository.listRecentTransfers(projectId = scopedProjectId)
                                },
                                onDownloadTransfer = { transferId ->
                                    appContainer.transferRepository.downloadTransfer(transferId)
                                },
                                onMarkTransferOpened = { transferId ->
                                    appContainer.transferRepository.markTransferOpened(transferId)
                                },
                                uiPresenceTracker = appContainer.uiPresenceTracker,
                                onNavigateBack = { navController.popBackStack() }
                            )
                        }
                        composable("settings") {
                            settingsRefreshTrigger.value
                            SettingsScreen(
                                initialState = SettingsState(
                                    serverUrl = tokenStore.getServerUrl() ?: "",
                                    token = tokenStore.getToken() ?: "",
                                    username = tokenStore.getUsername() ?: "",
                                    password = tokenStore.getPassword() ?: "",
                                    e2eEnabled = tokenStore.isE2EEnabled(),
                                    e2ePublicKey = e2eCrypto.getPublicKeyBase64(),
                                    language = tokenStore.getLanguage(),
                                    autoUpdateCheckEnabled = tokenStore.isAutoUpdateCheckEnabled(),
                                    autoUpdateDownloadEnabled = tokenStore.isAutoUpdateDownloadEnabled(),
                                    autoUpdateDownloadWifiOnly = tokenStore.isAutoUpdateDownloadWifiOnly(),
                                    crashLogsEnabled = tokenStore.isCrashLogsEnabled(),
                                    updateState = updateState,
                                    isLoggedIn = tokenStore.hasSavedSession()
                                ),
                                onSaveConnection = { url ->
                                    val normalizedUrl = normalizeHttpBaseUrl(url)
                                    appContainer.updateServerUrl(normalizedUrl)
                                    val deviceId = tokenStore.getOrCreateDeviceId()
                                    settingsRefreshTrigger.value += 1
                                    if (tokenStore.hasSavedSession() && deviceId.isNotBlank()) {
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
                                onAutoUpdateDownloadWifiOnlyChange = { enabled ->
                                    tokenStore.saveAutoUpdateDownloadWifiOnly(enabled)
                                },
                                onCrashLogsEnabledChange = { enabled ->
                                    tokenStore.saveCrashLogsEnabled(enabled)
                                },
                                onLogin = { url, username, password ->
                                    val normalizedUrl = normalizeHttpBaseUrl(url)
                                    appContainer.updateServerUrl(normalizedUrl)
                                    tokenStore.saveCredentials(username.trim(), password)
                                    tokenStore.clearToken()
                                    val deviceId = tokenStore.getOrCreateDeviceId()
                                    settingsRefreshTrigger.value += 1

                                    lifecycleScope.launch {
                                        try {
                                            val response = appContainer.authSessionManager.login(
                                                username = username,
                                                password = password,
                                                clientId = deviceId
                                            ).getOrThrow()
                                            CrashLogger.logInfo("MainActivity", "Login successful: ${response.user.username}")
                                            settingsRefreshTrigger.value += 1

                                            relayWebSocket.disconnect()
                                            RelayConnectionService.start(applicationContext)
                                        } catch (e: Exception) {
                                            CrashLogger.logError("MainActivity", "Login failed", e)
                                        }
                                    }
                                },
                                onUploadCrashLog = { fileName, content ->
                                    val baseUrl = (tokenStore.getServerUrl() ?: "").trim().trimEnd('/')
                                    appContainer.mobileLogRepository.uploadLog(
                                        fileName = fileName,
                                        content = content,
                                        connectionNote = appContainer.relayWebSocket.buildConnectionDiagnosticsNote(
                                            "Uploaded from Android settings diagnostics."
                                        )
                                    ).map { response ->
                                        val uploadId = response.logId?.trim().orEmpty()
                                        val uploadedAt = response.uploadedAt?.trim().orEmpty()
                                        buildString {
                                            append("日志已上传到服务端")
                                            if (uploadId.isNotEmpty()) {
                                                append("，ID: ")
                                                append(uploadId)
                                            }
                                            if (uploadedAt.isNotEmpty()) {
                                                append("，时间: ")
                                                append(uploadedAt)
                                            }
                                            if (baseUrl.isNotEmpty()) {
                                                append("。后台查看路径: ")
                                                append(baseUrl)
                                                append("/admin/mobile-logs")
                                            }
                                        }
                                    }
                                },
                                onListTransfers = {
                                    appContainer.transferRepository.listRecentTransfers()
                                },
                                onDownloadTransfer = { transferId ->
                                    appContainer.transferRepository.downloadTransfer(transferId)
                                },
                                onMarkTransferOpened = { transferId ->
                                    appContainer.transferRepository.markTransferOpened(transferId)
                                },
                                onCheckForUpdates = {
                                    lifecycleScope.launch { appUpdateManager.checkForUpdates(manual = true) }
                                },
                                onDownloadUpdate = {
                                    lifecycleScope.launch { appUpdateManager.downloadLatestUpdate() }
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
    }

    override fun onResume() {
        super.onResume()
        startRelayServiceIfSessionCanResume("app-resume")
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

    private fun startRelayServiceIfSessionCanResume(reason: String) {
        if (!::appContainer.isInitialized || !appContainer.tokenStore.shouldAutoStartRelay()) {
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastAutoRelayServiceStartAtMs < AUTO_RELAY_SERVICE_START_COOLDOWN_MS) {
            return
        }
        lastAutoRelayServiceStartAtMs = now
        CrashLogger.logInfo("MainActivity", "Auto-starting relay connection service reason=$reason")
        RelayConnectionService.start(applicationContext)
    }

    companion object {
        private const val AUTO_RELAY_SERVICE_START_COOLDOWN_MS = 15_000L
    }

}
