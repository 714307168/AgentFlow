package com.claudecode.remote.ui.agent

import com.claudecode.remote.data.model.Session

data class AgentSessionGroup(
    val key: String,
    val title: String,
    val sessions: List<Session>
)
