package com.claudecode.remote.service

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.claudecode.remote.ChatNavigationBus
import com.claudecode.remote.MainActivity
import com.claudecode.remote.UiPresenceTracker
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.domain.SessionRepository
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class RelayNotificationHelper(private val context: Context) {
    private val notificationManager = NotificationManagerCompat.from(context)

    fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }

        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                SERVICE_CHANNEL_ID,
                "Connection",
                NotificationManager.IMPORTANCE_LOW
            )
        )
        manager.createNotificationChannel(
            NotificationChannel(
                MESSAGE_CHANNEL_ID,
                "Messages",
                NotificationManager.IMPORTANCE_HIGH
            )
        )
    }

    fun buildServiceNotification(state: RelayWebSocket.ConnectionState) =
        NotificationCompat.Builder(context, SERVICE_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Claude Code Remote")
            .setContentText(
                when (state) {
                    RelayWebSocket.ConnectionState.CONNECTED -> "Connected"
                    RelayWebSocket.ConnectionState.CONNECTING -> "Connecting"
                    RelayWebSocket.ConnectionState.RECONNECTING -> "Reconnecting"
                    RelayWebSocket.ConnectionState.DISCONNECTED -> "Disconnected"
                }
            )
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(buildAppPendingIntent())
            .build()

    @SuppressLint("MissingPermission")
    fun updateServiceNotification(state: RelayWebSocket.ConnectionState) {
        if (!canPostNotifications()) {
            return
        }
        notificationManager.notify(
            SERVICE_NOTIFICATION_ID,
            buildServiceNotification(state)
        )
    }

    @SuppressLint("MissingPermission")
    suspend fun handleEnvelope(
        envelope: Envelope,
        uiPresenceTracker: UiPresenceTracker,
        sessionRepository: SessionRepository
    ) {
        if (envelope.event != Events.MESSAGE_CHUNK) {
            return
        }

        val projectId = envelope.projectId ?: return
        if (uiPresenceTracker.shouldSuppressNotifications(projectId)) {
            return
        }

        val preview = envelope.payload
            ?.jsonObject
            ?.get("content")
            ?.jsonPrimitive
            ?.contentOrNull
            ?.trim()
            .orEmpty()
        if (preview.isEmpty()) {
            return
        }

        if (!canPostNotifications()) {
            return
        }

        val session = sessionRepository.getSessionSnapshot(projectId)
        val pendingIntent = buildChatPendingIntent(
            projectId = projectId,
            projectName = session?.name ?: "Project",
            agentId = session?.agentId.orEmpty()
        )

        notificationManager.notify(
            projectId.hashCode(),
            NotificationCompat.Builder(context, MESSAGE_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle(session?.name?.ifBlank { "Claude Code Remote" } ?: "Claude Code Remote")
                .setContentText(preview)
                .setStyle(NotificationCompat.BigTextStyle().bigText(preview))
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .build()
        )
    }

    private fun buildAppPendingIntent(): PendingIntent =
        PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    private fun buildChatPendingIntent(
        projectId: String,
        projectName: String,
        agentId: String
    ): PendingIntent =
        PendingIntent.getActivity(
            context,
            projectId.hashCode(),
            Intent(context, MainActivity::class.java).apply {
                putExtra(ChatNavigationBus.EXTRA_PROJECT_ID, projectId)
                putExtra(ChatNavigationBus.EXTRA_PROJECT_NAME, projectName)
                putExtra(ChatNavigationBus.EXTRA_AGENT_ID, agentId)
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    private fun canPostNotifications(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED

    companion object {
        const val SERVICE_NOTIFICATION_ID = 1001
        private const val SERVICE_CHANNEL_ID = "relay_connection"
        private const val MESSAGE_CHANNEL_ID = "relay_messages"
    }
}
