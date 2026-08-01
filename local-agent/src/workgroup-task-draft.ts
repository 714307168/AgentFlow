import type { WorkgroupMemberSpecialty, WorkgroupTaskPriority } from "./workgroup-store";

export type WorkgroupTaskDraftStatus = "generating" | "ready" | "error";

export interface WorkgroupTaskDraftMember {
  id: string;
  name: string;
  specialty: WorkgroupMemberSpecialty;
  available: boolean;
}

export interface WorkgroupTaskDraftProposal {
  key: string;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  priority: WorkgroupTaskPriority;
  assigneeMemberId: string | null;
  dependsOnKeys: string[];
}

export interface WorkgroupTaskDraftResult {
  summary: string | null;
  tasks: WorkgroupTaskDraftProposal[];
}

interface DraftCandidate {
  summary?: unknown;
  tasks?: unknown;
}

const MAX_DRAFT_TASKS = 20;
const MAX_TEXT_LENGTH = 4_000;
const DRAFT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function normalizeText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maxLength) : null;
}

function normalizePriority(value: unknown): WorkgroupTaskPriority {
  return value === "high" || value === "low" ? value : "normal";
}

function normalizeKey(value: unknown, index: number, usedKeys: Set<string>): string {
  const requested = typeof value === "string" ? value.trim().toLowerCase() : "";
  const base = DRAFT_KEY_PATTERN.test(requested) ? requested : `task-${index + 1}`;
  let key = base;
  let suffix = 2;
  while (usedKeys.has(key)) {
    key = `${base.slice(0, Math.max(1, 61 - String(suffix).length))}-${suffix}`;
    suffix += 1;
  }
  usedKeys.add(key);
  return key;
}

function parseJsonCandidate(response: string): DraftCandidate {
  const trimmed = response.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidates = [fenceMatch?.[1], trimmed]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => {
      const start = value.indexOf("{");
      const end = value.lastIndexOf("}");
      return start >= 0 && end > start ? [value, value.slice(start, end + 1)] : [value];
    });

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as DraftCandidate;
      }
    } catch {
      // Try the next response shape. Models may add a short sentence around JSON.
    }
  }
  throw new Error("PM did not return a valid JSON task draft.");
}

function hasDependencyCycle(tasks: WorkgroupTaskDraftProposal[]): boolean {
  const dependenciesByKey = new Map(tasks.map((task) => [task.key, task.dependsOnKeys]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    for (const dependencyKey of dependenciesByKey.get(key) ?? []) {
      if (visit(dependencyKey)) return true;
    }
    visiting.delete(key);
    visited.add(key);
    return false;
  };
  return tasks.some((task) => visit(task.key));
}

export function parseWorkgroupTaskDraftResponse(
  response: string,
  members: WorkgroupTaskDraftMember[],
): WorkgroupTaskDraftResult {
  const candidate = parseJsonCandidate(response);
  if (!Array.isArray(candidate.tasks) || candidate.tasks.length === 0) {
    throw new Error("PM draft must include at least one task.");
  }
  if (candidate.tasks.length > MAX_DRAFT_TASKS) {
    throw new Error(`PM draft contains more than ${MAX_DRAFT_TASKS} tasks.`);
  }

  const memberIds = new Set(members.filter((member) => member.available).map((member) => member.id));
  const usedKeys = new Set<string>();
  const tasks = candidate.tasks.map((entry, index): WorkgroupTaskDraftProposal => {
    const item = entry && typeof entry === "object" && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : {};
    const title = normalizeText(item.title, 240);
    if (!title) {
      throw new Error(`PM draft task ${index + 1} needs a title.`);
    }
    const rawDependencies = Array.isArray(item.dependsOnKeys)
      ? item.dependsOnKeys
      : (Array.isArray(item.dependsOn) ? item.dependsOn : []);
    return {
      key: normalizeKey(item.key, index, usedKeys),
      title,
      description: normalizeText(item.description),
      acceptanceCriteria: normalizeText(item.acceptanceCriteria),
      priority: normalizePriority(item.priority),
      assigneeMemberId: typeof item.assigneeMemberId === "string" && memberIds.has(item.assigneeMemberId)
        ? item.assigneeMemberId
        : null,
      dependsOnKeys: Array.from(new Set(rawDependencies
        .filter((dependency): dependency is string => typeof dependency === "string")
        .map((dependency) => dependency.trim().toLowerCase())
        .filter(Boolean))),
    };
  });

  const knownKeys = new Set(tasks.map((task) => task.key));
  for (const task of tasks) {
    task.dependsOnKeys = task.dependsOnKeys.filter((key) => key !== task.key && knownKeys.has(key));
  }
  if (hasDependencyCycle(tasks)) {
    throw new Error("PM draft contains cyclic task dependencies.");
  }
  return {
    summary: normalizeText(candidate.summary, 1_200),
    tasks,
  };
}

export function buildWorkgroupTaskDraftPrompt(data: {
  workgroupName: string;
  goal: string;
  members: WorkgroupTaskDraftMember[];
}): string {
  const members = data.members.map((member) => ({
    id: member.id,
    name: member.name,
    specialty: member.specialty,
    available: member.available,
  }));
  return [
    "You are the virtual PM for a swarm workgroup.",
    "Create a task-graph proposal only. Do not execute commands, inspect files, send messages, modify files, or dispatch work.",
    "This proposal remains inactive until a human explicitly confirms it.",
    `Workgroup: ${data.workgroupName}`,
    `Goal: ${data.goal}`,
    `Eligible members: ${JSON.stringify(members)}`,
    "Return exactly one JSON object and no prose or Markdown.",
    "Schema:",
    JSON.stringify({
      summary: "short explanation of the plan",
      tasks: [{
        key: "stable-short-key",
        title: "concrete task title",
        description: "scope and expected handoff",
        acceptanceCriteria: "verifiable completion condition",
        priority: "low | normal | high",
        assigneeMemberId: "an exact eligible member id, or null",
        dependsOnKeys: ["key of prerequisite task"],
      }],
    }, null, 2),
    "Use at most 20 tasks. Dependencies may only reference keys in this response and must be acyclic.",
    "Only assign an eligible member when the match is clear; otherwise use null.",
  ].join("\n");
}
