package com.claudecode.remote.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.content.ContextCompat
import com.claudecode.remote.appContainer
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class RelayConnectionService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var notificationHelper: RelayNotificationHelper

    override fun onCreate() {
        super.onCreate()
        notificationHelper = RelayNotificationHelper(applicationContext)
        notificationHelper.ensureChannels()
        startForeground(
            RelayNotificationHelper.SERVICE_NOTIFICATION_ID,
            notificationHelper.buildServiceNotification(RelayWebSocket.ConnectionState.DISCONNECTED)
        )

        val container = applicationContext.appContainer()

        serviceScope.launch {
            container.relayWebSocket.incomingEnvelopes.collect { envelope ->
                if (envelope.event == Events.AUTH_OK) {
                    syncAfterAuthentication(container)
                }
                processEnvelope(container, envelope)
            }
        }

        serviceScope.launch {
            container.relayWebSocket.connectionState.collect { state ->
                notificationHelper.updateServiceNotification(state)
            }
        }

        serviceScope.launch {
            container.relayWebSocket.authFailures.collect { reason ->
                val deviceId = container.tokenStore.getDeviceId().orEmpty()
                if (deviceId.isBlank()) {
                    return@collect
                }
                CrashLogger.logInfo(
                    "RelayConnectionService",
                    "Starting auth error recovery reason=$reason"
                )

                container.authSessionManager.ensureValidToken(deviceId, forceRefresh = true)
                    .onSuccess { refreshedToken ->
                        if (refreshedToken.isBlank()) {
                            return@onSuccess
                        }
                        CrashLogger.logInfo(
                            "RelayConnectionService",
                            "Refreshed mobile token after auth error; reconnecting relay reason=$reason"
                        )
                        runCatching {
                            container.relayWebSocket.forceReconnect("auth-error-recovery")
                        }.onFailure { error ->
                            CrashLogger.logError(
                                "RelayConnectionService",
                                "Failed to reconnect relay after auth error recovery",
                                error as? Exception ?: Exception(error)
                            )
                        }
                    }
                    .onFailure { error ->
                        CrashLogger.logError(
                            "RelayConnectionService",
                            "Failed to refresh mobile token after auth error",
                            error as? Exception
                        )
                    }
            }
        }

        serviceScope.launch {
            while (isActive) {
                val nextRefreshDelay = container.authSessionManager.nextRefreshDelayMillis()
                if (nextRefreshDelay == null) {
                    delay(60_000)
                    continue
                }

                delay(nextRefreshDelay)
                val deviceId = container.tokenStore.getDeviceId().orEmpty()
                if (deviceId.isBlank()) {
                    continue
                }

                val previousToken = container.tokenStore.getToken().orEmpty()
                container.authSessionManager.ensureValidToken(deviceId, forceRefresh = true)
                    .onSuccess { refreshedToken ->
                        if (refreshedToken.isNotBlank() && refreshedToken != previousToken) {
                            runCatching {
                                container.relayWebSocket.forceReconnect("token-refresh")
                            }.onFailure { error ->
                                CrashLogger.logError(
                                    "RelayConnectionService",
                                    "Failed to reconnect relay after token refresh",
                                    error as? Exception ?: Exception(error)
                                )
                            }
                        }
                    }
                    .onFailure { error ->
                        CrashLogger.logError(
                            "RelayConnectionService",
                            "Failed to refresh mobile token in background",
                            error as? Exception
                        )
                    }
            }
        }

        serviceScope.launch {
            while (isActive) {
                delay(CONNECTION_HEALTH_CHECK_INTERVAL_MS)
                try {
                    container.relayWebSocket.ensureHealthyConnection("service-loop")
                } catch (e: Exception) {
                    CrashLogger.logError(
                        "RelayConnectionService",
                        "Failed to keep relay connection healthy",
                        e
                    )
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val container = applicationContext.appContainer()

        serviceScope.launch {
            try {
                val deviceId = container.tokenStore.getDeviceId().orEmpty()
                val tokenResult = container.authSessionManager.ensureValidToken(deviceId)
                if (tokenResult.isFailure) {
                    CrashLogger.logError(
                        "RelayConnectionService",
                        "No valid token available for relay connection",
                        tokenResult.exceptionOrNull()
                    )
                    stopSelf()
                    return@launch
                }

                container.relayWebSocket.ensureHealthyConnection("service-start")
            } catch (e: Exception) {
                CrashLogger.logError("RelayConnectionService", "Failed to connect WebSocket", e)
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        applicationContext.appContainer().relayWebSocket.disconnect()
        serviceScope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private suspend fun processEnvelope(
        container: com.claudecode.remote.AppContainer,
        envelope: Envelope
    ) {
        try {
            val previousSession = envelope.projectId?.let { projectId ->
                container.sessionRepository.getSessionSnapshot(projectId)
            }
            container.sessionRepository.processEnvelope(envelope)
            container.messageRepository.processEnvelope(envelope)
            container.workgroupRepository.processEnvelope(envelope)
            val nextSession = envelope.projectId?.let { projectId ->
                container.sessionRepository.getSessionSnapshot(projectId)
            }
            notificationHelper.handleEnvelope(
                envelope = envelope,
                uiPresenceTracker = container.uiPresenceTracker,
                previousSession = previousSession,
                nextSession = nextSession
            )
        } catch (e: Exception) {
            CrashLogger.logError(
                "RelayConnectionService",
                "Failed to process envelope event=${envelope.event}",
                e
            )
        }
    }

    private suspend fun syncAfterAuthentication(container: com.claudecode.remote.AppContainer) {
        CrashLogger.logInfo("RelayConnectionService", "Starting post-auth session sync")
        runCatching {
            val syncResult = container.sessionRepository.syncFromServer(force = true)
            syncResult.getOrThrow()
            val sessions = container.sessionRepository.getSessions()
            CrashLogger.logInfo(
                "RelayConnectionService",
                "Post-auth session catalog refreshed sessionCount=${sessions.size}"
            )
            container.messageRepository.requestSessionShellSyncs(
                sessions = sessions,
                bypassDedupe = true
            )
            CrashLogger.logInfo(
                "RelayConnectionService",
                "Requested session-shell syncs after relay authentication sessionCount=${sessions.size}"
            )
            val trackedAgentIds = container.workgroupRepository.resolveTrackedAgentIds(
                sessions.map { it.agentId.trim() }.filter { it.isNotEmpty() }.distinct().sorted()
            )
            if (trackedAgentIds.isEmpty()) {
                container.workgroupRepository.retainAgentIds(emptyList())
            } else {
                container.workgroupRepository.refresh(trackedAgentIds, force = true)
            }
            CrashLogger.logInfo(
                "RelayConnectionService",
                "Completed post-auth workgroup refresh trackedAgentCount=${trackedAgentIds.size}"
            )
        }.onFailure { error ->
            CrashLogger.logError(
                "RelayConnectionService",
                "Failed to sync sessions after relay authentication",
                error as? Exception ?: Exception(error)
            )
        }
    }

    companion object {
        private const val CONNECTION_HEALTH_CHECK_INTERVAL_MS = 45_000L

        fun start(context: Context) {
            val intent = Intent(context, RelayConnectionService::class.java)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, RelayConnectionService::class.java)
            context.stopService(intent)
        }
    }
}
