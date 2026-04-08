package com.claudecode.remote.domain

import com.claudecode.remote.data.local.SessionEntity
import com.claudecode.remote.data.remote.ProjectInfo
import com.claudecode.remote.data.remote.SyncKnownProject
import java.security.MessageDigest

internal fun buildKnownProjectsForDelta(sessions: Collection<SessionEntity>): List<SyncKnownProject> =
    sessions
        .asSequence()
        .mapNotNull { session ->
            val projectId = session.projectId.trim()
            if (projectId.isEmpty()) {
                return@mapNotNull null
            }
            SyncKnownProject(
                projectId = projectId,
                signature = buildProjectSyncSignature(session)
            )
        }
        .distinctBy { it.projectId }
        .sortedBy { it.projectId }
        .toList()

internal fun mergeSessionEntityFromProject(
    existing: SessionEntity?,
    project: ProjectInfo,
    fallbackAgentId: String,
    now: Long
): SessionEntity {
    val normalizedProjectId = project.id.trim()
    val resolvedAgentId = project.agentId.ifBlank {
        fallbackAgentId.ifBlank { existing?.agentId.orEmpty() }
    }
    return SessionEntity(
        id = normalizedProjectId,
        name = project.name.ifEmpty { "Project ${normalizedProjectId.take(8)}" },
        agentId = resolvedAgentId,
        projectId = normalizedProjectId,
        projectPath = project.path,
        groupName = project.groupName?.trim().takeUnless { it.isNullOrEmpty() } ?: existing?.groupName,
        cliProvider = project.cliProvider,
        cliModel = project.cliModel,
        isAgentOnline = project.online ?: existing?.isAgentOnline ?: true,
        isRunning = existing?.isRunning ?: false,
        queuedCount = existing?.queuedCount ?: 0,
        currentPrompt = existing?.currentPrompt,
        queuePreview = existing?.queuePreview,
        queueJson = existing?.queueJson,
        currentStartedAt = existing?.currentStartedAt,
        lastSyncSeq = existing?.lastSyncSeq ?: 0,
        activeConversationId = existing?.activeConversationId,
        activeConversationTitle = existing?.activeConversationTitle,
        conversationsJson = existing?.conversationsJson,
        createdAt = existing?.createdAt ?: now,
        lastActiveAt = if (project.online != null) now else (existing?.lastActiveAt ?: now)
    )
}

private fun buildProjectSyncSignature(session: SessionEntity): String =
    sha256Hex(
        listOf(
            session.agentId.trim(),
            session.projectId.trim(),
            session.name.trim(),
            session.projectPath.trim(),
            session.groupName?.trim().orEmpty(),
            session.cliProvider.trim(),
            session.cliModel?.trim().orEmpty(),
            if (session.isAgentOnline) "1" else "0"
        ).joinToString(separator = "\n")
    )

private fun sha256Hex(value: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val bytes = digest.digest(value.toByteArray(Charsets.UTF_8))
    return bytes.joinToString(separator = "") { byte -> "%02x".format(byte) }
}
