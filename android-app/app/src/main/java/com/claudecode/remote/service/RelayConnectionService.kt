package com.claudecode.remote.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.content.ContextCompat
import com.claudecode.remote.appContainer
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
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
                processEnvelope(container, envelope)
            }
        }

        serviceScope.launch {
            container.relayWebSocket.connectionState.collect { state ->
                notificationHelper.updateServiceNotification(state)
                if (state == RelayWebSocket.ConnectionState.CONNECTED) {
                    container.sessionRepository.syncFromServer()
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val token = applicationContext.appContainer().tokenStore.getToken()
        if (token.isNullOrBlank()) {
            stopSelf()
            return START_NOT_STICKY
        }

        serviceScope.launch {
            try {
                applicationContext.appContainer().relayWebSocket.connect()
            } catch (e: Exception) {
                CrashLogger.logError("RelayConnectionService", "Failed to connect WebSocket", e)
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        serviceScope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private suspend fun processEnvelope(
        container: com.claudecode.remote.AppContainer,
        envelope: Envelope
    ) {
        try {
            container.sessionRepository.processEnvelope(envelope)
            container.messageRepository.processEnvelope(envelope)
            notificationHelper.handleEnvelope(
                envelope = envelope,
                uiPresenceTracker = container.uiPresenceTracker,
                sessionRepository = container.sessionRepository
            )
        } catch (e: Exception) {
            CrashLogger.logError(
                "RelayConnectionService",
                "Failed to process envelope event=${envelope.event}",
                e
            )
        }
    }

    companion object {
        fun start(context: Context) {
            val intent = Intent(context, RelayConnectionService::class.java)
            ContextCompat.startForegroundService(context, intent)
        }
    }
}
