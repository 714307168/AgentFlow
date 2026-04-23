package com.claudecode.remote.ui

import com.claudecode.remote.R
import com.claudecode.remote.domain.ProjectAccessNoticeKind

internal fun projectAccessNoticeMessageResId(noticeKind: ProjectAccessNoticeKind?): Int =
    when (noticeKind) {
        ProjectAccessNoticeKind.ROUTE_BLOCKED_BY_SCOPE -> R.string.chat_project_access_scope_blocked
        ProjectAccessNoticeKind.SESSION_REVOKED_BY_SCOPE -> R.string.chat_project_access_revoked_live
        null -> R.string.chat_project_access_revoked
    }
