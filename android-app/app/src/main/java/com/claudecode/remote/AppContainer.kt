package com.claudecode.remote

import android.app.Application
import android.content.Context
import android.content.Intent
import com.claudecode.remote.data.crypto.E2ECrypto
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.remote.RelayApi
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.domain.MessageRepository
import com.claudecode.remote.domain.SessionRepository
import com.claudecode.remote.update.AppUpdateManager
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import retrofit2.Retrofit

private const val DEFAULT_SERVER_URL = "http://192.168.31.207:8080"

class RemoteApplication : Application() {
    val appContainer: AppContainer by lazy { AppContainer(this) }
}

class AppContainer(private val appContext: Context) {
    val tokenStore = TokenStore(appContext)
    val e2eCrypto = E2ECrypto()
    val uiPresenceTracker = UiPresenceTracker()
    val chatNavigationBus = ChatNavigationBus()

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Volatile
    private var relayApi = createRelayApi(
        baseUrl = normalizeHttpBaseUrl(tokenStore.getServerUrl() ?: DEFAULT_SERVER_URL),
        json = json
    )

    val relayWebSocket = RelayWebSocket(
        serverUrl = normalizeHttpBaseUrl(tokenStore.getServerUrl() ?: DEFAULT_SERVER_URL),
        tokenStore = tokenStore
    )

    val sessionRepository = SessionRepository(
        relayApiProvider = { relayApi },
        tokenStore = tokenStore,
        context = appContext
    )

    val messageRepository = MessageRepository(
        webSocket = relayWebSocket,
        relayApiProvider = { relayApi },
        tokenStore = tokenStore,
        context = appContext
    )

    val appUpdateManager = AppUpdateManager(
        context = appContext,
        tokenStore = tokenStore,
        relayApiProvider = { relayApi }
    )

    fun updateServerUrl(rawUrl: String) {
        val normalizedUrl = normalizeHttpBaseUrl(rawUrl)
        tokenStore.saveServerUrl(normalizedUrl)
        relayApi = createRelayApi(normalizedUrl, json)
        relayWebSocket.updateServerUrl(normalizedUrl)
    }
}

data class ChatNavigationTarget(
    val projectId: String,
    val projectName: String,
    val agentId: String
)

class ChatNavigationBus {
    private val _target = MutableStateFlow<ChatNavigationTarget?>(null)
    val target: StateFlow<ChatNavigationTarget?> = _target.asStateFlow()

    fun publishFromIntent(intent: Intent?) {
        val projectId = intent?.getStringExtra(EXTRA_PROJECT_ID)?.trim().orEmpty()
        if (projectId.isEmpty()) {
            return
        }

        _target.value = ChatNavigationTarget(
            projectId = projectId,
            projectName = intent?.getStringExtra(EXTRA_PROJECT_NAME)?.trim().orEmpty().ifEmpty { "Project" },
            agentId = intent?.getStringExtra(EXTRA_AGENT_ID)?.trim().orEmpty()
        )
    }

    fun consume(target: ChatNavigationTarget) {
        if (_target.value == target) {
            _target.value = null
        }
    }

    companion object {
        const val EXTRA_PROJECT_ID = "chat_project_id"
        const val EXTRA_PROJECT_NAME = "chat_project_name"
        const val EXTRA_AGENT_ID = "chat_agent_id"
    }
}

class UiPresenceTracker {
    private val _appInForeground = MutableStateFlow(false)
    private val _activeProjectId = MutableStateFlow<String?>(null)

    val appInForeground: StateFlow<Boolean> = _appInForeground.asStateFlow()
    val activeProjectId: StateFlow<String?> = _activeProjectId.asStateFlow()

    fun setAppInForeground(isForeground: Boolean) {
        _appInForeground.value = isForeground
    }

    fun setActiveProject(projectId: String?) {
        _activeProjectId.value = projectId?.takeIf { it.isNotBlank() }
    }

    fun shouldSuppressNotifications(projectId: String): Boolean =
        _appInForeground.value && _activeProjectId.value == projectId
}

fun Context.appContainer(): AppContainer =
    (applicationContext as RemoteApplication).appContainer

fun normalizeHttpBaseUrl(rawUrl: String): String {
    val trimmed = rawUrl.trim().trimEnd('/')
    val normalized = when {
        trimmed.startsWith("ws://") -> "http://${trimmed.removePrefix("ws://")}"
        trimmed.startsWith("wss://") -> "https://${trimmed.removePrefix("wss://")}"
        trimmed.startsWith("http://") || trimmed.startsWith("https://") -> trimmed
        trimmed.isEmpty() -> "http://localhost:8080"
        else -> "http://$trimmed"
    }
    return "$normalized/"
}

fun createRelayApi(baseUrl: String, json: Json): RelayApi =
    Retrofit.Builder()
        .baseUrl(normalizeHttpBaseUrl(baseUrl))
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(RelayApi::class.java)
