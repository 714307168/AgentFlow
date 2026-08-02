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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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

private data class WorkgroupTaskDraft(
    val id: String = "",
    val title: String = "",
    val description: String = "",
    val acceptanceCriteria: String = "",
    val artifactSummary: String? = null,
    val validationEvidence: String? = null,
    val acceptanceStatus: String = "pending",
    val acceptanceNote: String? = null,
    val assigneeMemberId: String? = null,
    val assigneeMemberName: String? = null,
    val priority: String = "normal",
    val status: String = "todo",
    val scheduleType: String = "manual",
    val scheduleEnabled: Boolean = true,
    val runAtText: String = "",
    val delayMinutesText: String = "",
    val dailyTime: String = "",
    val weeklyDayText: String = ""
)

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
    val invalidDraftMessage = stringResource(R.string.workgroups_task_error_invalid)
    var editingDraft by remember { mutableStateOf<WorkgroupTaskDraft?>(null) }
    var deleteTask by remember { mutableStateOf<WorkgroupTask?>(null) }
    var showPmPlanDialog by remember { mutableStateOf(false) }
    var pmGoal by remember { mutableStateOf("") }
    var dialogError by remember { mutableStateOf<String?>(null) }

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

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        TextButton(onClick = {
                            dialogError = null
                            editingDraft = WorkgroupTaskDraft()
                        }) {
                            Icon(
                                imageVector = Icons.Default.Add,
                                contentDescription = stringResource(R.string.workgroups_task_create),
                                modifier = Modifier.padding(end = 4.dp)
                            )
                            Text(stringResource(R.string.workgroups_task_create))
                        }
                        TextButton(onClick = { showPmPlanDialog = true }) {
                            Text(stringResource(R.string.workgroups_pm_plan))
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

                        workgroup.tasks.isEmpty() && workgroup.taskDrafts.isEmpty() -> {
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
                                if (workgroup.taskDrafts.isNotEmpty()) {
                                    item(key = "pm-drafts") {
                                        WorkgroupTaskPlanDrafts(
                                            drafts = workgroup.taskDrafts,
                                            onApply = { viewModel.applyWorkgroupTaskDraft(agentId, it) },
                                            onDelete = { viewModel.deleteWorkgroupTaskDraft(agentId, it) }
                                        )
                                    }
                                }
                                item(key = "task-graph") {
                                    WorkgroupTaskFlow(tasks = workgroup.tasks)
                                }
                                items(workgroup.tasks, key = { it.id }) { task ->
                                    WorkgroupTaskCard(
                                        task = task,
                                        onDispatch = { viewModel.dispatchWorkgroupTask(agentId, task.id) },
                                        onSetTodo = { viewModel.updateWorkgroupTaskStatus(agentId, task.id, "todo") },
                                        onSetDone = { viewModel.updateWorkgroupTaskStatus(agentId, task.id, "done") },
                                        onSetBlocked = { viewModel.updateWorkgroupTaskStatus(agentId, task.id, "blocked") },
                                        onToggleSchedule = {
                                            viewModel.setWorkgroupTaskScheduleEnabled(agentId, task.id, task.scheduleEnabled.not())
                                        },
                                        onEdit = {
                                            dialogError = null
                                            editingDraft = task.toDraft()
                                        },
                                        onDelete = {
                                            dialogError = null
                                            deleteTask = task
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

    editingDraft?.let { initial ->
        WorkgroupTaskEditorDialog(
            initialDraft = initial,
            errorMessage = dialogError,
            onDismiss = {
                editingDraft = null
                dialogError = null
            },
            onSave = { draft ->
                val task = draft.toTask()
                if (task == null) {
                    dialogError = invalidDraftMessage
                } else {
                    dialogError = null
                    viewModel.saveWorkgroupTask(agentId, workgroupId, task)
                    editingDraft = null
                }
            }
        )
    }

    deleteTask?.let { task ->
        AlertDialog(
            onDismissRequest = { deleteTask = null },
            title = { Text(stringResource(R.string.workgroups_task_delete_title)) },
            text = { Text(stringResource(R.string.workgroups_task_delete_message, task.title)) },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.deleteWorkgroupTask(agentId, task.id)
                    deleteTask = null
                }) {
                    Text(stringResource(R.string.workgroups_task_delete))
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteTask = null }) {
                    Text(stringResource(R.string.cancel))
                }
            }
        )
    }

    if (showPmPlanDialog) {
        AlertDialog(
            onDismissRequest = { showPmPlanDialog = false },
            title = { Text(stringResource(R.string.workgroups_pm_plan)) },
            text = {
                OutlinedTextField(
                    value = pmGoal,
                    onValueChange = { pmGoal = it },
                    label = { Text(stringResource(R.string.workgroups_pm_goal_label)) },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(
                    enabled = pmGoal.isNotBlank(),
                    onClick = {
                        viewModel.generateWorkgroupTaskDraft(agentId, workgroupId, pmGoal.trim())
                        pmGoal = ""
                        showPmPlanDialog = false
                    }
                ) { Text(stringResource(R.string.workgroups_pm_generate)) }
            },
            dismissButton = {
                TextButton(onClick = { showPmPlanDialog = false }) { Text(stringResource(R.string.cancel)) }
            }
        )
    }
}

@Composable
private fun WorkgroupTaskCard(
    task: WorkgroupTask,
    onDispatch: () -> Unit,
    onSetTodo: () -> Unit,
    onSetDone: () -> Unit,
    onSetBlocked: () -> Unit,
    onToggleSchedule: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit
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
                    text = stringResource(R.string.workgroups_task_next_run_label, formatTimestamp(task.nextRunAt)),
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
            task.artifactSummary?.takeIf { it.isNotBlank() }?.let {
                Text(
                    text = stringResource(R.string.workgroups_task_artifacts_label, it),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            task.validationEvidence?.takeIf { it.isNotBlank() }?.let {
                Text(
                    text = stringResource(R.string.workgroups_task_validation_label, it),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (task.dependencyTasks.isNotEmpty()) {
                Text(
                    text = stringResource(
                        R.string.workgroups_task_dependencies_label,
                        task.dependencyTasks.joinToString(" · ") { dependency ->
                            "${dependency.title} (${dependency.status})"
                        }
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Text(
                text = stringResource(
                    R.string.workgroups_task_acceptance_status_label,
                    acceptanceStatusLabel(task.acceptanceStatus)
                ),
                style = MaterialTheme.typography.labelMedium,
                color = if (task.acceptanceStatus == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
            )
            task.acceptanceNote?.takeIf { it.isNotBlank() }?.let {
                Text(
                    text = stringResource(R.string.workgroups_task_review_note_label, it),
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
                    TextButton(onClick = onEdit) {
                        Text(stringResource(R.string.workgroups_task_edit))
                    }
                    TextButton(onClick = onDelete) {
                        Text(stringResource(R.string.workgroups_task_delete))
                    }
                }
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
private fun WorkgroupTaskEditorDialog(
    initialDraft: WorkgroupTaskDraft,
    errorMessage: String?,
    onDismiss: () -> Unit,
    onSave: (WorkgroupTaskDraft) -> Unit
) {
    var draft by remember(initialDraft) { mutableStateOf(initialDraft) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                if (draft.id.isBlank()) {
                    stringResource(R.string.workgroups_task_create)
                } else {
                    stringResource(R.string.workgroups_task_edit)
                }
            )
        },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                OutlinedTextField(
                    value = draft.title,
                    onValueChange = { draft = draft.copy(title = it) },
                    label = { Text(stringResource(R.string.workgroups_task_title_label)) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
                OutlinedTextField(
                    value = draft.description,
                    onValueChange = { draft = draft.copy(description = it) },
                    label = { Text(stringResource(R.string.workgroups_task_description_label)) },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3
                )
                OutlinedTextField(
                    value = draft.acceptanceCriteria,
                    onValueChange = { draft = draft.copy(acceptanceCriteria = it) },
                    label = { Text(stringResource(R.string.workgroups_task_acceptance_label)) },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2
                )
                draft.assigneeMemberName?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        text = stringResource(R.string.workgroups_assignee_label, it),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                SimpleToggleGroup(
                    title = stringResource(R.string.workgroups_task_priority_label),
                    options = listOf("low", "normal", "high"),
                    selected = draft.priority,
                    labelFor = { priorityLabel(it) },
                    onSelected = { draft = draft.copy(priority = it) }
                )
                SimpleToggleGroup(
                    title = stringResource(R.string.workgroups_task_status_label),
                    options = listOf("todo", "done", "blocked"),
                    selected = draft.status,
                    labelFor = { statusLabel(it) },
                    onSelected = { draft = draft.copy(status = it) }
                )
                SimpleToggleGroup(
                    title = stringResource(R.string.workgroups_task_schedule_type_label),
                    options = listOf("manual", "once", "delay", "daily", "weekly"),
                    selected = draft.scheduleType,
                    labelFor = { scheduleTypeLabel(it) },
                    onSelected = { draft = draft.copy(scheduleType = it, scheduleEnabled = if (it == "manual") false else draft.scheduleEnabled) }
                )
                if (draft.scheduleType != "manual") {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = stringResource(R.string.workgroups_task_schedule_enabled_label),
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f)
                        )
                        Switch(
                            checked = draft.scheduleEnabled,
                            onCheckedChange = { draft = draft.copy(scheduleEnabled = it) }
                        )
                    }
                }
                if (draft.scheduleType == "once") {
                    OutlinedTextField(
                        value = draft.runAtText,
                        onValueChange = { draft = draft.copy(runAtText = it) },
                        label = { Text(stringResource(R.string.workgroups_task_run_at_label)) },
                        modifier = Modifier.fillMaxWidth(),
                        supportingText = { Text(stringResource(R.string.workgroups_task_run_at_hint)) },
                        singleLine = true
                    )
                }
                if (draft.scheduleType == "delay") {
                    OutlinedTextField(
                        value = draft.delayMinutesText,
                        onValueChange = { draft = draft.copy(delayMinutesText = it) },
                        label = { Text(stringResource(R.string.workgroups_task_delay_label)) },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                }
                if (draft.scheduleType == "daily" || draft.scheduleType == "weekly") {
                    OutlinedTextField(
                        value = draft.dailyTime,
                        onValueChange = { draft = draft.copy(dailyTime = it) },
                        label = { Text(stringResource(R.string.workgroups_task_daily_time_label)) },
                        modifier = Modifier.fillMaxWidth(),
                        supportingText = { Text(stringResource(R.string.workgroups_task_daily_time_hint)) },
                        singleLine = true
                    )
                }
                if (draft.scheduleType == "weekly") {
                    OutlinedTextField(
                        value = draft.weeklyDayText,
                        onValueChange = { draft = draft.copy(weeklyDayText = it) },
                        label = { Text(stringResource(R.string.workgroups_task_weekly_day_label)) },
                        modifier = Modifier.fillMaxWidth(),
                        supportingText = { Text(stringResource(R.string.workgroups_task_weekly_day_hint)) },
                        singleLine = true
                    )
                }
                errorMessage?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(draft) }) {
                Text(stringResource(R.string.settings_apply))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.cancel))
            }
        }
    )
}

@Composable
private fun SimpleToggleGroup(
    title: String,
    options: List<String>,
    selected: String,
    labelFor: @Composable (String) -> String,
    onSelected: (String) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            options.chunked(3).forEach { rowOptions ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    rowOptions.forEach { option ->
                        TextButton(
                            onClick = { onSelected(option) },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text(
                                text = labelFor(option),
                                color = if (option == selected) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                }
                            )
                        }
                    }
                    repeat(3 - rowOptions.size) {
                        Box(modifier = Modifier.weight(1f))
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

@Composable
private fun priorityLabel(value: String): String = when (value) {
    "low" -> stringResource(R.string.workgroups_task_priority_low)
    "high" -> stringResource(R.string.workgroups_task_priority_high)
    else -> stringResource(R.string.workgroups_task_priority_normal)
}

@Composable
private fun statusLabel(value: String): String = when (value) {
    "done" -> stringResource(R.string.workgroups_done)
    "blocked" -> stringResource(R.string.workgroups_blocked)
    else -> stringResource(R.string.workgroups_todo)
}

@Composable
private fun scheduleTypeLabel(value: String): String = when (value) {
    "once" -> stringResource(R.string.workgroups_task_schedule_once)
    "delay" -> stringResource(R.string.workgroups_task_schedule_delay)
    "daily" -> stringResource(R.string.workgroups_task_schedule_daily)
    "weekly" -> stringResource(R.string.workgroups_task_schedule_weekly)
    else -> stringResource(R.string.workgroups_task_schedule_manual)
}

@Composable
private fun acceptanceStatusLabel(value: String): String = when (value) {
    "passed" -> stringResource(R.string.workgroups_task_acceptance_passed)
    "failed" -> stringResource(R.string.workgroups_task_acceptance_failed)
    else -> stringResource(R.string.workgroups_task_acceptance_pending)
}

private fun WorkgroupTask.toDraft(): WorkgroupTaskDraft =
    WorkgroupTaskDraft(
        id = id,
        title = title,
        description = description.orEmpty(),
        acceptanceCriteria = acceptanceCriteria.orEmpty(),
        artifactSummary = artifactSummary,
        validationEvidence = validationEvidence,
        acceptanceStatus = acceptanceStatus,
        acceptanceNote = acceptanceNote,
        assigneeMemberId = assigneeMemberId,
        assigneeMemberName = assigneeMemberName,
        priority = priority,
        status = status,
        scheduleType = scheduleType ?: "manual",
        scheduleEnabled = if (scheduleType == null) false else scheduleEnabled,
        runAtText = runAt?.let(::formatTimestamp).orEmpty(),
        delayMinutesText = delayMinutes?.toString().orEmpty(),
        dailyTime = dailyTime.orEmpty(),
        weeklyDayText = weeklyDay?.toString().orEmpty()
    )

private fun WorkgroupTaskDraft.toTask(): WorkgroupTask? {
    val normalizedTitle = title.trim()
    if (normalizedTitle.isEmpty()) {
        return null
    }

    val normalizedScheduleType = scheduleType.trim().lowercase(Locale.getDefault())
    val resolvedScheduleType = normalizedScheduleType.takeUnless { it == "manual" || it.isBlank() }
    val runAt = if (resolvedScheduleType == "once") parseFlexibleTimestamp(runAtText) else null
    val delayMinutes = if (resolvedScheduleType == "delay") delayMinutesText.trim().toIntOrNull() else null
    val dailyTimeValue = if (resolvedScheduleType == "daily" || resolvedScheduleType == "weekly") {
        dailyTime.trim().takeIf { it.matches(Regex("""^\d{2}:\d{2}$""")) }
    } else {
        null
    }
    val weeklyDay = if (resolvedScheduleType == "weekly") weeklyDayText.trim().toIntOrNull() else null

    if (resolvedScheduleType == "once" && runAt == null) return null
    if (resolvedScheduleType == "delay" && (delayMinutes == null || delayMinutes <= 0)) return null
    if ((resolvedScheduleType == "daily" || resolvedScheduleType == "weekly") && dailyTimeValue == null) return null
    if (resolvedScheduleType == "weekly" && (weeklyDay == null || weeklyDay !in 0..6)) return null

    return WorkgroupTask(
        id = id,
        title = normalizedTitle,
        description = description.trim().takeIf { it.isNotEmpty() },
        acceptanceCriteria = acceptanceCriteria.trim().takeIf { it.isNotEmpty() },
        artifactSummary = artifactSummary,
        validationEvidence = validationEvidence,
        acceptanceStatus = acceptanceStatus,
        acceptanceNote = acceptanceNote,
        assigneeMemberId = assigneeMemberId,
        assigneeMemberName = assigneeMemberName,
        priority = priority,
        status = status,
        scheduleType = resolvedScheduleType,
        scheduleEnabled = if (resolvedScheduleType == null) false else scheduleEnabled,
        runAt = runAt,
        delayMinutes = delayMinutes,
        dailyTime = dailyTimeValue,
        weeklyDay = weeklyDay
    )
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

private fun parseFlexibleTimestamp(value: String): Long? {
    val normalized = value.trim()
    if (normalized.isEmpty()) {
        return null
    }
    val formats = listOf("yyyy-MM-dd HH:mm", "yyyy/MM/dd HH:mm")
    for (pattern in formats) {
        val formatter = SimpleDateFormat(pattern, Locale.getDefault())
        formatter.isLenient = false
        val parsed = runCatching { formatter.parse(normalized)?.time }.getOrNull()
        if (parsed != null) {
            return parsed
        }
    }
    return null
}
