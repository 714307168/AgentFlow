package com.claudecode.remote.ui.workgroup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.claudecode.remote.R
import com.claudecode.remote.data.model.WorkgroupTask
import com.claudecode.remote.data.model.WorkgroupTaskPlanDraft

@Composable
internal fun WorkgroupTaskFlow(tasks: List<WorkgroupTask>) {
    if (tasks.isEmpty()) return
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f))
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(R.string.workgroups_task_graph_title), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            tasks.forEach { task ->
                val dependencies = task.dependencyTasks.joinToString(" · ") { it.title }
                Text(
                    text = if (dependencies.isBlank()) "${task.title} · ${task.status}" else "$dependencies → ${task.title} · ${task.status}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
internal fun WorkgroupTaskPlanDrafts(
    drafts: List<WorkgroupTaskPlanDraft>,
    onApply: (String) -> Unit,
    onDelete: (String) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        drafts.forEach { draft ->
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = androidx.compose.foundation.shape.RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.45f))
            ) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(draft.goal, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Text(draft.status, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    draft.summary?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    draft.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                    draft.tasks.forEach { task ->
                        val dependencies = task.dependsOnKeys.takeIf { it.isNotEmpty() }?.joinToString(", ") ?: "—"
                        Text("${task.title} · ${task.priority} · $dependencies", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        if (draft.status == "ready") {
                            TextButton(onClick = { onApply(draft.id) }) { Text(stringResource(R.string.workgroups_pm_confirm)) }
                        }
                        TextButton(onClick = { onDelete(draft.id) }) { Text(stringResource(R.string.workgroups_pm_discard)) }
                    }
                }
            }
        }
    }
}
