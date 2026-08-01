import type { WorkgroupTask, WorkgroupTaskStatus } from "./workgroup-store";

export interface WorkgroupTaskGraphNode {
  id: string;
  title: string;
  status: WorkgroupTaskStatus;
  column: number;
  row: number;
}

export interface WorkgroupTaskGraphEdge {
  fromTaskId: string;
  toTaskId: string;
}

export interface WorkgroupTaskGraph {
  nodes: WorkgroupTaskGraphNode[];
  edges: WorkgroupTaskGraphEdge[];
  columnCount: number;
  rowCount: number;
}

function compareTasks(left: WorkgroupTask, right: WorkgroupTask): number {
  return left.title.localeCompare(right.title, "zh-CN") || left.id.localeCompare(right.id);
}

export function buildWorkgroupTaskGraph(tasks: WorkgroupTask[]): WorkgroupTaskGraph {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const levels = new Map<string, number>();
  const visiting = new Set<string>();

  const resolveLevel = (taskId: string): number => {
    const knownLevel = levels.get(taskId);
    if (knownLevel !== undefined) {
      return knownLevel;
    }
    const task = tasksById.get(taskId);
    if (!task || visiting.has(taskId)) {
      return 0;
    }
    visiting.add(taskId);
    const level = task.dependsOnIds
      .filter((dependencyId) => tasksById.has(dependencyId))
      .reduce((highestLevel, dependencyId) => Math.max(highestLevel, resolveLevel(dependencyId) + 1), 0);
    visiting.delete(taskId);
    levels.set(taskId, level);
    return level;
  };

  const columns = new Map<number, WorkgroupTask[]>();
  for (const task of tasks) {
    const level = resolveLevel(task.id);
    const column = columns.get(level) ?? [];
    column.push(task);
    columns.set(level, column);
  }

  const nodes: WorkgroupTaskGraphNode[] = [];
  let rowCount = 0;
  for (const [column, columnTasks] of columns.entries()) {
    columnTasks.sort(compareTasks).forEach((task, row) => {
      nodes.push({
        id: task.id,
        title: task.title,
        status: task.status,
        column,
        row,
      });
      rowCount = Math.max(rowCount, row + 1);
    });
  }

  const edges = tasks
    .flatMap((task) => task.dependsOnIds
      .filter((dependencyId) => tasksById.has(dependencyId))
      .map((dependencyId) => ({ fromTaskId: dependencyId, toTaskId: task.id })))
    .sort((left, right) => (
      left.fromTaskId.localeCompare(right.fromTaskId)
      || left.toTaskId.localeCompare(right.toTaskId)
    ));

  return {
    nodes: nodes.sort((left, right) => left.column - right.column || left.row - right.row),
    edges,
    columnCount: Math.max(1, columns.size),
    rowCount: Math.max(1, rowCount),
  };
}
