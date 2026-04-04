package com.claudecode.remote.ui.workgroup

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudecode.remote.R
import com.claudecode.remote.data.model.WorkgroupTask
import com.claudecode.remote.ui.agent.AgentHubViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun WorkgroupTaskManageScreen(
    agentId: String,
    workgroupId: String,
    workgroupName: String,
    viewModel: AgentHubViewModel,
    onNavigateBack: () -> Unit,
    onOpenChat: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val workgroup = viewModel.findWorkgroup(agentId, workgroupId)

    LaunchedEffect(agentId, workgroupId) {
        viewModel.initialize()
        viewModel.refresh()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(
                        MaterialTheme.colorScheme.background,
                        MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.2f),
                        MaterialTheme.colorScheme.surface
                    )
                )
            )
    ) {
        Scaffold(
            containerColor = Color.Transparent,
            contentWindowInsets = WindowInsets(0, 0, 0, 0)
        ) { padding ->
            Box(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize()
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .statusBarsPadding()
                        .padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        IconButton(onClick = onNavigateBack) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = stringResource(R.string.back)
                            )
                        }
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = workgroup?.name?.ifBlank { workgroupName } ?: workgroupName,
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = stringResource(R.string.workgroups_tasks_manage),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        TextButton(onClick = onOpenChat) {
                            Text(stringResource(R.string.workgroups_summary_title))
                        }
                        IconButton(onClick = viewModel::refresh) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = stringResource(R.string.action_refresh)
                            )
                        }
                    }

                    when {
                        workgroup == null -> {
                            Surface(
                                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
                                shape = androidx.compose.foundation.shape.RoundedCornerShape(24.dp)
                            ) {
                                Text(
                                    text = stringResource(R.string.workgroups_error_load),
                                    modifier = Modifier.padding(18.dp),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }

                        workgroup.tasks.isEmpty() -> {
                            Surface(
                                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
                                shape = androidx.compose.foundation.shape.RoundedCornerShape(24.dp)
                            ) {
                                Text(
                                    text = stringResource(R.string.workgroups_tasks_empty),
                                    modifier = Modifier.padding(18.dp),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }

                        else -> {
                            LazyColumn(
                                modifier = Modifier.weight(1f),
                                contentPadding = PaddingValues(bottom = 20.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                items(workgroup.tasks, key = { it.id }) { task ->
                                    WorkgroupTaskCard(
                                        task = task,
                                        onDispatch = { viewModel.dispatchWorkgroupTask(agentId, task.id) },
                                        onSetTodo = { viewModel.updateWorkgroupTaskStatus(agentId, task.id, "todo") },
                                        onSetDone = { viewModel.updateWorkgroupTaskStatus(agentId, task.id, "done") },
                                        onSetBlocked = { viewModel.updateWorkgroupTaskStatus(agentId, task.id, "blocked") },
                                        onToggleSchedule = {
                                            viewModel.setWorkgroupTaskScheduleEnabled(
                                                agentId = agentId,
                                                taskId = task.id,
                                                enabled = task.scheduleEnabled.not()
                                            )
                                        }
                                    )
                                }
                            }
                        }
                    }
                }

                uiState.error?.let { error ->
                    Snackbar(
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(16.dp),
                        action = {
                            TextButton(onClick = { viewModel.clearError() }) {
                                Text(stringResource(R.string.dismiss))
                            }
                        }
                    ) {
                        Text(error)
                    }
                }
            }
        }
    }
}

@Composable
private fun WorkgroupTaskCard(
    task: WorkgroupTask,
    onDispatch: () -> Unit,
    onSetTodo: () -> Unit,
    onSetDone: () -> Unit,
    onSetBlocked: () -> Unit,
    onToggleSchedule: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.97f)
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f))
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = task.title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                StatusChip(label = task.status)
            }
            task.assigneeMemberName?.takeIf { it.isNotBlank() }?.let {
                Text(
                    text = stringResource(R.string.workgroups_assignee_label, it),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            Text(
                text = task.description?.takeIf { it.isNotBlank() }
                    ?: stringResource(R.string.workgroups_task_schedule_label, scheduleLabel(task)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (task.scheduleType != null) {
                Text(
                    text = stringResource(R.string.workgroups_task_schedule_label, scheduleLabel(task)),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = stringResource(
                        R.string.workgroups_task_next_run_label,
                        formatTimestamp(task.nextRunAt)
                    ),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            task.lastDispatchAt?.takeIf { it > 0L }?.let {
                Text(
                    text = stringResource(R.string.workgroups_task_last_dispatch_label, formatTimestamp(it)),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            task.lastDispatchResult?.takeIf { it.isNotBlank() }?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            task.dispatchBlockedReason?.takeIf { it.isNotBlank() }?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )
            }
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    TextButton(onClick = onDispatch, enabled = task.dispatchReady) {
                        Text(stringResource(R.string.workgroups_dispatch))
                    }
                    if (task.scheduleType != null) {
                        TextButton(onClick = onToggleSchedule) {
                            Text(
                                if (task.scheduleEnabled) {
                                    stringResource(R.string.workgroups_schedule_disable)
                                } else {
                                    stringResource(R.string.workgroups_schedule_enable)
                                }
                            )
                        }
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    TextButton(onClick = onSetTodo) {
                        Text(stringResource(R.string.workgroups_todo))
                    }
                    TextButton(onClick = onSetDone) {
                        Text(stringResource(R.string.workgroups_done))
                    }
                    TextButton(onClick = onSetBlocked) {
                        Text(stringResource(R.string.workgroups_blocked))
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusChip(label: String) {
    val normalized = label.trim().lowercase(Locale.getDefault())
    val text = when (normalized) {
        "done" -> stringResource(R.string.workgroups_done)
        "blocked" -> stringResource(R.string.workgroups_blocked)
        "running", "assigned" -> stringResource(R.string.status_running)
        else -> stringResource(R.string.workgroups_todo)
    }
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        shape = androidx.compose.foundation.shape.RoundedCornerShape(999.dp)
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold
        )
    }
}

private fun scheduleLabel(task: WorkgroupTask): String {
    return when (task.scheduleType?.trim()?.lowercase(Locale.getDefault())) {
        "daily" -> "Daily ${task.dailyTime ?: "--:--"}"
        "delay" -> "Delay ${task.delayMinutes ?: 0} min"
        "weekly" -> {
            val day = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
                .getOrNull(task.weeklyDay ?: -1) ?: "Day"
            "Weekly $day ${task.dailyTime ?: "--:--"}"
        }
        "once" -> "One time ${formatTimestamp(task.runAt)}"
        else -> "Manual only"
    }
}

private fun formatTimestamp(value: Long?): String {
    val time = value ?: return "Not scheduled"
    if (time <= 0L) {
        return "Not scheduled"
    }
    return SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(time))
}
