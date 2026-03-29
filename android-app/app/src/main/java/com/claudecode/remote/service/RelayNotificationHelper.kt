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
import com.claudecode.remote.data.local.AppDatabase
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.data.remote.RelayWebSocket

class RelayNotificationHelper(private val context: Context) {
    private val notificationManager = NotificationManagerCompat.from(context)
    private val messageDao by lazy { AppDatabase.getInstance(context).messageDao() }

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
            .setContentTitle("AgentFlow")
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
        previousSession: Session?,
        nextSession: Session?
    ) {
        if (!shouldNotifyForCompletion(envelope, previousSession, nextSession)) {
            return
        }

        val projectId = envelope.projectId ?: nextSession?.projectId ?: return
        if (uiPresenceTracker.shouldSuppressNotifications(projectId)) {
            return
        }

        val preview = resolveCompletionPreview(projectId, envelope)
        if (preview.isEmpty()) {
            return
        }

        if (!canPostNotifications()) {
            return
        }

        val pendingIntent = buildChatPendingIntent(
            projectId = projectId,
            projectName = nextSession?.name ?: "Project",
            agentId = nextSession?.agentId.orEmpty()
        )

        notificationManager.notify(
            projectId.hashCode(),
            NotificationCompat.Builder(context, MESSAGE_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle(nextSession?.name?.ifBlank { "AgentFlow" } ?: "AgentFlow")
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

    private fun shouldNotifyForCompletion(
        envelope: Envelope,
        previousSession: Session?,
        nextSession: Session?
    ): Boolean {
        if (envelope.event != Events.MESSAGE_DONE && envelope.event != Events.MESSAGE_ERROR && envelope.event != Events.SESSION_SYNC) {
            return false
        }

        val wasBusy = previousSession?.let { it.isRunning || it.queuedCount > 0 } ?: false
        val isBusy = nextSession?.let { it.isRunning || it.queuedCount > 0 } ?: false
        return wasBusy && !isBusy
    }

    private suspend fun resolveCompletionPreview(projectId: String, envelope: Envelope): String {
        val directPreview = envelope.streamId
            ?.let { streamId -> messageDao.getMessageById(streamId)?.content }
            ?.let(::normalizePreview)
            .orEmpty()
        if (directPreview.isNotEmpty()) {
            return directPreview
        }

        return messageDao.getLatestConversationMessageByProject(projectId)
            ?.content
            ?.let(::normalizePreview)
            .orEmpty()
    }

    private fun normalizePreview(content: String): String {
        val singleLine = content
            .replace("\r", " ")
            .replace("\n", " ")
            .replace(Regex("\\s+"), " ")
            .trim()

        return if (singleLine.length <= 120) {
            singleLine
        } else {
            singleLine.take(117) + "..."
        }
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
