package com.claudecode.remote.domain

import com.claudecode.remote.data.model.AgentWorkgroups
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.model.Workgroup
import com.claudecode.remote.data.model.WorkgroupMember
import com.claudecode.remote.data.model.WorkgroupMessage
import com.claudecode.remote.data.model.WorkgroupTask
import com.claudecode.remote.data.model.WorkgroupTaskDependency
import com.claudecode.remote.data.model.WorkgroupTaskDraftProposal
import com.claudecode.remote.data.model.WorkgroupTaskPlanDraft
import com.claudecode.remote.data.model.WorkgroupRegistryEntry
import com.claudecode.remote.data.model.WorkgroupExecutionRequest
import com.claudecode.remote.data.model.WorkgroupSession
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.remote.AuthSessionManager
import com.claudecode.remote.data.remote.JoinWorkgroupRegistryRequest
import com.claudecode.remote.data.remote.DecideWorkgroupExecutionRequest
import com.claudecode.remote.data.remote.WorkgroupExecutionRequestRecord
import com.claudecode.remote.data.remote.RelayApi
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.data.remote.WakeupRequest
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class WorkgroupRepository(
    private val webSocket: RelayWebSocket,
    private val relayApiProvider: () -> RelayApi,
    private val authSessionManager: AuthSessionManager,
    private val tokenStore: TokenStore
) {
    companion object {
        private const val REQUEST_TIMEOUT_MS = 30_000L
        private const val MESSAGE_REQUEST_TIMEOUT_MS = 20_000L
        private const val DEFAULT_PAGE_SIZE = 30
        private const val KNOWN_ITEM_LIMIT = 60
        private const val LIST_REQUEST_DEDUPE_WINDOW_MS = 2_000L
        private const val SESSION_REQUEST_DEDUPE_WINDOW_MS = 1_200L
        private const val WAKEUP_THROTTLE_WINDOW_MS = 10_000L
        private const val SEND_STALE_CONNECTION_TIMEOUT_MS = 12_000L
        private const val SEND_READY_WAIT_TIMEOUT_MS = 8_000L
        private const val SEND_READY_POLL_MS = 200L
        private const val MAX_SEND_RETRY_COUNT = 1
    }

    private data class SessionResponse(
        val agentId: String,
        val session: WorkgroupSession
    )

    private val _agentWorkgroups = MutableStateFlow<List<AgentWorkgroups>>(emptyList())
    val agentWorkgroups: StateFlow<List<AgentWorkgroups>> = _agentWorkgroups.asStateFlow()

    private val _sessions = MutableStateFlow<Map<String, WorkgroupSession>>(emptyMap())
    val sessions: StateFlow<Map<String, WorkgroupSession>> = _sessions.asStateFlow()
    private val _registryResults = MutableStateFlow<List<WorkgroupRegistryEntry>>(emptyList())
    val registryResults: StateFlow<List<WorkgroupRegistryEntry>> = _registryResults.asStateFlow()
    private var myRegistryEntries: List<WorkgroupRegistryEntry> = emptyList()

    private val pendingSessionRequests = ConcurrentHashMap<String, CompletableDeferred<Result<SessionResponse>>>()
    private val pendingSendRequests = ConcurrentHashMap<String, CompletableDeferred<Result<String>>>()
    private val pendingCommandRequests = ConcurrentHashMap<String, CompletableDeferred<Result<Unit>>>()
    private val inFlightSessionRequests = ConcurrentHashMap<String, CompletableDeferred<Result<Unit>>>()
    private val agentWorkgroupPayloadRevisions = ConcurrentHashMap<String, String>()
    private val lastListRequestedAtByAgent = ConcurrentHashMap<String, Long>()
    private val lastSessionRequestedAt = ConcurrentHashMap<String, Long>()
    private val lastWakeupRequestedAt = ConcurrentHashMap<String, Long>()

    private suspend fun ensureSocketReady(agentId: String, reason: String) {
        webSocket.ensureHealthyConnection(
            reason = "$reason:$agentId",
            staleTimeoutMs = SEND_STALE_CONNECTION_TIMEOUT_MS
        )
        wakeupAgent(agentId)
        waitForRelayReady("$reason:$agentId")
    }

    private suspend fun waitForRelayReady(reason: String) {
        var waitedMs = 0L
        while (waitedMs < SEND_READY_WAIT_TIMEOUT_MS) {
            if (webSocket.isReadyForTraffic()) {
                return
            }
            delay(SEND_READY_POLL_MS)
            waitedMs += SEND_READY_POLL_MS
        }
        if (!webSocket.isReadyForTraffic()) {
            throw IllegalStateException("Relay connection is not ready for $reason")
        }
    }

    suspend fun refresh(agentIds: List<String>, force: Boolean = false) {
        refreshMyRegistry()
        val normalizedAgentIds = resolveTrackedAgentIds(agentIds)
        retainAgentIds(normalizedAgentIds)

        normalizedAgentIds.forEach { agentId ->
            val now = System.currentTimeMillis()
            val lastRequestedAt = lastListRequestedAtByAgent[agentId]
            if (!force && lastRequestedAt != null && now - lastRequestedAt < LIST_REQUEST_DEDUPE_WINDOW_MS) {
                return@forEach
            }
            lastListRequestedAtByAgent[agentId] = now
            ensureSocketReady(agentId, "workgroup-refresh")
            val knownRevision = agentWorkgroupPayloadRevisions[agentId]?.trim().orEmpty()
            webSocket.send(
                Envelope(
                    id = UUID.randomUUID().toString(),
                    event = Events.WORKGROUP_LIST_REQUEST,
                    agentId = agentId,
                    payload = JsonObject(buildMap {
                        put("agent_id", JsonPrimitive(agentId))
                        if (knownRevision.isNotEmpty()) {
                            put("revision", JsonPrimitive(knownRevision))
                        }
                    }),
                    ts = System.currentTimeMillis()
                ),
                targetAgentId = agentId
            )
        }
    }

    fun retainAgentIds(agentIds: List<String>) {
        val allowed = normalizeAgentIds(agentIds).toSet()
        _agentWorkgroups.value = if (allowed.isEmpty()) {
            emptyList()
        } else {
            _agentWorkgroups.value.filter { it.agentId in allowed }
        }
        agentWorkgroupPayloadRevisions.keys.removeIf { it !in allowed }
        _sessions.value = if (allowed.isEmpty()) {
            emptyMap()
        } else {
            _sessions.value.filterKeys { key ->
                sessionKeyAgentId(key) in allowed
            }
        }
    }

    suspend fun requestSession(
        agentId: String,
        workgroupId: String,
        beforeId: String? = null,
        limit: Int = DEFAULT_PAGE_SIZE,
        bypassDedupe: Boolean = false
    ): Result<Unit> {
        val normalizedAgentId = agentId.trim()
        val normalizedWorkgroupId = workgroupId.trim()
        if (normalizedAgentId.isEmpty() || normalizedWorkgroupId.isEmpty()) {
            return Result.failure(IllegalArgumentException("agentId and workgroupId are required"))
        }

        val dedupeKey = sessionRequestKey(
            agentId = normalizedAgentId,
            workgroupId = normalizedWorkgroupId,
            beforeId = beforeId,
            limit = limit
        )
        val now = System.currentTimeMillis()
        val lastRequestedAt = lastSessionRequestedAt[dedupeKey]
        if (!bypassDedupe &&
            beforeId.isNullOrBlank() &&
            lastRequestedAt != null &&
            now - lastRequestedAt < SESSION_REQUEST_DEDUPE_WINDOW_MS &&
            getSession(normalizedAgentId, normalizedWorkgroupId) != null
        ) {
            return Result.success(Unit)
        }
        lastSessionRequestedAt[dedupeKey] = now

        val singleFlight = CompletableDeferred<Result<Unit>>()
        val existingSingleFlight = inFlightSessionRequests.putIfAbsent(dedupeKey, singleFlight)
        if (existingSingleFlight != null) {
            return existingSingleFlight.await()
        }

        var requestId: String? = null
        val result = try {
            requestId = UUID.randomUUID().toString()
            val deferred = CompletableDeferred<Result<SessionResponse>>()
            pendingSessionRequests[requestId] = deferred

            ensureSocketReady(normalizedAgentId, "workgroup-session")
            webSocket.send(
                Envelope(
                    id = requestId,
                    event = Events.WORKGROUP_COLLABORATION_SESSION_REQUEST,
                    agentId = normalizedAgentId,
                    payload = JsonObject(buildMap {
                        put("agent_id", JsonPrimitive(normalizedAgentId))
                        put("workgroup_id", JsonPrimitive(normalizedWorkgroupId))
                        beforeId?.trim()?.takeIf { it.isNotEmpty() }?.let {
                            put("before_id", JsonPrimitive(it))
                        }
                        put("limit", JsonPrimitive(limit))
                        if (beforeId.isNullOrBlank()) {
                            getSession(normalizedAgentId, normalizedWorkgroupId)
                                ?.snapshotRevision
                                ?.trim()
                                ?.takeIf { it.isNotEmpty() }
                                ?.let { put("snapshot_revision", JsonPrimitive(it)) }
                        }
                        val knownItems = buildKnownItems(
                            agentId = normalizedAgentId,
                            workgroupId = normalizedWorkgroupId,
                            beforeId = beforeId,
                            limit = limit
                        )
                        if (knownItems.isNotEmpty()) {
                            put("known_items", kotlinx.serialization.json.JsonArray(knownItems))
                        }
                    }),
                    ts = System.currentTimeMillis()
                ),
                targetAgentId = normalizedAgentId
            )

            withTimeout(REQUEST_TIMEOUT_MS) {
                deferred.await().map { Unit }
            }
        } catch (error: Exception) {
            requestId?.let { pendingSessionRequests.remove(it) }
            lastSessionRequestedAt.remove(dedupeKey, now)
            Result.failure(error)
        }

        singleFlight.complete(result)
        inFlightSessionRequests.remove(dedupeKey, singleFlight)
        return result
    }

    suspend fun sendMessage(
        agentId: String,
        workgroupId: String,
        content: String,
        clientMessageId: String? = null,
        retryCount: Int = 0
    ): Result<String> {
        val normalizedAgentId = agentId.trim()
        val normalizedWorkgroupId = workgroupId.trim()
        val normalizedContent = content.trim()
        if (normalizedAgentId.isEmpty() || normalizedWorkgroupId.isEmpty()) {
            return Result.failure(IllegalArgumentException("agentId and workgroupId are required"))
        }
        if (normalizedContent.isEmpty()) {
            return Result.failure(IllegalArgumentException("content is required"))
        }

        val stableClientMessageId = clientMessageId?.trim().takeUnless { it.isNullOrEmpty() }
            ?: UUID.randomUUID().toString()
        val requestId = UUID.randomUUID().toString()
        val deferred = CompletableDeferred<Result<String>>()
        pendingSendRequests[requestId] = deferred

        CrashLogger.logInfo(
            "WorkgroupRepository",
            "Sending workgroup message request agentId=$normalizedAgentId workgroupId=$normalizedWorkgroupId requestId=$requestId clientMessageId=$stableClientMessageId retryCount=$retryCount"
        )
        ensureSocketReady(normalizedAgentId, "workgroup-send")
        webSocket.send(
            Envelope(
                id = requestId,
                event = Events.WORKGROUP_COLLABORATION_MESSAGE_SEND,
                agentId = normalizedAgentId,
                payload = JsonObject(
                    buildMap {
                        put("agent_id", JsonPrimitive(normalizedAgentId))
                        put("workgroup_id", JsonPrimitive(normalizedWorkgroupId))
                        put("content", JsonPrimitive(content))
                        put("client_message_id", JsonPrimitive(stableClientMessageId))
                    }
                ),
                ts = System.currentTimeMillis()
            ),
            targetAgentId = normalizedAgentId
        )

        return try {
            withTimeout(MESSAGE_REQUEST_TIMEOUT_MS) { deferred.await() }
        } catch (error: Exception) {
            pendingSendRequests.remove(requestId)
            CrashLogger.logWarn(
                "WorkgroupRepository",
                "Timed out waiting for workgroup message acknowledgement agentId=$normalizedAgentId workgroupId=$normalizedWorkgroupId requestId=$requestId clientMessageId=$stableClientMessageId retryCount=$retryCount",
                error as? Exception
            )
            if (
                retryCount < MAX_SEND_RETRY_COUNT &&
                webSocket.connectionState.value == RelayWebSocket.ConnectionState.CONNECTED
            ) {
                CrashLogger.logWarn(
                    "WorkgroupRepository",
                    "Retrying workgroup message send agentId=$normalizedAgentId workgroupId=$normalizedWorkgroupId clientMessageId=$stableClientMessageId nextRetry=${retryCount + 1}"
                )
                sendMessage(
                    agentId = normalizedAgentId,
                    workgroupId = normalizedWorkgroupId,
                    content = content,
                    clientMessageId = stableClientMessageId,
                    retryCount = retryCount + 1
                )
            } else {
                Result.failure(error)
            }
        }
    }

    suspend fun dispatchTask(agentId: String, taskId: String): Result<Unit> =
        sendWorkgroupCommand(
            agentId = agentId,
            taskId = taskId,
            action = "dispatch_task"
        )

    suspend fun updateTaskStatus(agentId: String, taskId: String, status: String): Result<Unit> =
        sendWorkgroupCommand(
            agentId = agentId,
            taskId = taskId,
            action = "update_status",
            extraPayload = mapOf("status" to JsonPrimitive(status))
        )

    suspend fun setTaskScheduleEnabled(agentId: String, taskId: String, enabled: Boolean): Result<Unit> =
        sendWorkgroupCommand(
            agentId = agentId,
            taskId = taskId,
            action = "set_schedule_enabled",
            extraPayload = mapOf("enabled" to JsonPrimitive(enabled))
        )

    suspend fun saveTask(
        agentId: String,
        workgroupId: String,
        task: WorkgroupTask
    ): Result<Unit> =
        sendWorkgroupCommand(
            agentId = agentId,
            taskId = task.id.trim().takeIf { it.isNotEmpty() },
            action = "save_task",
            extraPayload = buildMap {
                put("workgroup_id", JsonPrimitive(workgroupId))
                put("title", JsonPrimitive(task.title))
                put("description", task.description.toJsonString())
                put("acceptance_criteria", task.acceptanceCriteria.toJsonString())
                put("acceptance_status", JsonPrimitive(task.acceptanceStatus))
                put("acceptance_note", task.acceptanceNote.toJsonString())
                put("assignee_member_id", task.assigneeMemberId.toJsonString())
                put("priority", JsonPrimitive(task.priority))
                put("status", JsonPrimitive(task.status))
                put("schedule_type", task.scheduleType?.let(::JsonPrimitive) ?: JsonNull)
                put("run_at", task.runAt?.let(::JsonPrimitive) ?: JsonNull)
                put("delay_minutes", task.delayMinutes?.let(::JsonPrimitive) ?: JsonNull)
                put("daily_time", task.dailyTime.toJsonString())
                put("weekly_day", task.weeklyDay?.let(::JsonPrimitive) ?: JsonNull)
                put("enabled", JsonPrimitive(task.scheduleEnabled))
            }
        )

    suspend fun deleteTask(agentId: String, taskId: String): Result<Unit> =
        sendWorkgroupCommand(
            agentId = agentId,
            taskId = taskId,
            action = "delete_task"
        )

    suspend fun generateTaskDraft(agentId: String, workgroupId: String, goal: String): Result<Unit> =
        sendWorkgroupCommand(
            agentId = agentId,
            taskId = null,
            action = "generate_task_draft",
            extraPayload = mapOf(
                "workgroup_id" to JsonPrimitive(workgroupId),
                "goal" to JsonPrimitive(goal)
            )
        )

    suspend fun applyTaskDraft(agentId: String, draftId: String): Result<Unit> =
        sendWorkgroupCommand(
            agentId = agentId,
            taskId = null,
            action = "apply_task_draft",
            extraPayload = mapOf("draft_id" to JsonPrimitive(draftId))
        )

    suspend fun deleteTaskDraft(agentId: String, draftId: String): Result<Unit> =
        sendWorkgroupCommand(
            agentId = agentId,
            taskId = null,
            action = "delete_task_draft",
            extraPayload = mapOf("draft_id" to JsonPrimitive(draftId))
        )

    fun getSession(agentId: String, workgroupId: String): WorkgroupSession? =
        _sessions.value[sessionKey(agentId, workgroupId)]

    fun resolveTrackedAgentIds(baseAgentIds: List<String>): List<String> =
        normalizeAgentIds(
            baseAgentIds +
                myRegistryEntries.map { it.hostAgentId } +
                tokenStore.getJoinedWorkgroupAgentIds().toList()
        )

    suspend fun searchRegistry(query: String): Result<List<WorkgroupRegistryEntry>> {
        val normalizedQuery = query.trim()
        if (normalizedQuery.isEmpty()) {
            _registryResults.value = emptyList()
            return Result.success(emptyList())
        }
        return runCatching {
            val auth = buildAuthHeader()
            val response = relayApiProvider().searchWorkgroupRegistry(auth, normalizedQuery)
            response.records.map { record ->
                WorkgroupRegistryEntry(
                    groupNumber = record.groupNumber,
                    workgroupId = record.workgroupId,
                    hostAgentId = record.hostAgentId,
                    name = record.name,
                    description = record.description?.trim()?.takeUnless { it.isNullOrEmpty() },
                    ownerUsername = record.ownerUsername?.trim()?.takeUnless { it.isNullOrEmpty() },
                    memberCount = record.memberCount,
                    canManage = record.canManage,
                    joined = record.joined,
                    updatedAt = record.updatedAt
                )
            }.also { entries ->
                _registryResults.value = entries
            }
        }
    }

    suspend fun joinRegistry(groupNumber: String): Result<WorkgroupRegistryEntry> {
        val normalizedGroupNumber = groupNumber.trim()
        if (normalizedGroupNumber.isEmpty()) {
            return Result.failure(IllegalArgumentException("group number is required"))
        }
        return runCatching {
            val auth = buildAuthHeader()
            val response = relayApiProvider().joinWorkgroupRegistry(
                auth = auth,
                request = JoinWorkgroupRegistryRequest(groupNumber = normalizedGroupNumber)
            )
            val entry = WorkgroupRegistryEntry(
                groupNumber = response.record.groupNumber,
                workgroupId = response.record.workgroupId,
                hostAgentId = response.record.hostAgentId,
                name = response.record.name,
                description = response.record.description?.trim()?.takeUnless { it.isNullOrEmpty() },
                ownerUsername = response.record.ownerUsername?.trim()?.takeUnless { it.isNullOrEmpty() },
                memberCount = response.record.memberCount,
                canManage = response.record.canManage,
                joined = response.record.joined,
                updatedAt = response.record.updatedAt
            )
            val nextJoinedAgentIds = tokenStore.getJoinedWorkgroupAgentIds().toMutableSet().apply {
                add(entry.hostAgentId)
            }
            tokenStore.saveJoinedWorkgroupAgentIds(nextJoinedAgentIds)
            refreshMyRegistry()
            entry
        }
    }

    suspend fun listExecutionRequests(groupNumber: String): Result<List<WorkgroupExecutionRequest>> = runCatching {
        relayApiProvider().listWorkgroupExecutionRequests(buildAuthHeader(), groupNumber.trim())
            .requests
            .map(::mapExecutionRequest)
    }

    suspend fun decideExecutionRequest(requestId: String, approve: Boolean): Result<WorkgroupExecutionRequest> = runCatching {
        val request = DecideWorkgroupExecutionRequest(requestId = requestId.trim())
        val response = if (approve) {
            relayApiProvider().approveWorkgroupExecutionRequest(buildAuthHeader(), request)
        } else {
            relayApiProvider().rejectWorkgroupExecutionRequest(buildAuthHeader(), request)
        }
        mapExecutionRequest(response.request)
    }

    suspend fun revokeExecutionRequest(requestId: String): Result<WorkgroupExecutionRequest> = runCatching {
        mapExecutionRequest(
            relayApiProvider().revokeWorkgroupExecutionRequest(
                buildAuthHeader(),
                DecideWorkgroupExecutionRequest(requestId = requestId.trim())
            ).request
        )
    }

    private fun mapExecutionRequest(record: WorkgroupExecutionRequestRecord) = WorkgroupExecutionRequest(
        id = record.id,
        groupNumber = record.groupNumber,
        requesterName = record.requesterName,
        targetAgentId = record.targetAgentId,
        projectIds = record.projectIds,
        status = record.status,
        decisionNote = record.decisionNote,
        updatedAt = record.updatedAt
    )

    private suspend fun refreshMyRegistry(): Result<List<WorkgroupRegistryEntry>> {
        return runCatching {
            val auth = buildAuthHeader()
            relayApiProvider().listMyWorkgroupRegistry(auth).records.map { record ->
                WorkgroupRegistryEntry(
                    groupNumber = record.groupNumber,
                    workgroupId = record.workgroupId,
                    hostAgentId = record.hostAgentId,
                    name = record.name,
                    description = record.description?.trim()?.takeUnless { it.isNullOrEmpty() },
                    ownerUsername = record.ownerUsername?.trim()?.takeUnless { it.isNullOrEmpty() },
                    memberCount = record.memberCount,
                    canManage = record.canManage,
                    joined = record.joined,
                    updatedAt = record.updatedAt
                )
            }.also { entries ->
                myRegistryEntries = entries
                tokenStore.saveJoinedWorkgroupAgentIds(entries.map { it.hostAgentId }.toSet())
            }
        }
    }

    suspend fun processEnvelope(envelope: Envelope) {
        when (envelope.event) {
            Events.ERROR -> {
                val payload = envelope.payload?.jsonObject
                val message = payload?.get("message")?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val code = payload?.get("code")?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                failPendingRequests(
                    if (message.isNotBlank()) message else if (code.isNotBlank()) code else "Workgroup request failed"
                )
            }

            Events.WORKGROUP_LIST,
            Events.WORKGROUP_COLLABORATION_LIST -> {
                val payload = envelope.payload?.jsonObject ?: return
                applyAgentWorkgroups(payload)
            }

            Events.WORKGROUP_COMMAND_RESULT -> {
                val payload = envelope.payload?.jsonObject ?: return
                if (payload["workgroups"]?.jsonArray != null) {
                    applyAgentWorkgroups(payload)
                }
                val requestId = payload["request_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                if (requestId.isBlank()) {
                    return
                }
                val success = payload["success"]?.jsonPrimitive?.booleanOrNull == true
                pendingCommandRequests.remove(requestId)?.complete(
                    if (success) {
                        Result.success(Unit)
                    } else {
                        Result.failure(
                            IllegalStateException(
                                payload["error"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                                    .ifBlank { "Workgroup command failed." }
                            )
                        )
                    }
                )
            }

            Events.WORKGROUP_COLLABORATION_SESSION -> {
                val payload = envelope.payload?.jsonObject ?: return
                val requestId = payload["request_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val response = applySessionPayload(payload)
                if (requestId.isNotBlank()) {
                    pendingSessionRequests.remove(requestId)?.complete(
                        response?.let { Result.success(it) }
                            ?: Result.failure(IllegalStateException("Workgroup session unavailable"))
                    )
                }
            }

            Events.WORKGROUP_COLLABORATION_MESSAGE_RESULT -> {
                val payload = envelope.payload?.jsonObject ?: return
                val requestId = payload["request_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val workgroupId = payload["workgroup_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val clientMessageId = payload["client_message_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val success = payload["success"]?.jsonPrimitive?.booleanOrNull == true
                payload["session"]?.jsonObject?.let { sessionObject ->
                    val agentId = payload["agent_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                    applySessionSnapshot(agentId, sessionObject)
                }
                if (requestId.isBlank()) {
                    return
                }
                if (success) {
                    CrashLogger.logInfo(
                        "WorkgroupRepository",
                        "Received workgroup message result success workgroupId=$workgroupId requestId=$requestId clientMessageId=$clientMessageId"
                    )
                } else {
                    CrashLogger.logWarn(
                        "WorkgroupRepository",
                        "Received workgroup message result failure workgroupId=$workgroupId requestId=$requestId clientMessageId=$clientMessageId error=${payload["error"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()}"
                    )
                }
                pendingSendRequests.remove(requestId)?.complete(
                    if (success) {
                        Result.success(
                            payload["client_message_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                                .ifBlank { requestId }
                        )
                    } else {
                        Result.failure(
                            IllegalStateException(
                                payload["error"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                                    .ifBlank { "Workgroup message failed." }
                            )
                        )
                    }
                )
            }

            Events.WORKGROUP_COLLABORATION_MESSAGE_ACCEPTED -> {
                val payload = envelope.payload?.jsonObject ?: return
                val requestId = payload["request_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val workgroupId = payload["workgroup_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val clientMessageId = payload["client_message_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                payload["session"]?.jsonObject?.let { sessionObject ->
                    val agentId = payload["agent_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                    applySessionSnapshot(agentId, sessionObject)
                }
                if (requestId.isBlank()) {
                    return
                }
                CrashLogger.logInfo(
                    "WorkgroupRepository",
                    "Received workgroup message.accepted workgroupId=$workgroupId requestId=$requestId clientMessageId=$clientMessageId"
                )
                pendingSendRequests.remove(requestId)?.complete(
                    Result.success(
                        payload["client_message_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                            .ifBlank { requestId }
                    )
                )
            }

            Events.WORKGROUP_COLLABORATION_SNAPSHOT -> {
                val payload = envelope.payload?.jsonObject ?: return
                val agentId = payload["agent_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val sessionObject = payload["session"]?.jsonObject ?: return
                applySessionSnapshot(agentId, sessionObject)
            }
        }
    }

    private fun applyAgentWorkgroups(payload: JsonObject) {
        val agentId = payload["agent_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        if (agentId.isBlank()) {
            return
        }

        val nextRevision = payload["revision"]?.jsonPrimitive?.contentOrNull?.trim()
            ?.takeUnless { it.isEmpty() }
            ?: payload["workgroups"]?.jsonArray?.toString()?.let(::createMd5)
            ?: createMd5("")
        val previousRevision = agentWorkgroupPayloadRevisions[agentId]
        if (previousRevision != null && previousRevision == nextRevision) {
            return
        }

        val workgroups = payload["workgroups"]?.jsonArray?.mapNotNull(::parseWorkgroup).orEmpty()
        agentWorkgroupPayloadRevisions[agentId] = nextRevision
        _agentWorkgroups.value = _agentWorkgroups.value
            .filterNot { it.agentId == agentId }
            .plus(AgentWorkgroups(agentId = agentId, workgroups = workgroups))
            .sortedBy { it.agentId.lowercase() }

        val validKeys = workgroups
            .map { sessionKey(agentId, it.id) }
            .toSet()
        _sessions.value = _sessions.value.filterKeys { key ->
            sessionKeyAgentId(key) != agentId || key in validKeys
        }
    }

    private fun applySessionPayload(payload: JsonObject): SessionResponse? {
        val agentId = payload["agent_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        val sessionObject = payload["session"]?.jsonObject ?: return null
        val beforeId = payload["before_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        val snapshotRevision = payload["snapshot_revision"]?.jsonPrimitive?.contentOrNull?.trim()
            ?.takeUnless { it.isEmpty() }
            ?: sessionObject["snapshotRevision"]?.jsonPrimitive?.contentOrNull?.trim()?.takeUnless { it.isEmpty() }
            ?: sessionObject["snapshot_revision"]?.jsonPrimitive?.contentOrNull?.trim()?.takeUnless { it.isEmpty() }
        val pageObject = payload["page"]?.jsonObject
        val key = sessionKey(agentId, sessionObject["workgroupId"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty())
        val existingSession = _sessions.value[key]
        if (
            beforeId.isBlank() &&
            payload["snapshot_unchanged"]?.jsonPrimitive?.booleanOrNull == true &&
            !snapshotRevision.isNullOrBlank() &&
            existingSession?.snapshotRevision == snapshotRevision
        ) {
            return SessionResponse(agentId = agentId, session = existingSession)
        }
        val existingMessages = existingSession?.messages.orEmpty()
        val existingById = existingMessages.associateBy { it.id }
        val parsedSession = parseSession(agentId, sessionObject, existingById, snapshotRevision) ?: return null
        val pageMessages = pageObject?.get("items")?.jsonArray?.mapNotNull { parseMessage(it, existingById) }.orEmpty()
        val hasMore = pageObject?.get("hasMore")?.jsonPrimitive?.booleanOrNull
            ?: (parsedSession.messageTotal > parsedSession.messages.size)

        val mergedMessages = if (beforeId.isBlank()) {
            mergeMessages(
                existingSession?.messages.orEmpty(),
                parsedSession.messages
            )
        } else {
            mergeMessages(
                existingSession?.messages.orEmpty(),
                pageMessages
            )
        }

        val nextSession = parsedSession.copy(
            messages = mergedMessages,
            hasMoreHistory = hasMore || mergedMessages.size < parsedSession.messageTotal
        )
        putSession(nextSession)
        return SessionResponse(agentId = agentId, session = nextSession)
    }

    private fun applySessionSnapshot(agentId: String, sessionObject: JsonObject) {
        val snapshotRevision = sessionObject["snapshotRevision"]?.jsonPrimitive?.contentOrNull?.trim()
            ?.takeUnless { it.isEmpty() }
            ?: sessionObject["snapshot_revision"]?.jsonPrimitive?.contentOrNull?.trim()?.takeUnless { it.isEmpty() }
        val currentSession = _sessions.value[sessionKey(agentId, sessionObject["workgroupId"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty())]
        if (!snapshotRevision.isNullOrBlank() && currentSession?.snapshotRevision == snapshotRevision) {
            return
        }
        val existingById = currentSession?.messages.orEmpty().associateBy { it.id }
        val parsedSession = parseSession(agentId, sessionObject, existingById, snapshotRevision) ?: return
        val existing = _sessions.value[sessionKey(agentId, parsedSession.workgroupId)]
        val mergedMessages = mergeMessages(existing?.messages.orEmpty(), parsedSession.messages)
        val nextSession = parsedSession.copy(
            messages = mergedMessages,
            hasMoreHistory = mergedMessages.size < parsedSession.messageTotal || existing?.hasMoreHistory == true
        )
        putSession(nextSession)
    }

    private fun putSession(session: WorkgroupSession) {
        _sessions.value = _sessions.value.toMutableMap().apply {
            put(sessionKey(session.agentId, session.workgroupId), session)
        }
    }

    private fun parseWorkgroup(element: kotlinx.serialization.json.JsonElement): Workgroup? {
        val obj = element as? JsonObject ?: return null
        val id = obj["id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        if (id.isBlank()) {
            return null
        }
        return Workgroup(
            id = id,
            name = obj["name"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { id },
            groupNumber = obj["groupNumber"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            description = obj["description"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            updatedAt = obj["updatedAt"]?.jsonPrimitive?.longOrNull ?: 0L,
            isRunning = obj["isRunning"]?.jsonPrimitive?.booleanOrNull == true,
            lastMessagePreview = obj["lastMessagePreview"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            messageCount = obj["messageCount"]?.jsonPrimitive?.intOrNull ?: 0,
            memberCount = obj["memberCount"]?.jsonPrimitive?.intOrNull ?: 0,
            tasks = obj["tasks"]?.jsonArray?.mapNotNull(::parseTask).orEmpty(),
            taskDrafts = obj["taskDrafts"]?.jsonArray?.mapNotNull(::parseTaskDraft).orEmpty()
        )
    }

    private fun parseSession(
        agentId: String,
        obj: JsonObject,
        existingById: Map<String, WorkgroupMessage> = emptyMap(),
        snapshotRevision: String? = null
    ): WorkgroupSession? {
        val workgroupId = obj["workgroupId"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        if (agentId.isBlank() || workgroupId.isBlank()) {
            return null
        }
        return WorkgroupSession(
            agentId = agentId,
            workgroupId = workgroupId,
            workgroupName = obj["workgroupName"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { workgroupId },
            description = obj["description"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            allowDirectMemberMessages = obj["allowDirectMemberMessages"]?.jsonPrimitive?.booleanOrNull == true,
            updatedAt = obj["updatedAt"]?.jsonPrimitive?.longOrNull ?: 0L,
            isRunning = obj["isRunning"]?.jsonPrimitive?.booleanOrNull == true,
            messageTotal = obj["messageTotal"]?.jsonPrimitive?.intOrNull ?: 0,
            snapshotRevision = snapshotRevision
                ?: obj["snapshotRevision"]?.jsonPrimitive?.contentOrNull?.trim()?.takeUnless { it.isNullOrEmpty() }
                ?: obj["snapshot_revision"]?.jsonPrimitive?.contentOrNull?.trim()?.takeUnless { it.isNullOrEmpty() },
            members = obj["members"]?.jsonArray?.mapNotNull(::parseMember).orEmpty(),
            messages = obj["messages"]?.jsonArray?.mapNotNull { parseMessage(it, existingById) }.orEmpty()
        )
    }

    private fun parseMember(element: kotlinx.serialization.json.JsonElement): WorkgroupMember? {
        val obj = element as? JsonObject ?: return null
        val id = obj["id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        if (id.isBlank()) {
            return null
        }
        return WorkgroupMember(
            id = id,
            name = obj["name"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { id },
            role = obj["role"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { "member" },
            projectId = obj["projectId"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            projectName = obj["projectName"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            projectKind = obj["projectKind"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            projectOnline = obj["projectOnline"]?.jsonPrimitive?.booleanOrNull == true,
            hasBinding = obj["hasBinding"]?.jsonPrimitive?.booleanOrNull == true,
            isRunning = obj["isRunning"]?.jsonPrimitive?.booleanOrNull == true
        )
    }

    private fun parseTask(element: kotlinx.serialization.json.JsonElement): WorkgroupTask? {
        val obj = element as? JsonObject ?: return null
        val id = obj["id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        if (id.isBlank()) {
            return null
        }
        return WorkgroupTask(
            id = id,
            title = obj["title"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { id },
            description = obj["description"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            acceptanceCriteria = obj["acceptanceCriteria"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            dependsOnIds = obj["dependsOnIds"]?.jsonArray
                ?.mapNotNull { it.jsonPrimitive.contentOrNull?.trim()?.takeUnless { value -> value.isEmpty() } }
                .orEmpty(),
            dependencyTasks = obj["dependencyTasks"]?.jsonArray?.mapNotNull { dependency ->
                val dependencyObject = dependency as? JsonObject ?: return@mapNotNull null
                val dependencyId = dependencyObject["id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                if (dependencyId.isBlank()) return@mapNotNull null
                WorkgroupTaskDependency(
                    id = dependencyId,
                    title = dependencyObject["title"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { dependencyId },
                    status = dependencyObject["status"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { "todo" }
                )
            }.orEmpty(),
            assigneeMemberId = obj["assigneeMemberId"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            assigneeMemberName = obj["assigneeMemberName"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            priority = obj["priority"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { "normal" },
            status = obj["status"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { "todo" },
            scheduleType = obj["scheduleType"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            scheduleEnabled = obj["scheduleEnabled"]?.jsonPrimitive?.booleanOrNull != false,
            runAt = obj["runAt"]?.jsonPrimitive?.longOrNull,
            delayMinutes = obj["delayMinutes"]?.jsonPrimitive?.intOrNull,
            dailyTime = obj["dailyTime"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            weeklyDay = obj["weeklyDay"]?.jsonPrimitive?.intOrNull,
            nextRunAt = obj["nextRunAt"]?.jsonPrimitive?.longOrNull,
            lastDispatchAt = obj["lastDispatchAt"]?.jsonPrimitive?.longOrNull,
            lastDispatchResult = obj["lastDispatchResult"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            artifactSummary = obj["artifactSummary"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            validationEvidence = obj["validationEvidence"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            acceptanceStatus = obj["acceptanceStatus"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { "pending" },
            acceptanceNote = obj["acceptanceNote"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            dispatchReady = obj["dispatchReady"]?.jsonPrimitive?.booleanOrNull == true,
            dispatchBlockedReason = obj["dispatchBlockedReason"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            updatedAt = obj["updatedAt"]?.jsonPrimitive?.longOrNull ?: 0L
        )
    }

    private fun parseTaskDraft(element: JsonElement): WorkgroupTaskPlanDraft? {
        val obj = element as? JsonObject ?: return null
        val id = obj["id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        val goal = obj["goal"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        if (id.isBlank() || goal.isBlank()) return null
        return WorkgroupTaskPlanDraft(
            id = id,
            goal = goal,
            status = obj["status"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { "generating" },
            summary = obj["summary"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            tasks = obj["tasks"]?.jsonArray?.mapNotNull { task ->
                val taskObject = task as? JsonObject ?: return@mapNotNull null
                val key = taskObject["key"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val title = taskObject["title"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                if (key.isBlank() || title.isBlank()) return@mapNotNull null
                WorkgroupTaskDraftProposal(
                    key = key,
                    title = title,
                    description = taskObject["description"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
                    acceptanceCriteria = taskObject["acceptanceCriteria"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
                    priority = taskObject["priority"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { "normal" },
                    assigneeMemberId = taskObject["assigneeMemberId"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
                    dependsOnKeys = taskObject["dependsOnKeys"]?.jsonArray
                        ?.mapNotNull { value -> value.jsonPrimitive.contentOrNull?.trim()?.takeUnless { it.isEmpty() } }
                        .orEmpty()
                )
            }.orEmpty(),
            error = obj["error"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() }
        )
    }

    private fun parseMessage(
        element: kotlinx.serialization.json.JsonElement,
        existingById: Map<String, WorkgroupMessage> = emptyMap()
    ): WorkgroupMessage? {
        val obj = element as? JsonObject ?: return null
        val id = obj["id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        if (id.isBlank()) {
            return null
        }
        val existing = existingById[id]
        val contentMd5 = obj["content_md5"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        val contentOmitted = obj["content_omitted"]?.jsonPrimitive?.booleanOrNull == true
        val resolvedContent = if (
            contentOmitted
            && existing != null
            && contentMd5.isNotBlank()
            && createMd5(existing.content) == contentMd5
        ) {
            existing.content
        } else {
            obj["content"]?.jsonPrimitive?.contentOrNull ?: ""
        }
        return WorkgroupMessage(
            id = id,
            senderType = obj["senderType"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { "member" },
            senderName = obj["senderName"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { "Unknown" },
            memberId = obj["memberId"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            memberRole = obj["memberRole"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            projectId = obj["projectId"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            projectKind = obj["projectKind"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
            content = resolvedContent,
            status = obj["status"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { "done" },
            createdAt = obj["createdAt"]?.jsonPrimitive?.longOrNull ?: 0L,
            updatedAt = obj["updatedAt"]?.jsonPrimitive?.longOrNull ?: 0L
        )
    }

    private fun mergeMessages(
        existing: List<WorkgroupMessage>,
        incoming: List<WorkgroupMessage>
    ): List<WorkgroupMessage> {
        if (incoming.isEmpty()) {
            return existing.sortedWith(compareBy<WorkgroupMessage> { it.createdAt }.thenBy { it.updatedAt })
        }
        val merged = LinkedHashMap<String, WorkgroupMessage>()
        existing
            .sortedWith(compareBy<WorkgroupMessage> { it.createdAt }.thenBy { it.updatedAt })
            .forEach { merged[it.id] = it }
        incoming
            .sortedWith(compareBy<WorkgroupMessage> { it.createdAt }.thenBy { it.updatedAt })
            .forEach { merged[it.id] = it }
        return merged.values
            .sortedWith(compareBy<WorkgroupMessage> { it.createdAt }.thenBy { it.updatedAt })
    }

    private fun normalizeAgentIds(agentIds: List<String>): List<String> =
        agentIds.map { it.trim() }.filter { it.isNotEmpty() }.distinct().sorted()

    private suspend fun buildAuthHeader(): String {
        val deviceId = tokenStore.getDeviceId()?.trim().orEmpty()
        require(deviceId.isNotEmpty()) { "Device ID is missing" }
        val token = authSessionManager.ensureValidToken(deviceId).getOrThrow()
        return "Bearer $token"
    }

    private fun buildKnownItems(
        agentId: String,
        workgroupId: String,
        beforeId: String?,
        limit: Int
    ): List<JsonObject> {
        val session = _sessions.value[sessionKey(agentId, workgroupId)] ?: return emptyList()
        val anchorIndex = beforeId?.trim()?.takeIf { it.isNotEmpty() }?.let { anchorId ->
            session.messages.indexOfFirst { it.id == anchorId }.takeIf { it >= 0 }
        } ?: session.messages.size
        return session.messages
            .take(anchorIndex)
            .takeLast(maxOf(KNOWN_ITEM_LIMIT, limit * 2))
            .map { message ->
                JsonObject(
                    mapOf(
                        "id" to JsonPrimitive(message.id),
                        "content_md5" to JsonPrimitive(createMd5(message.content))
                    )
                )
            }
    }

    private fun createMd5(value: String): String {
        val digest = MessageDigest.getInstance("MD5")
        val bytes = digest.digest(value.replace("\r\n", "\n").toByteArray(Charsets.UTF_8))
        return bytes.joinToString(separator = "") { byte -> "%02x".format(byte) }
    }

    private suspend fun sendWorkgroupCommand(
        agentId: String,
        taskId: String?,
        action: String,
        extraPayload: Map<String, JsonElement> = emptyMap()
    ): Result<Unit> {
        val normalizedAgentId = agentId.trim()
        val normalizedTaskId = taskId?.trim().orEmpty()
        if (normalizedAgentId.isEmpty()) {
            return Result.failure(IllegalArgumentException("agentId is required"))
        }
        if (action !in setOf("save_task", "generate_task_draft", "apply_task_draft", "delete_task_draft") && normalizedTaskId.isEmpty()) {
            return Result.failure(IllegalArgumentException("taskId is required"))
        }

        val requestId = UUID.randomUUID().toString()
        val deferred = CompletableDeferred<Result<Unit>>()
        pendingCommandRequests[requestId] = deferred

        return try {
            ensureSocketReady(normalizedAgentId, "workgroup-command")
            webSocket.send(
                Envelope(
                    id = requestId,
                    event = Events.WORKGROUP_COMMAND,
                    agentId = normalizedAgentId,
                    payload = JsonObject(
                        buildMap {
                            put("agent_id", JsonPrimitive(normalizedAgentId))
                            if (normalizedTaskId.isNotEmpty()) {
                                put("task_id", JsonPrimitive(normalizedTaskId))
                            }
                            put("action", JsonPrimitive(action))
                            putAll(extraPayload)
                        }
                    ),
                    ts = System.currentTimeMillis()
                ),
                targetAgentId = normalizedAgentId
            )
            withTimeout(REQUEST_TIMEOUT_MS) { deferred.await() }
        } catch (error: Exception) {
            pendingCommandRequests.remove(requestId)
            Result.failure(error)
        }
    }

    private fun String?.toJsonString(): JsonElement =
        this?.trim()?.takeIf { it.isNotEmpty() }?.let(::JsonPrimitive) ?: JsonNull

    private suspend fun wakeupAgent(agentId: String) {
        val normalizedAgentId = agentId.trim()
        if (normalizedAgentId.isEmpty()) {
            return
        }

        val now = System.currentTimeMillis()
        val lastRequestedAt = lastWakeupRequestedAt[normalizedAgentId]
        if (lastRequestedAt != null && now - lastRequestedAt < WAKEUP_THROTTLE_WINDOW_MS) {
            return
        }

        runCatching {
            val deviceId = tokenStore.getDeviceId()?.trim().orEmpty()
            require(deviceId.isNotEmpty()) { "Device ID is missing" }
            val auth = "Bearer ${authSessionManager.ensureValidToken(deviceId).getOrThrow()}"
            lastWakeupRequestedAt[normalizedAgentId] = now
            relayApiProvider().wakeupAgent(
                auth = auth,
                request = WakeupRequest(normalizedAgentId)
            )
        }.onFailure {
            lastWakeupRequestedAt.remove(normalizedAgentId, now)
        }
    }

    private fun failPendingRequests(message: String) {
        val error = IllegalStateException(message)
        pendingSessionRequests.entries.toList().forEach { (requestId, deferred) ->
            pendingSessionRequests.remove(requestId)
            deferred.complete(Result.failure(error))
        }
        pendingSendRequests.entries.toList().forEach { (requestId, deferred) ->
            pendingSendRequests.remove(requestId)
            deferred.complete(Result.failure(error))
        }
        pendingCommandRequests.entries.toList().forEach { (requestId, deferred) ->
            pendingCommandRequests.remove(requestId)
            deferred.complete(Result.failure(error))
        }
    }

    private fun sessionKey(agentId: String, workgroupId: String): String =
        "${agentId.trim()}::${workgroupId.trim()}"

    private fun sessionRequestKey(
        agentId: String,
        workgroupId: String,
        beforeId: String?,
        limit: Int
    ): String = listOf(
        agentId.trim(),
        workgroupId.trim(),
        beforeId?.trim().orEmpty(),
        limit.toString()
    ).joinToString(separator = "::")

    private fun sessionKeyAgentId(key: String): String =
        key.substringBefore("::", "")
}
