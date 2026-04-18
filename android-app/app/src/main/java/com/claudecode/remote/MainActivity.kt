package com.claudecode.remote

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
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
import com.claudecode.remote.domain.isProjectRouteBlockedByCachedScope
import com.claudecode.remote.domain.ForegroundConnectionRecoveryAction
import com.claudecode.remote.domain.ForegroundRecoveryPass
import com.claudecode.remote.domain.buildForegroundRecoveryPasses
import com.claudecode.remote.domain.decideForegroundConnectionRecovery
import com.claudecode.remote.domain.shouldScheduleNetworkRecovery
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
import com.claudecode.remote.ui.workgroup.WorkgroupTaskManageScreen
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

private data class BottomNavItem(
    val route: String,
    val labelResId: Int,
    val icon: androidx.compose.ui.graphics.vector.ImageVector
)

class MainActivity : ComponentActivity() {
    private lateinit var appContainer: AppContainer
    private var lastStoppedAtMs: Long = 0L
    private var lastNetworkRecoveryScheduledAtMs: Long = 0L
    private var networkRecoveryCallback: ConnectivityManager.NetworkCallback? = null
    private val foregroundRecoveryJobs = mutableSetOf<Job>()

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
                            val isBlockedByCachedScope = remember(projectId, agentId) {
                                isProjectRouteBlockedByCachedScope(
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

                            if (isBlockedByCachedScope) {
                                CrashLogger.logInfo(
                                    "MainActivity",
                                    "Blocked out-of-scope chat route: projectId=$projectId agentId=$agentId"
                                )
                                LaunchedEffect(projectId, agentId) {
                                    tokenStore.clearDraft(projectId)
                                    tokenStore.clearProjectChatSnapshot(projectId)
                                    Toast.makeText(
                                        applicationContext,
                                        getString(R.string.chat_project_access_revoked),
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

                                    lifecycleScope.launch {
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
        if (appContainer.tokenStore.shouldAutoStartRelay()) {
            RelayConnectionService.start(applicationContext)
        }
        registerNetworkRecoveryCallbackIfNeeded()
    }

    override fun onResume() {
        super.onResume()
        if (appContainer.tokenStore.shouldAutoStartRelay()) {
            val now = System.currentTimeMillis()
            val shouldForceReconnect = lastStoppedAtMs > 0L &&
                now - lastStoppedAtMs >= FOREGROUND_FORCE_RECONNECT_THRESHOLD_MS
            scheduleForegroundRecoveryPasses("activity-resume", shouldForceReconnect)
        }
    }

    override fun onStop() {
        appContainer.uiPresenceTracker.setAppInForeground(false)
        lastStoppedAtMs = System.currentTimeMillis()
        unregisterNetworkRecoveryCallback()
        clearForegroundRecoveryJobs()
        super.onStop()
    }

    private fun clearForegroundRecoveryJobs() {
        foregroundRecoveryJobs.forEach { job -> job.cancel() }
        foregroundRecoveryJobs.clear()
    }

    private fun scheduleForegroundRecoveryPasses(reason: String, forceReconnectInitial: Boolean) {
        clearForegroundRecoveryJobs()
        val passes = buildForegroundRecoveryPasses(
            baseReason = reason,
            delaysMs = FOREGROUND_RECOVERY_DELAYS_MS,
            forceReconnectInitial = forceReconnectInitial
        )
        CrashLogger.logInfo(
            "MainActivity",
            "Scheduling foreground recovery passes reason=$reason forceReconnectInitial=$forceReconnectInitial passCount=${passes.size}"
        )
        passes.forEach { pass ->
            val job = lifecycleScope.launch {
                if (pass.delayMs > 0L) {
                    delay(pass.delayMs)
                }
                CrashLogger.logInfo(
                    "MainActivity",
                    "Running foreground recovery pass reason=${pass.reason} stage=${pass.stage.wireName} forceReconnect=${pass.forceReconnect}"
                )
                try {
                    restoreRelayConnectionOnForeground(
                        pass = pass,
                        staleTimeoutMs = RESUME_STALE_CONNECTION_TIMEOUT_MS
                    )
                    syncForegroundData(pass)
                } catch (e: Exception) {
                    CrashLogger.logError("MainActivity", "Failed to verify relay connection on resume", e)
                }
            }
            foregroundRecoveryJobs += job
            job.invokeOnCompletion {
                foregroundRecoveryJobs.remove(job)
            }
        }
    }

    private fun registerNetworkRecoveryCallbackIfNeeded() {
        if (networkRecoveryCallback != null) {
            return
        }
        val connectivityManager = getSystemService(ConnectivityManager::class.java) ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (!appContainer.tokenStore.shouldAutoStartRelay()) {
                    return
                }
                val now = System.currentTimeMillis()
                if (!shouldScheduleNetworkRecovery(
                        nowMs = now,
                        lastScheduledAtMs = lastNetworkRecoveryScheduledAtMs,
                        minIntervalMs = NETWORK_RECOVERY_MIN_INTERVAL_MS
                    )
                ) {
                    return
                }
                lastNetworkRecoveryScheduledAtMs = now
                CrashLogger.logInfo(
                    "MainActivity",
                    "Network became available; scheduling recovery network=$network"
                )
                lifecycleScope.launch {
                    scheduleForegroundRecoveryPasses("network-available", forceReconnectInitial = false)
                }
            }
        }
        runCatching {
            connectivityManager.registerDefaultNetworkCallback(callback)
            networkRecoveryCallback = callback
        }.onFailure { error ->
            CrashLogger.logError(
                "MainActivity",
                "Failed to register network recovery callback",
                error as? Exception ?: Exception(error)
            )
        }
    }

    private fun unregisterNetworkRecoveryCallback() {
        val callback = networkRecoveryCallback ?: return
        val connectivityManager = getSystemService(ConnectivityManager::class.java) ?: run {
            networkRecoveryCallback = null
            return
        }
        runCatching {
            connectivityManager.unregisterNetworkCallback(callback)
        }.onFailure { error ->
            CrashLogger.logError(
                "MainActivity",
                "Failed to unregister network recovery callback",
                error as? Exception ?: Exception(error)
            )
        }
        networkRecoveryCallback = null
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

    private suspend fun restoreRelayConnectionOnForeground(
        pass: ForegroundRecoveryPass,
        staleTimeoutMs: Long
    ) {
        val tokenStore = appContainer.tokenStore
        val deviceId = tokenStore.getDeviceId()?.trim().orEmpty()
        if (deviceId.isEmpty()) {
            return
        }

        val previousToken = tokenStore.getToken()?.trim().orEmpty()
        var tokenChanged = false
        if (tokenStore.hasSavedCredentials()) {
            val shouldRefreshToken = pass.forceReconnect ||
                previousToken.isBlank() ||
                appContainer.authSessionManager.isTokenExpiringSoon()
            appContainer.authSessionManager.ensureValidToken(
                clientId = deviceId,
                forceRefresh = shouldRefreshToken
            ).onSuccess { refreshedToken ->
                val normalizedToken = refreshedToken.trim()
                tokenChanged = normalizedToken.isNotEmpty() && normalizedToken != previousToken
            }.onFailure { error ->
                CrashLogger.logError(
                    "MainActivity",
                    "Failed to refresh relay token on foreground restore",
                    error as? Exception ?: Exception(error)
                )
            }
        }

        val decision = decideForegroundConnectionRecovery(
            pass = pass,
            tokenChanged = tokenChanged
        )
        if (decision.action == ForegroundConnectionRecoveryAction.FORCE_RECONNECT) {
            CrashLogger.logInfo(
                "MainActivity",
                "Foreground relay recovery forcing reconnect reason=${decision.reason} stage=${pass.stage.wireName} tokenChanged=$tokenChanged"
            )
            appContainer.relayWebSocket.forceReconnect(decision.reason)
            return
        }

        appContainer.relayWebSocket.ensureHealthyConnection(
            reason = decision.reason,
            staleTimeoutMs = staleTimeoutMs
        )
    }

    private suspend fun syncForegroundData(pass: ForegroundRecoveryPass) {
        val sessionRepository = appContainer.sessionRepository
        val messageRepository = appContainer.messageRepository
        val workgroupRepository = appContainer.workgroupRepository
        val webSocket = appContainer.relayWebSocket
        val reason = pass.reason
        CrashLogger.logInfo("MainActivity", "Starting foreground sync reason=$reason")

        val syncResult = sessionRepository.syncFromServer(force = true)
        syncResult.onFailure { error ->
            CrashLogger.logError(
                "MainActivity",
                "Failed to refresh session catalog on foreground: $reason",
                error as? Exception ?: Exception(error)
            )
        }
        syncResult.onSuccess {
            CrashLogger.logInfo(
                "MainActivity",
                "Foreground session catalog refreshed reason=$reason sessionCount=${sessionRepository.getSessions().size}"
            )
        }

        val sessions = sessionRepository.getSessions()
        if (sessions.isEmpty()) {
            CrashLogger.logInfo("MainActivity", "Foreground sync found no sessions reason=$reason")
            workgroupRepository.retainAgentIds(emptyList())
            return
        }

        var waitedMs = 0L
        while (waitedMs < FOREGROUND_SYNC_CONNECTION_WAIT_MS) {
            if (webSocket.connectionState.value == com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.CONNECTED) {
                break
            }
            delay(500)
            waitedMs += 500L
        }

        if (webSocket.connectionState.value != com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.CONNECTED) {
            CrashLogger.logInfo("MainActivity", "Skipping foreground project sync because relay is not connected: $reason")
            return
        }

        runCatching {
            messageRepository.requestSessionShellSyncs(
                sessions = sessions,
                bypassDedupe = true
            )
        }.onSuccess {
            CrashLogger.logInfo(
                "MainActivity",
                "Foreground session-shell sync requested reason=$reason sessionCount=${sessions.size}"
            )
        }.onFailure { error ->
            CrashLogger.logError(
                "MainActivity",
                "Failed to request session-shell syncs on foreground: $reason",
                error as? Exception ?: Exception(error)
            )
        }

        val trackedAgentIds = workgroupRepository.resolveTrackedAgentIds(
            sessions.map { it.agentId.trim() }.filter { it.isNotEmpty() }.distinct().sorted()
        )
        runCatching {
            if (trackedAgentIds.isEmpty()) {
                workgroupRepository.retainAgentIds(emptyList())
            } else {
                workgroupRepository.refresh(trackedAgentIds, force = true)
            }
        }.onSuccess {
            CrashLogger.logInfo(
                "MainActivity",
                "Foreground workgroup refresh completed reason=$reason trackedAgentCount=${trackedAgentIds.size}"
            )
        }.onFailure { error ->
            CrashLogger.logError(
                "MainActivity",
                "Failed to refresh workgroups on foreground: $reason",
                error as? Exception ?: Exception(error)
            )
        }
    }

    companion object {
        private const val RESUME_STALE_CONNECTION_TIMEOUT_MS = 20_000L
        private const val FOREGROUND_FORCE_RECONNECT_THRESHOLD_MS = 30_000L
        private const val FOREGROUND_SYNC_CONNECTION_WAIT_MS = 6_000L
        private const val NETWORK_RECOVERY_MIN_INTERVAL_MS = 4_000L
        private val FOREGROUND_RECOVERY_DELAYS_MS = longArrayOf(0L, 1_500L, 5_000L)
    }
}
