package com.claudecode.remote.data.model

data class WorkgroupMessage(
    val id: String,
    val senderType: String,
    val senderName: String,
    val memberId: String? = null,
    val memberRole: String? = null,
    val projectId: String? = null,
    val projectKind: String? = null,
    val content: String,
    val status: String = "done",
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L
)

data class WorkgroupMember(
    val id: String,
    val name: String,
    val role: String,
    val projectId: String? = null,
    val projectName: String? = null,
    val projectKind: String? = null,
    val projectOnline: Boolean = false,
    val hasBinding: Boolean = false,
    val isRunning: Boolean = false
)

data class Workgroup(
    val id: String,
    val name: String,
    val groupNumber: String? = null,
    val description: String? = null,
    val updatedAt: Long = 0L,
    val isRunning: Boolean = false,
    val lastMessagePreview: String? = null,
    val messageCount: Int = 0,
    val memberCount: Int = 0
)

data class WorkgroupSession(
    val agentId: String,
    val workgroupId: String,
    val workgroupName: String,
    val description: String? = null,
    val allowDirectMemberMessages: Boolean = false,
    val updatedAt: Long = 0L,
    val isRunning: Boolean = false,
    val messageTotal: Int = 0,
    val members: List<WorkgroupMember> = emptyList(),
    val messages: List<WorkgroupMessage> = emptyList(),
    val hasMoreHistory: Boolean = false
)

data class AgentWorkgroups(
    val agentId: String,
    val workgroups: List<Workgroup> = emptyList()
)

data class WorkgroupRegistryEntry(
    val groupNumber: String,
    val workgroupId: String,
    val hostAgentId: String,
    val name: String,
    val description: String? = null,
    val ownerUsername: String? = null,
    val memberCount: Int = 0,
    val canManage: Boolean = false,
    val joined: Boolean = false,
    val updatedAt: Long = 0L
)
