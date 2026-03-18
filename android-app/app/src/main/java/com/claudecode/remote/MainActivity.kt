package com.claudecode.remote

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.remember
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.claudecode.remote.data.crypto.E2ECrypto
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.remote.RelayApi
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.domain.MessageRepository
import com.claudecode.remote.domain.SessionRepository
import com.claudecode.remote.ui.chat.ChatScreen
import com.claudecode.remote.ui.chat.ChatViewModel
import com.claudecode.remote.ui.session.SessionListScreen
import com.claudecode.remote.ui.session.SessionViewModel
import com.claudecode.remote.ui.settings.SettingsScreen
import com.claudecode.remote.ui.settings.SettingsState
import com.claudecode.remote.util.CrashLogger
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import retrofit2.Retrofit
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.launch
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Initialize crash logger
        CrashLogger.init(applicationContext)
        CrashLogger.logInfo("MainActivity", "App started")

        // Apply saved language before setting content
        val tempStore = TokenStore(applicationContext)
        val savedLang = tempStore.getLanguage()
        val locale = Locale(savedLang)
        Locale.setDefault(locale)
        val config = resources.configuration
        config.setLocale(locale)
        @Suppress("DEPRECATION")
        resources.updateConfiguration(config, resources.displayMetrics)

        enableEdgeToEdge()
        setContent {
            MaterialTheme {
                val navController = rememberNavController()
                val tokenStore = remember { TokenStore(applicationContext) }
                val serverUrl = remember {
                    tokenStore.getServerUrl() ?: "http://192.168.31.207:8080"
                }
                val e2eCrypto = remember { E2ECrypto() }
                val json = remember {
                    Json { ignoreUnknownKeys = true; encodeDefaults = true }
                }
                val retrofit = remember {
                    Retrofit.Builder()
                        .baseUrl(serverUrl.trimEnd('/') + "/")
                        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
                        .build()
                }
                val relayApi = remember { retrofit.create(RelayApi::class.java) }
                val relayWebSocket = remember { RelayWebSocket(serverUrl, tokenStore) }
                val sessionRepository = remember { SessionRepository(relayApi, tokenStore, applicationContext) }
                val messageRepository = remember { MessageRepository(relayWebSocket, applicationContext) }

                NavHost(navController = navController, startDestination = "sessions") {
                    composable("sessions") {
                        val viewModel = remember {
                            SessionViewModel(sessionRepository)
                        }
                        val sessions by viewModel.sessions.collectAsState(initial = emptyList())

                        SessionListScreen(
                            viewModel = viewModel,
                            webSocket = relayWebSocket,
                            onNavigateToChat = { sessionId ->
                                val session = sessions.firstOrNull { it.id == sessionId }
                                if (session != null) {
                                    val encodedName = android.net.Uri.encode(session.name.ifEmpty { "Project" })
                                    navController.navigate("chat/${session.projectId}/$encodedName")
                                }
                            },
                            onNavigateToSettings = {
                                navController.navigate("settings")
                            }
                        )
                    }
                    composable("chat/{projectId}/{projectName}") { backStackEntry ->
                        val projectId = backStackEntry.arguments?.getString("projectId") ?: ""
                        val projectName = android.net.Uri.decode(
                            backStackEntry.arguments?.getString("projectName") ?: "Project"
                        )

                        CrashLogger.logInfo("MainActivity", "Navigating to chat: projectId=$projectId, projectName=$projectName")

                        if (projectId.isEmpty()) {
                            CrashLogger.logError("MainActivity", "Empty projectId, navigating back")
                            // Navigate back if projectId is invalid
                            LaunchedEffect(Unit) {
                                navController.popBackStack()
                            }
                            return@composable
                        }

                        val viewModel = remember(projectId) {
                            CrashLogger.logInfo("MainActivity", "Creating ChatViewModel for projectId=$projectId")
                            ChatViewModel(messageRepository, relayWebSocket)
                        }
                        ChatScreen(
                            projectId = projectId,
                            projectName = projectName,
                            viewModel = viewModel,
                            onNavigateBack = { navController.popBackStack() }
                        )
                    }
                    composable("settings") {
                        val coroutineScope = rememberCoroutineScope()

                        SettingsScreen(
                            initialState = SettingsState(
                                serverUrl = tokenStore.getServerUrl() ?: "",
                                deviceId = tokenStore.getDeviceId() ?: "",
                                token = tokenStore.getToken() ?: "",
                                username = tokenStore.getUsername() ?: "",
                                e2eEnabled = tokenStore.isE2EEnabled(),
                                e2ePublicKey = e2eCrypto.getPublicKeyBase64(),
                                language = tokenStore.getLanguage(),
                                isLoggedIn = tokenStore.getToken()?.isNotEmpty() == true
                            ),
                            onSave = { url, devId, tok, e2e ->
                                tokenStore.saveServerUrl(url)
                                tokenStore.saveDeviceId(devId)
                                tokenStore.saveToken(tok)
                                tokenStore.saveE2EEnabled(e2e)
                            },
                            onLogin = { url, username, password, deviceId ->
                                tokenStore.saveServerUrl(url)
                                tokenStore.saveDeviceId(deviceId)
                                tokenStore.saveUsername(username)

                                // Call login API
                                coroutineScope.launch {
                                    try {
                                        val response = relayApi.login(
                                            com.claudecode.remote.data.remote.LoginRequest(
                                                username = username,
                                                password = password,
                                                clientType = "device",
                                                clientId = deviceId
                                            )
                                        )
                                        tokenStore.saveToken(response.token)
                                        CrashLogger.logInfo("MainActivity", "Login successful: ${response.user.username}")
                                    } catch (e: Exception) {
                                        CrashLogger.logError("MainActivity", "Login failed", e)
                                    }
                                }
                            },
                            onLanguageChange = { lang ->
                                tokenStore.saveLanguage(lang)
                                val locale = Locale(lang)
                                Locale.setDefault(locale)
                                val config = resources.configuration
                                config.setLocale(locale)
                                @Suppress("DEPRECATION")
                                resources.updateConfiguration(config, resources.displayMetrics)
                                // Recreate to apply
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
