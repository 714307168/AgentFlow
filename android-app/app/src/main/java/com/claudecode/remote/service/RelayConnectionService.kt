package com.claudecode.remote.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.content.ContextCompat
import com.claudecode.remote.appContainer
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.domain.AuthenticatedRelayFollowUpPass
import com.claudecode.remote.domain.buildAuthenticatedRelayFollowUpPasses
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.ConcurrentHashMap

class RelayConnectionService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var notificationHelper: RelayNotificationHelper
    private val authFollowUpJobs = mutableSetOf<Job>()
    private val sessionChangedSyncJobs = ConcurrentHashMap<String, Job>()

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
                    schedulePostAuthFollowUpSyncs(container, "relay-authenticated")
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
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        clearAuthFollowUpJobs()
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
            if (envelope.event == Events.SESSION_CHANGED) {
                scheduleSessionChangedSync(container, envelope)
            }
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

    private fun schedulePostAuthFollowUpSyncs(
        container: com.claudecode.remote.AppContainer,
        baseReason: String
    ) {
        clearAuthFollowUpJobs()
        val passes = buildAuthenticatedRelayFollowUpPasses(
            baseReason = baseReason,
            delaysMs = AUTHENTICATED_FOLLOW_UP_DELAYS_MS
        )
        CrashLogger.logInfo(
            "RelayConnectionService",
            "Scheduling post-auth follow-up passes reason=$baseReason passCount=${passes.size}"
        )
        passes.forEach { pass ->
            val job = serviceScope.launch {
                if (pass.delayMs > 0L) {
                    delay(pass.delayMs)
                }
                runPostAuthFollowUpPass(container, pass)
            }
            authFollowUpJobs += job
            job.invokeOnCompletion {
                authFollowUpJobs.remove(job)
            }
        }
    }

    private fun scheduleSessionChangedSync(
        container: com.claudecode.remote.AppContainer,
        envelope: Envelope
    ) {
        val projectId = envelope.projectId?.trim().takeUnless { it.isNullOrEmpty() } ?: return
        sessionChangedSyncJobs.remove(projectId)?.cancel()
        val syncJob = serviceScope.launch {
            delay(SESSION_CHANGED_SYNC_DEBOUNCE_MS)
            runCatching {
                val session = container.sessionRepository.getSessionSnapshot(projectId)
                if (session == null) {
                    CrashLogger.logInfo(
                        "RelayConnectionService",
                        "Ignoring session.changed for unknown projectId=$projectId"
                    )
                    return@runCatching
                }
                container.messageRepository.requestProjectSync(
                    projectId = projectId,
                    agentId = resolveSessionChangedAgentId(envelope) ?: session.agentId,
                    limit = SESSION_CHANGED_SYNC_LIMIT,
                    recentOverlapCount = SESSION_CHANGED_SYNC_OVERLAP_COUNT,
                    shouldWakeAgent = false,
                    bypassDedupe = true
                )
                CrashLogger.logInfo(
                    "RelayConnectionService",
                    "Requested project sync from session.changed projectId=$projectId reason=${resolveSessionChangedReason(envelope)}"
                )
            }.onFailure { error ->
                CrashLogger.logError(
                    "RelayConnectionService",
                    "Failed to request project sync from session.changed projectId=$projectId",
                    error as? Exception ?: Exception(error)
                )
            }
        }
        sessionChangedSyncJobs[projectId] = syncJob
        syncJob.invokeOnCompletion {
            sessionChangedSyncJobs.remove(projectId, syncJob)
        }
    }

    private fun resolveSessionChangedAgentId(envelope: Envelope): String? =
        envelope.agentId?.trim().takeUnless { it.isNullOrEmpty() }
            ?: envelope.payload?.jsonObject
                ?.get("agent_id")
                ?.jsonPrimitive
                ?.contentOrNull
                ?.trim()
                ?.takeIf { it.isNotEmpty() }

    private fun resolveSessionChangedReason(envelope: Envelope): String =
        envelope.payload?.jsonObject
            ?.get("reason")
            ?.jsonPrimitive
            ?.contentOrNull
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?: "unknown"

    private fun clearAuthFollowUpJobs() {
        authFollowUpJobs.forEach { job -> job.cancel() }
        authFollowUpJobs.clear()
    }

    private suspend fun runPostAuthFollowUpPass(
        container: com.claudecode.remote.AppContainer,
        pass: AuthenticatedRelayFollowUpPass
    ) {
        CrashLogger.logInfo(
            "RelayConnectionService",
            "Running post-auth follow-up pass reason=${pass.reason} stage=${pass.stage.wireName} forceSessionSync=${pass.forceSessionSync} requestSessionShellSync=${pass.requestSessionShellSync} forceWorkgroupRefresh=${pass.forceWorkgroupRefresh}"
        )
        runCatching {
            val syncResult = container.sessionRepository.syncFromServer(force = pass.forceSessionSync)
            syncResult.getOrThrow()
            val sessions = container.sessionRepository.getSessions()
            CrashLogger.logInfo(
                "RelayConnectionService",
                "Post-auth session catalog refreshed reason=${pass.reason} sessionCount=${sessions.size}"
            )
            if (pass.requestSessionShellSync) {
                container.messageRepository.requestSessionShellSyncs(
                    sessions = sessions,
                    bypassDedupe = true
                )
                CrashLogger.logInfo(
                    "RelayConnectionService",
                    "Requested session-shell syncs after relay authentication reason=${pass.reason} sessionCount=${sessions.size}"
                )
            }
            val trackedAgentIds = container.workgroupRepository.resolveTrackedAgentIds(
                sessions.map { it.agentId.trim() }.filter { it.isNotEmpty() }.distinct().sorted()
            )
            if (trackedAgentIds.isEmpty()) {
                container.workgroupRepository.retainAgentIds(emptyList())
            } else {
                container.workgroupRepository.refresh(
                    trackedAgentIds,
                    force = pass.forceWorkgroupRefresh
                )
            }
            CrashLogger.logInfo(
                "RelayConnectionService",
                "Completed post-auth workgroup refresh reason=${pass.reason} trackedAgentCount=${trackedAgentIds.size}"
            )
        }.onFailure { error ->
            CrashLogger.logError(
                "RelayConnectionService",
                "Failed to run post-auth follow-up pass reason=${pass.reason}",
                error as? Exception ?: Exception(error)
            )
        }
    }

    companion object {
        private const val TAG = "RelayConnectionService"
        private const val CONNECTION_HEALTH_CHECK_INTERVAL_MS = 45_000L
        private const val SESSION_CHANGED_SYNC_DEBOUNCE_MS = 250L
        private const val SESSION_CHANGED_SYNC_LIMIT = 48
        private const val SESSION_CHANGED_SYNC_OVERLAP_COUNT = 10
        private val AUTHENTICATED_FOLLOW_UP_DELAYS_MS = longArrayOf(300L, 1_500L, 5_000L)

        fun start(context: Context) {
            val intent = Intent(context, RelayConnectionService::class.java)
            runCatching {
                ContextCompat.startForegroundService(context, intent)
            }.onFailure { error ->
                Log.e(TAG, "Failed to start relay foreground service", error)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, RelayConnectionService::class.java)
            runCatching {
                context.stopService(intent)
            }.onFailure { error ->
                Log.e(TAG, "Failed to stop relay foreground service", error)
            }
        }
    }
}
