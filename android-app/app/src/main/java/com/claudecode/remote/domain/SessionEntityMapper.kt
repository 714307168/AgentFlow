package com.claudecode.remote.domain

import com.claudecode.remote.data.local.SessionEntity
import com.claudecode.remote.data.model.Session

internal fun SessionEntity.toSessionModel(): Session = Session(
    id = id,
    name = name,
    agentId = agentId,
    projectId = projectId,
    projectPath = projectPath,
    groupName = groupName,
    cliProvider = cliProvider,
    cliModel = cliModel,
    isAgentOnline = isAgentOnline,
    isRunning = isRunning,
    queuedCount = queuedCount,
    currentPrompt = currentPrompt,
    queuePreview = queuePreview,
    queueJson = queueJson,
    currentStartedAt = currentStartedAt,
    activeConversationId = activeConversationId,
    activeConversationTitle = activeConversationTitle,
    conversationsJson = conversationsJson,
    snapshotRevision = snapshotRevision,
    projectSignature = projectSignature,
    syncBucket = syncBucket,
    createdAt = createdAt,
    lastActiveAt = lastActiveAt,
    nextBackgroundCheckAfter = nextBackgroundCheckAfter
)
