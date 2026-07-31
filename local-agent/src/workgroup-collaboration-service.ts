import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import appLogger from "./app-logger";
import RuntimeManager from "./runtime-manager";
import type RemoteSessionStore from "./remote-session-store";
import workgroupStore, { Workgroup, WorkgroupMember, WorkgroupRole } from "./workgroup-store";
import workgroupCollaborationStore, {
  WorkgroupCollaborationMessage,
  WorkgroupCollaborationProjectKind,
} from "./workgroup-collaboration-store";
import type { ProjectSessionSnapshot } from "./runtime-types";
import { createWorkgroupCollaborationSnapshotRevision } from "./workgroup-collaboration-relay-payload";

const DEFAULT_HISTORY_PAGE_SIZE = 30;
const DEFAULT_CONTEXT_MESSAGE_COUNT = 16;
const LOCAL_MEMBER_RESPONSE_GRACE_MS = 15_000;
const REMOTE_MEMBER_RESPONSE_GRACE_MS = 10 * 60_000;

export interface CollaborationBoundProject {
  id: string;
  name: string;
  path: string;
  kind: "local" | "remote";
  online: boolean;
}

export interface WorkgroupCollaborationMemberSnapshot {
  id: string;
  name: string;
  role: WorkgroupRole;
  projectId: string | null;
  projectName: string | null;
  projectKind: WorkgroupCollaborationProjectKind;
  projectOnline: boolean;
  hasBinding: boolean;
  isRunning: boolean;
}

export interface WorkgroupCollaborationSummary {
  id: string;
  name: string;
  description: string | null;
  updatedAt: number;
  isRunning: boolean;
  lastMessagePreview: string | null;
  messageCount: number;
  memberCount: number;
}

export interface WorkgroupCollaborationSessionSnapshot {
  workgroupId: string;
  workgroupName: string;
  description: string | null;
  allowDirectMemberMessages: boolean;
  updatedAt: number;
  isRunning: boolean;
  messageTotal: number;
  snapshotRevision: string;
  members: WorkgroupCollaborationMemberSnapshot[];
  messages: WorkgroupCollaborationMessage[];
}

interface WorkgroupHistoryPage {
  items: WorkgroupCollaborationMessage[];
  hasMore: boolean;
  total: number;
}

interface CollaborationServiceOptions {
  runtimeManager: RuntimeManager;
  getBoundProject: (projectId: string) => CollaborationBoundProject | null;
  getProjectSessionSnapshot: (projectId: string) => ProjectSessionSnapshot | null;
  getRemoteSessionStore: () => RemoteSessionStore | null;
  resolveWriteWorkspace?: (workgroup: Workgroup, member: WorkgroupMember, project: CollaborationBoundProject) => Promise<string>;
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeRoleMention(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

interface MentionRange {
  start: number;
  end: number;
}

const PROJECT_MANAGER_MENTION_ALIASES = [
  "pm",
  "pmagent",
  "projectmanager",
  "manager",
  "\u9879\u76ee\u7ecf\u7406",
];

const EVERYONE_MENTION_ALIASES = ["all", "\u5168\u90e8"];

function isMentionPrefixBoundary(value: string | undefined): boolean {
  return !value || !/[a-z0-9_]/i.test(value);
}

function isMentionSuffixBoundary(value: string | undefined): boolean {
  return !value || !/[a-z0-9_]/i.test(value);
}

function stripMentionToken(value: string): string {
  return value.replace(/[.,!?;:)\]>"'\uFF0C\u3002\uFF1F\uFF01\uFF1B\uFF1A\u3001\u3011\u300B\u300D\u300F]+$/g, "").trim();
}

function findMentionRanges(content: string, token: string): MentionRange[] {
  const normalizedToken = token.trim().toLowerCase();
  if (!normalizedToken) {
    return [];
  }

  const needle = `@${normalizedToken}`;
  const ranges: MentionRange[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const start = content.indexOf(needle, cursor);
    if (start < 0) {
      break;
    }
    const end = start + needle.length;
    const prefix = start > 0 ? content[start - 1] : undefined;
    const suffix = end < content.length ? content[end] : undefined;
    if (isMentionPrefixBoundary(prefix) && isMentionSuffixBoundary(suffix)) {
      ranges.push({ start, end });
    }
    cursor = start + needle.length;
  }
  return ranges;
}

function extractMentionTokens(content: string, matchedRanges: MentionRange[] = []): string[] {
  const mentions: string[] = [];
  const seen = new Set<string>();
  const pattern = /@([^\s@]+)/g;
  let match: RegExpExecArray | null = pattern.exec(content);

  while (match) {
    const start = match.index;
    const prefix = start > 0 ? content[start - 1] : undefined;
    if (
      isMentionPrefixBoundary(prefix)
      && !matchedRanges.some((range) => start >= range.start && start < range.end)
    ) {
      const rawToken = stripMentionToken(match[1] ?? "");
      const normalizedToken = normalizeRoleMention(rawToken);
      if (normalizedToken && !seen.has(normalizedToken)) {
        seen.add(normalizedToken);
        mentions.push(rawToken);
      }
    }
    match = pattern.exec(content);
  }

  return mentions;
}

function isProjectManagerMentionToken(token: string): boolean {
  return PROJECT_MANAGER_MENTION_ALIASES.includes(normalizeRoleMention(token));
}

function buildMemberMentionTokens(member: WorkgroupMember): string[] {
  const tokens = new Set<string>();
  const name = member.name.trim();
  if (name) {
    tokens.add(name.toLowerCase());
    tokens.add(normalizeRoleMention(name));
  }

  return Array.from(tokens).filter(Boolean);
}

function buildMessageLabel(message: WorkgroupCollaborationMessage): string {
  if (message.senderType === "member") {
    const role = message.memberRole === "project_manager" ? " (PM)" : "";
    return `${message.senderName}${role}`;
  }
  if (message.senderType === "error") {
    return `${message.senderName} error`;
  }
  return message.senderName;
}

function queuePlaceholderText(member: WorkgroupMember): string {
  return `${member.name} is preparing a response...`;
}

function summarizeMessageContent(content: string, maxLength = 160): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatMentionList(mentions: string[]): string {
  return mentions.map((mention) => `@${mention}`).join(", ");
}

function formatMemberMentionList(members: Pick<WorkgroupMember, "name">[]): string {
  return formatMentionList(members.map((member) => member.name));
}

interface ResolvedTargetSelection {
  targets: WorkgroupMember[];
  mode: "passive" | "explicit";
  unmatchedMentions?: string[];
}

interface ResolveTargetOptions {
  requireExplicitMention?: boolean;
  excludeMemberIds?: string[];
}

interface ActiveDispatchRecord {
  runId: string;
  workgroupId: string;
  rootTriggerMessageId: string;
  memberId: string;
  projectId: string;
  messageId: string;
  triggerMessageId: string;
  startedAt: number;
}

interface RemoteDispatchResolution {
  status: "pending" | "streaming" | "done" | "error";
  content?: string;
}

interface DispatchAttemptResult {
  memberId: string;
  memberName: string;
  projectId: string | null;
  runId?: string;
  accepted: boolean;
  reason?: string;
}

export default class WorkgroupCollaborationService extends EventEmitter {
  private readonly activeDispatchesByWorkgroup = new Map<string, Map<string, ActiveDispatchRecord>>();
  private readonly activeWriterRunByWorkspace = new Map<string, string>();

  constructor(private readonly options: CollaborationServiceOptions) {
    super();
  }

  listSummaries(): WorkgroupCollaborationSummary[] {
    return workgroupStore
      .listWorkgroups()
      .map((workgroup) => {
        this.reconcileStaleStreamingMessages(workgroup);
        return this.buildSummary(workgroup);
      })
      .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name, "zh-CN"));
  }

  getSession(workgroupId: string): WorkgroupCollaborationSessionSnapshot | null {
    const workgroup = workgroupStore.getWorkgroupById(workgroupId);
    if (!workgroup) {
      return null;
    }

    this.reconcileStaleStreamingMessages(workgroup);
    const historyPage = workgroupCollaborationStore.getHistoryPage(workgroup.id, {
      limit: DEFAULT_HISTORY_PAGE_SIZE,
    });
    const members = this.buildMemberSnapshots(workgroup);
    const updatedAt = Math.max(
      workgroup.updatedAt,
      workgroupCollaborationStore.getSession(workgroup.id)?.updatedAt ?? 0,
      historyPage.items[historyPage.items.length - 1]?.updatedAt ?? 0,
    );

    const snapshot: WorkgroupCollaborationSessionSnapshot = {
      workgroupId: workgroup.id,
      workgroupName: workgroup.name,
      description: normalizeText(workgroup.description),
      allowDirectMemberMessages: Boolean(workgroup.allowDirectMemberMessages),
      updatedAt,
      isRunning: this.computeWorkgroupRunningState(workgroup.id),
      messageTotal: historyPage.total,
      snapshotRevision: "",
      members,
      messages: historyPage.items,
    };
    return {
      ...snapshot,
      snapshotRevision: createWorkgroupCollaborationSnapshotRevision(snapshot),
    };
  }

  getHistoryPage(
    workgroupId: string,
    options: {
      beforeId?: string | null;
      limit?: number;
    } = {},
  ): WorkgroupHistoryPage | null {
    const workgroup = workgroupStore.getWorkgroupById(workgroupId);
    if (!workgroup) {
      return null;
    }
    return workgroupCollaborationStore.getHistoryPage(workgroup.id, options);
  }

  searchMessages(
    workgroupId: string,
    options: {
      query: string;
      limit?: number;
    },
  ): WorkgroupCollaborationMessage[] | null {
    const workgroup = workgroupStore.getWorkgroupById(workgroupId);
    if (!workgroup) {
      return null;
    }

    const query = options.query.trim().toLowerCase();
    if (!query) {
      return [];
    }

    const limit = Number(options.limit) > 0 ? Math.max(1, Number(options.limit)) : 200;
    return workgroupCollaborationStore
      .listMessages(workgroup.id)
      .filter((message) => {
        const haystack = [
          message.senderType,
          message.senderName,
          message.memberRole ?? "",
          message.content,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .slice(-limit);
  }

  notifyWorkgroupStructureChanged(workgroupId?: string | null): void {
    const normalizedWorkgroupId = workgroupId?.trim() || "";
    if (normalizedWorkgroupId) {
      this.emitSnapshot(normalizedWorkgroupId);
    }
    this.emitSummaries();
  }

  removeWorkgroup(workgroupId: string): void {
    this.activeDispatchesByWorkgroup.delete(String(workgroupId ?? "").trim());
    workgroupCollaborationStore.removeSession(workgroupId);
    this.emitSummaries();
  }

  private logWorkgroupEvent(
    level: "info" | "warn" | "error",
    message: string,
    meta: Record<string, unknown>,
  ): void {
    if (level === "warn") {
      appLogger.warn("workgroup-collaboration", message, meta);
      return;
    }
    if (level === "error") {
      appLogger.error("workgroup-collaboration", message, meta);
      return;
    }
    appLogger.info("workgroup-collaboration", message, meta);
  }

  private buildWorkgroupLogMeta(
    workgroup: Pick<Workgroup, "id" | "name">,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      workgroupId: workgroup.id,
      workgroupName: workgroup.name,
      ...extra,
    };
  }

  async sendUserMessage(
    workgroupId: string,
    content: string,
    clientMessageId?: string,
  ): Promise<{ success: boolean; error?: string; session?: WorkgroupCollaborationSessionSnapshot }> {
    const workgroup = workgroupStore.getWorkgroupById(workgroupId);
    if (!workgroup) {
      return { success: false, error: "Workgroup not found" };
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      return { success: false, error: "Message cannot be empty" };
    }

    const normalizedClientMessageId = clientMessageId?.trim() || "";
    if (normalizedClientMessageId) {
      const existingMessage = workgroupCollaborationStore.getMessage(workgroup.id, normalizedClientMessageId);
      if (existingMessage?.senderType === "user") {
        this.logWorkgroupEvent(
          "info",
          "Deduped workgroup user message by clientMessageId.",
          this.buildWorkgroupLogMeta(workgroup, {
            traceId: existingMessage.id,
            clientMessageId: normalizedClientMessageId,
            contentPreview: summarizeMessageContent(trimmedContent),
          }),
        );
        const session = this.getSession(workgroup.id);
        return {
          success: true,
          session: session ?? undefined,
        };
      }
    }

    const members = this.listCollaborativeMembers(workgroup.id);
    const selection = this.resolveTargets(workgroup, members, trimmedContent);
    const userMessage = workgroupCollaborationStore.appendMessage(workgroup.id, {
      id: normalizedClientMessageId || undefined,
      senderType: "user",
      senderName: "You",
      content: trimmedContent,
      status: "done",
    });
    this.logWorkgroupEvent(
      "info",
      "Accepted workgroup user message.",
      this.buildWorkgroupLogMeta(workgroup, {
        traceId: userMessage.id,
        clientMessageId: normalizedClientMessageId || null,
        routeMode: selection.mode,
        targetCount: selection.targets.length,
        targetMemberIds: selection.targets.map((member) => member.id),
        targetMemberNames: selection.targets.map((member) => member.name),
        unmatchedMentions: selection.unmatchedMentions ?? [],
        contentPreview: summarizeMessageContent(trimmedContent),
      }),
    );

    if (selection.mode === "passive") {
      this.logWorkgroupEvent(
        "info",
        "Workgroup user message was kept in collaboration chat without dispatch.",
        this.buildWorkgroupLogMeta(workgroup, {
          traceId: userMessage.id,
          clientMessageId: normalizedClientMessageId || null,
          contentPreview: summarizeMessageContent(trimmedContent),
        }),
      );
      this.emitSnapshot(workgroup.id);
      this.emitSummaries();
      const session = this.getSession(workgroup.id);
      return {
        success: true,
        session: session ?? undefined,
      };
    }

    if (selection.targets.length === 0) {
      this.appendMentionRoutingFailure(workgroup.id, userMessage.id, selection);
      this.logWorkgroupEvent(
        "warn",
        "Workgroup explicit mention routing failed before dispatch.",
        this.buildWorkgroupLogMeta(workgroup, {
          traceId: userMessage.id,
          clientMessageId: normalizedClientMessageId || null,
          unmatchedMentions: selection.unmatchedMentions ?? [],
          contentPreview: summarizeMessageContent(trimmedContent),
        }),
      );
      this.emitSnapshot(workgroup.id);
      this.emitSummaries();
      const session = this.getSession(workgroup.id);
      return {
        success: true,
        session: session ?? undefined,
      };
    }

    this.appendRoutingNote(workgroup.id, userMessage.id, selection);
    this.logWorkgroupEvent(
      "info",
      "Workgroup user message routed to members.",
      this.buildWorkgroupLogMeta(workgroup, {
        traceId: userMessage.id,
        clientMessageId: normalizedClientMessageId || null,
        routeMode: selection.mode,
        targetCount: selection.targets.length,
        targetMemberIds: selection.targets.map((member) => member.id),
        targetMemberNames: selection.targets.map((member) => member.name),
        unmatchedMentions: selection.unmatchedMentions ?? [],
      }),
    );
    this.emitSnapshot(workgroup.id);
    this.emitSummaries();

    const recentMessages = workgroupCollaborationStore
      .listMessages(workgroup.id)
      .slice(-DEFAULT_CONTEXT_MESSAGE_COUNT);

    const session = this.getSession(workgroup.id);

    void Promise.all(selection.targets.map(async (member) => {
      return await this.dispatchToMember(workgroup, member, recentMessages, userMessage);
    })).catch((error) => {
      appLogger.warn("workgroup-collaboration", "Async dispatch after user message failed", {
        workgroupId: workgroup.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }).then((results) => {
      if (!Array.isArray(results) || results.length <= 1) {
        return;
      }
      this.appendDispatchSummary(workgroup.id, userMessage.id, results);
    });

    return {
      success: true,
      session: session ?? undefined,
    };
  }

  private buildSummary(workgroup: Workgroup): WorkgroupCollaborationSummary {
    const session = workgroupCollaborationStore.getSession(workgroup.id);
    const latestMessage = this.getLatestPreviewMessage(workgroup.id);
    const members = this.buildMemberSnapshots(workgroup);
    return {
      id: workgroup.id,
      name: workgroup.name,
      description: normalizeText(workgroup.description),
      updatedAt: Math.max(workgroup.updatedAt, session?.updatedAt ?? 0, latestMessage?.updatedAt ?? 0),
      isRunning: this.computeWorkgroupRunningState(workgroup.id),
      lastMessagePreview: latestMessage?.content?.trim()
        ? latestMessage.content.trim().replace(/\s+/g, " ").slice(0, 120)
        : null,
      messageCount: session?.messages.length ?? 0,
      memberCount: members.length,
    };
  }

  private getLatestPreviewMessage(workgroupId: string): WorkgroupCollaborationMessage | null {
    const messages = workgroupCollaborationStore.listMessages(workgroupId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message.content.trim()) {
        continue;
      }
      if (message.senderType !== "system") {
        return message;
      }
    }
    return messages[messages.length - 1] ?? null;
  }

  private buildMemberSnapshots(workgroup: Workgroup): WorkgroupCollaborationMemberSnapshot[] {
    return this.listCollaborativeMembers(workgroup.id)
      .map((member) => {
        const project = member.projectId ? this.options.getBoundProject(member.projectId) : null;
        const projectSnapshot = project?.id
          ? this.options.getProjectSessionSnapshot(project.id)
          : null;
        return {
          id: member.id,
          name: member.name,
          role: (member.kind === "pm" ? "project_manager" : "member") as WorkgroupRole,
          projectId: normalizeText(member.projectId),
          projectName: project?.name ?? normalizeText(member.projectName),
          projectKind: project?.kind ?? (member.projectKind ?? null),
          projectOnline: project?.online ?? false,
          hasBinding: Boolean(project),
          isRunning: Boolean(projectSnapshot?.isRunning),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }

  private listCollaborativeMembers(workgroupId: string): WorkgroupMember[] {
    return workgroupStore
      .listMembers(workgroupId)
      .filter((member) => member.kind !== "pm");
  }

  private computeWorkgroupRunningState(workgroupId: string): boolean {
    const activeDispatches = this.activeDispatchesByWorkgroup.get(workgroupId);
    if (activeDispatches && activeDispatches.size > 0) {
      return true;
    }

    return workgroupCollaborationStore
      .listMessages(workgroupId)
      .some((message) => {
        if (message.senderType !== "member" || message.status !== "streaming") {
          return false;
        }
        const projectId = message.projectId?.trim() ?? "";
        if (!projectId) {
          return false;
        }
        return Boolean(this.options.getProjectSessionSnapshot(projectId)?.isRunning);
      });
  }

  private reconcileStaleStreamingMessages(workgroup: Workgroup): void {
    const messages = workgroupCollaborationStore.listMessages(workgroup.id);
    let changed = this.repairRecoveredMemberMessages(workgroup.id);
    changed = this.pruneDuplicateStreamingMessages(workgroup.id) || changed;

    for (const message of messages) {
      if (message.senderType !== "member" || message.status !== "streaming") {
        continue;
      }

      const dispatchRunId = message.dispatchRunId?.trim() ?? "";
      const projectId = message.projectId?.trim() ?? "";
      if (!projectId) {
        this.clearActiveDispatch(workgroup.id, dispatchRunId);
        this.finalizeStaleMemberMessage(workgroup.id, message.id, message.senderName, message.content);
        changed = true;
        continue;
      }

      const snapshot = this.options.getProjectSessionSnapshot(projectId);
      const remoteResolution = this.resolveRemoteDispatchResolution(message, snapshot);
      if (remoteResolution.status === "streaming" || remoteResolution.status === "done") {
        if (remoteResolution.status === "done") {
          this.clearActiveDispatch(workgroup.id, dispatchRunId);
        }
        changed = this.updateMessageIfChanged(workgroup.id, message, {
          senderType: "member",
          status: remoteResolution.status === "streaming" ? "streaming" : "done",
          content: remoteResolution.content ?? message.content,
        }) || changed;
        continue;
      }
      if (remoteResolution.status === "error") {
        this.clearActiveDispatch(workgroup.id, dispatchRunId);
        changed = this.updateMessageIfChanged(workgroup.id, message, {
          senderType: "error",
          status: "done",
          content: remoteResolution.content?.trim() || `${message.senderName} failed to respond.`,
        }) || changed;
        continue;
      }
      if (dispatchRunId && this.hasActiveDispatch(workgroup.id, dispatchRunId)) {
        continue;
      }
      if (snapshot?.isRunning) {
        continue;
      }
      if (this.shouldWaitForMemberResponse(message, snapshot)) {
        continue;
      }

      this.clearActiveDispatch(workgroup.id, dispatchRunId);
      this.finalizeStaleMemberMessage(workgroup.id, message.id, message.senderName, message.content);
      changed = true;
    }

    if (this.pruneDetachedActiveDispatches(workgroup.id)) {
      changed = true;
    }

    if (changed) {
      this.emitSnapshot(workgroup.id);
    }
  }

  private updateMessageIfChanged(
    workgroupId: string,
    current: WorkgroupCollaborationMessage,
    patch: Partial<Pick<WorkgroupCollaborationMessage, "senderType" | "status" | "content">>,
  ): boolean {
    const nextSenderType = patch.senderType ?? current.senderType;
    const nextStatus = patch.status ?? current.status;
    const nextContent = patch.content ?? current.content;
    if (
      nextSenderType === current.senderType
      && nextStatus === current.status
      && nextContent === current.content
    ) {
      return false;
    }
    workgroupCollaborationStore.updateMessage(workgroupId, current.id, patch);
    return true;
  }

  private resolveTargets(
    workgroup: Workgroup,
    members: WorkgroupMember[],
    content: string,
    options: ResolveTargetOptions = {},
  ): ResolvedTargetSelection {
    const normalizedContent = content.toLowerCase();
    const matchedRanges: MentionRange[] = [];
    const allMentioned = EVERYONE_MENTION_ALIASES.some((alias) => {
      const ranges = findMentionRanges(normalizedContent, alias);
      if (ranges.length > 0) {
        matchedRanges.push(...ranges);
        return true;
      }
      return false;
    });
    const excludedIds = new Set((options.excludeMemberIds ?? []).map((entry) => entry.trim()).filter(Boolean));
    const boundMembers = members.filter((member) => {
      if (excludedIds.has(member.id)) {
        return false;
      }
      if (!member.projectId) {
        return false;
      }
      const project = this.options.getBoundProject(member.projectId);
      return Boolean(project);
    });

    if (allMentioned) {
      return {
        targets: boundMembers,
        mode: "explicit",
        unmatchedMentions: extractMentionTokens(content, matchedRanges),
      };
    }

    if (boundMembers.length === 0) {
      const unmatchedMentions = extractMentionTokens(content);
      return {
        targets: [],
        mode: unmatchedMentions.length > 0 || options.requireExplicitMention ? "explicit" : "passive",
        unmatchedMentions,
      };
    }

    const matchedMembers = new Map<string, WorkgroupMember>();
    for (const member of boundMembers) {
      const mentionTokens = buildMemberMentionTokens(member);
      const memberMatched = mentionTokens.some((token) => {
        const ranges = findMentionRanges(normalizedContent, token);
        if (ranges.length > 0) {
          matchedRanges.push(...ranges);
          return true;
        }
        return false;
      });
      if (memberMatched) {
        matchedMembers.set(member.id, member);
      }
    }

    const unmatchedMentions = extractMentionTokens(content, matchedRanges);
    if (matchedMembers.size > 0) {
      return {
        targets: Array.from(matchedMembers.values()),
        mode: "explicit",
        unmatchedMentions,
      };
    }

    if (unmatchedMentions.length > 0 || options.requireExplicitMention) {
      return {
        targets: [],
        mode: "explicit",
        unmatchedMentions,
      };
    }

    return {
      targets: [],
      mode: "passive",
      unmatchedMentions: [],
    };
  }

  private appendRoutingNote(
    workgroupId: string,
    triggerMessageId: string,
    selection: ResolvedTargetSelection,
  ): void {
    if (selection.targets.length === 0) {
      return;
    }

    const memberMentions = formatMemberMentionList(selection.targets);
    const unmatchedMentions = selection.unmatchedMentions ?? [];
    const unmatchedSummary = unmatchedMentions.length > 0
      ? ` Unmatched: ${formatMentionList(unmatchedMentions)}.`
      : "";
    const content = `Routing queued for ${memberMentions}${unmatchedSummary}`;

    workgroupCollaborationStore.appendMessage(workgroupId, {
      senderType: "system",
      senderName: "System",
      triggerMessageId,
      content,
      status: "done",
    });
  }

  private appendMentionRoutingFailure(
    workgroupId: string,
    triggerMessageId: string,
    selection: ResolvedTargetSelection,
  ): void {
    const unmatchedMentions = selection.unmatchedMentions ?? [];
    const content = unmatchedMentions.length === 0
      ? "Explicit routing failed: no available bound members matched this message."
      : unmatchedMentions.length === 1 && isProjectManagerMentionToken(unmatchedMentions[0] ?? "")
        ? `PM routing failed: no available PM matched @${unmatchedMentions[0]}.`
        : `Mention routing failed: no member matched ${formatMentionList(unmatchedMentions)}.`;

    workgroupCollaborationStore.appendMessage(workgroupId, {
      senderType: "error",
      senderName: "System",
      triggerMessageId,
      content,
      status: "done",
    });
  }

  private appendHandoffRoutingFailure(
    workgroupId: string,
    triggerMessageId: string,
    sender: WorkgroupMember,
    unmatchedMentions: string[],
  ): void {
    const content = unmatchedMentions.length === 0
      ? `Handoff from @${sender.name} failed: no eligible member could be routed.`
      : `Handoff from @${sender.name} failed: no member matched ${formatMentionList(unmatchedMentions)}.`;

    workgroupCollaborationStore.appendMessage(workgroupId, {
      senderType: "error",
      senderName: "System",
      triggerMessageId,
      content,
      status: "done",
    });
  }

  private appendHandoffSkipNote(
    workgroupId: string,
    triggerMessageId: string,
    sender: WorkgroupMember,
    skippedTargets: WorkgroupMember[],
    unmatchedMentions: string[],
  ): void {
    const skippedSummary = skippedTargets.length === 1
      ? `${formatMemberMentionList(skippedTargets)} already handled this request`
      : `${formatMemberMentionList(skippedTargets)} already handled this request`;
    const unmatchedSummary = unmatchedMentions.length > 0
      ? ` Unmatched: ${formatMentionList(unmatchedMentions)}.`
      : "";

    workgroupCollaborationStore.appendMessage(workgroupId, {
      senderType: "system",
      senderName: "System",
      triggerMessageId,
      content: `Handoff from @${sender.name} skipped: ${skippedSummary}.${unmatchedSummary}`,
      status: "done",
    });
  }

  private buildPrompt(
    workgroup: Workgroup,
    member: WorkgroupMember,
    recentMessages: WorkgroupCollaborationMessage[],
    userMessage: WorkgroupCollaborationMessage,
  ): string {
    const project = member.projectId ? this.options.getBoundProject(member.projectId) : null;
    const allowedPaths = Array.isArray(member.allowedPaths) && member.allowedPaths.length > 0
      ? member.allowedPaths.map((entry) => `- ${entry}`).join("\n")
      : "- No extra path restriction configured.";
    const customPrompt = member.systemPrompt?.trim()
      ? `Additional member instructions:\n${member.systemPrompt.trim()}\n`
      : "";
    const transcript = recentMessages
      .slice(-DEFAULT_CONTEXT_MESSAGE_COUNT)
      .map((message) => {
        const content = message.content.trim() || (message.status === "streaming" ? "[streaming]" : "[empty]");
        return `[${buildMessageLabel(message)}] ${content}`;
      })
      .join("\n");

    return [
      "Shared workgroup collaboration context",
      `Workgroup: ${workgroup.name}`,
      `Group announcement: ${workgroup.description?.trim() || "None"}`,
      `You are: ${member.name}`,
      `Bound project: ${project?.name ?? member.projectName ?? member.projectId ?? "unknown"}`,
      "",
      "Operating rules",
      "You are one member in a shared multi-agent group. Complete only the work you actually perform inside your bound project.",
      "Reply only for your own completed work. Do not fabricate work from other members.",
      member.executionMode === "write"
        ? "You may modify files only when the approved request requires it; keep changes within the bound project and report every validation you ran."
        : "You are a read-only contributor: analyze, plan, review, or test, but do not modify files.",
      workgroup.allowDirectMemberMessages
        ? "You may @mention other members when coordination helps, but only report work you actually completed."
        : "Do not simulate other members. Report only your own work and blockers.",
      "Stay inside your bound project and allowed paths.",
      allowedPaths,
      customPrompt.trim(),
      customPrompt ? "" : "",
      "Recent shared transcript",
      transcript || "[No earlier transcript]",
      "",
      "Latest message to respond to",
      userMessage.content.trim(),
      "",
      "Response requirements",
      "Reply in first person as yourself, keep it concise, and include what you completed, what you validated, blockers, and any needed follow-up.",
    ]
      .filter((entry, index, source) => !(entry === "" && source[index - 1] === ""))
      .join("\n");
  }

  private async dispatchToMember(
    workgroup: Workgroup,
    member: WorkgroupMember,
    recentMessages: WorkgroupCollaborationMessage[],
    userMessage: WorkgroupCollaborationMessage,
  ): Promise<DispatchAttemptResult> {
    const projectId = member.projectId?.trim() ?? "";
    if (!projectId) {
      const reason = "Member has no bound project.";
      this.appendDispatchError(workgroup.id, member, reason);
      this.logWorkgroupEvent(
        "warn",
        "Rejected workgroup member dispatch because the member has no bound project.",
        this.buildWorkgroupLogMeta(workgroup, {
          traceId: userMessage.id,
          memberId: member.id,
          memberName: member.name,
          memberRole: member.role,
          projectId: null,
          reason,
        }),
      );
      return { memberId: member.id, memberName: member.name, projectId: null, accepted: false, reason };
    }

    const project = this.options.getBoundProject(projectId);
    if (!project) {
      const reason = "Bound project is unavailable.";
      this.appendDispatchError(workgroup.id, member, reason);
      this.logWorkgroupEvent(
        "warn",
        "Rejected workgroup member dispatch because the bound project was unavailable.",
        this.buildWorkgroupLogMeta(workgroup, {
          traceId: userMessage.id,
          memberId: member.id,
          memberName: member.name,
          memberRole: member.role,
          projectId,
          reason,
        }),
      );
      return { memberId: member.id, memberName: member.name, projectId, accepted: false, reason };
    }

    if (project.kind === "remote" && !project.online) {
      const reason = "Remote member project is offline.";
      this.appendDispatchError(workgroup.id, member, reason);
      this.logWorkgroupEvent(
        "warn",
        "Rejected workgroup member dispatch because the remote project was offline.",
        this.buildWorkgroupLogMeta(workgroup, {
          traceId: userMessage.id,
          memberId: member.id,
          memberName: member.name,
          memberRole: member.role,
          projectId,
          reason,
        }),
      );
      return { memberId: member.id, memberName: member.name, projectId, accepted: false, reason };
    }

    let executionProject = project;
    if (project.kind === "local" && member.executionMode === "write" && this.options.resolveWriteWorkspace) {
      try {
        executionProject = { ...project, path: await this.options.resolveWriteWorkspace(workgroup, member, project) };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.appendDispatchError(workgroup.id, member, reason);
        return { memberId: member.id, memberName: member.name, projectId: project.id, accepted: false, reason };
      }
    }

    const runId = uuidv4();
    const writeLockReason = this.acquireWriteSlot(workgroup, member, executionProject, runId, userMessage);
    if (writeLockReason) {
      this.appendDispatchError(workgroup.id, member, writeLockReason);
      return { memberId: member.id, memberName: member.name, projectId: project.id, accepted: false, reason: writeLockReason };
    }
    const rootTriggerMessageId = this.resolveRootTriggerMessageId(workgroup.id, userMessage) ?? userMessage.id;
    const replyMessage = workgroupCollaborationStore.appendMessage(workgroup.id, {
      senderType: "member",
      senderName: member.name,
      memberId: member.id,
      memberRole: member.role,
      projectId: project.id,
      projectKind: project.kind,
      dispatchRunId: runId,
      triggerMessageId: userMessage.id,
      content: "",
      status: "streaming",
    });
    this.registerActiveDispatch({
      runId,
      workgroupId: workgroup.id,
      rootTriggerMessageId,
      memberId: member.id,
      projectId: project.id,
      messageId: replyMessage.id,
      triggerMessageId: userMessage.id,
      startedAt: Date.now(),
    });
    this.logWorkgroupEvent(
      "info",
      "Queued workgroup member dispatch.",
      this.buildWorkgroupLogMeta(workgroup, {
        traceId: rootTriggerMessageId,
        triggerMessageId: userMessage.id,
        dispatchRunId: runId,
        memberId: member.id,
        memberName: member.name,
        memberRole: member.role,
        projectId: project.id,
        projectKind: project.kind,
      }),
    );
    this.emitSnapshot(workgroup.id);
    this.emitSummaries();

    const prompt = this.buildPrompt(workgroup, member, recentMessages, userMessage);
    const handleText = (chunk: string) => {
      const current = workgroupCollaborationStore.getMessage(workgroup.id, replyMessage.id);
      const stalePrefix = `${member.name} stopped before replying.`;
      if (current && current.content.startsWith(stalePrefix)) {
        const recoveredContent = current.content.slice(stalePrefix.length).trimStart();
        workgroupCollaborationStore.updateMessage(workgroup.id, replyMessage.id, {
          senderType: "member",
          status: "streaming",
          content: `${recoveredContent}${chunk}`,
        });
      } else {
        workgroupCollaborationStore.appendToMessage(workgroup.id, replyMessage.id, chunk);
      }
      this.emitSnapshot(workgroup.id);
      this.emitSummaries();
    };
    const handleDone = () => {
      this.clearActiveDispatch(workgroup.id, runId);
      const current = workgroupCollaborationStore.getMessage(workgroup.id, replyMessage.id);
      const finalizedMessage = workgroupCollaborationStore.updateMessage(workgroup.id, replyMessage.id, {
        content: current?.content?.trim() ? current.content : queuePlaceholderText(member),
        status: "done",
      });
      this.logWorkgroupEvent(
        "info",
        "Completed workgroup member dispatch.",
        this.buildWorkgroupLogMeta(workgroup, {
          traceId: rootTriggerMessageId,
          triggerMessageId: userMessage.id,
          dispatchRunId: runId,
          memberId: member.id,
          memberName: member.name,
          memberRole: member.role,
          projectId: project.id,
          replyMessageId: replyMessage.id,
          contentLength: finalizedMessage?.content?.trim().length ?? 0,
        }),
      );
      this.emitSnapshot(workgroup.id);
      this.emitSummaries();
      if (finalizedMessage && finalizedMessage.senderType === "member") {
        void this.dispatchMemberHandoffs(workgroup, member, finalizedMessage);
      }
    };
    const handleError = (error: string) => {
      this.clearActiveDispatch(workgroup.id, runId);
      workgroupCollaborationStore.updateMessage(workgroup.id, replyMessage.id, {
        senderType: "error",
        content: error.trim() || `${member.name} failed to respond.`,
        status: "done",
      });
      this.logWorkgroupEvent(
        "warn",
        "Failed workgroup member dispatch.",
        this.buildWorkgroupLogMeta(workgroup, {
          traceId: rootTriggerMessageId,
          triggerMessageId: userMessage.id,
          dispatchRunId: runId,
          memberId: member.id,
          memberName: member.name,
          memberRole: member.role,
          projectId: project.id,
          replyMessageId: replyMessage.id,
          error: error.trim() || `${member.name} failed to respond.`,
        }),
      );
      this.emitSnapshot(workgroup.id);
      this.emitSummaries();
    };

    if (project.kind === "remote") {
      const remoteSessionStore = this.options.getRemoteSessionStore();
      if (!remoteSessionStore) {
        const reason = "Remote controller is unavailable.";
        handleError(reason);
        return { memberId: member.id, memberName: member.name, projectId: project.id, runId, accepted: false, reason };
      }

      const result = await remoteSessionStore.sendPrompt(project.id, prompt, undefined, {
        runId,
        source: "workgroup",
        onTextDelta: handleText,
        onDone: handleDone,
        onError: handleError,
      });
      if (!result.success) {
        const reason = result.error ?? "Remote dispatch failed.";
        handleError(reason);
        return { memberId: member.id, memberName: member.name, projectId: project.id, runId, accepted: false, reason };
      }
      this.logWorkgroupEvent(
        "info",
        "Accepted remote workgroup member dispatch.",
        this.buildWorkgroupLogMeta(workgroup, {
          traceId: rootTriggerMessageId,
          triggerMessageId: userMessage.id,
          dispatchRunId: runId,
          memberId: member.id,
          memberName: member.name,
          memberRole: member.role,
          projectId: project.id,
          projectKind: project.kind,
        }),
      );
      return { memberId: member.id, memberName: member.name, projectId: project.id, runId, accepted: true };
    }

    this.options.runtimeManager.enqueueMessage({
      projectId: project.id,
      cwd: executionProject.path,
      prompt,
      source: "workgroup",
      runId,
      responseMessageId: replyMessage.id,
      onTextDelta: handleText,
      onDone: handleDone,
      onError: handleError,
    });
    this.logWorkgroupEvent(
      "info",
      "Accepted local workgroup member dispatch.",
      this.buildWorkgroupLogMeta(workgroup, {
        traceId: rootTriggerMessageId,
        triggerMessageId: userMessage.id,
        dispatchRunId: runId,
        memberId: member.id,
        memberName: member.name,
        memberRole: member.role,
        projectId: project.id,
        projectKind: project.kind,
      }),
    );
    return { memberId: member.id, memberName: member.name, projectId: project.id, runId, accepted: true };
  }

  private async dispatchMemberHandoffs(
    workgroup: Workgroup,
    sender: WorkgroupMember,
    sourceMessage: WorkgroupCollaborationMessage,
  ): Promise<void> {
    const senderCanHandoff = workgroup.allowDirectMemberMessages;
    if (!senderCanHandoff) {
      return;
    }

    const members = this.listCollaborativeMembers(workgroup.id);
    const selection = this.resolveTargets(workgroup, members, sourceMessage.content, {
      requireExplicitMention: true,
      excludeMemberIds: [sender.id],
    });
    const unmatchedMentions = selection.unmatchedMentions ?? [];
    const hasExplicitMention = selection.targets.length > 0
      || unmatchedMentions.length > 0
      || EVERYONE_MENTION_ALIASES.some((alias) => findMentionRanges(sourceMessage.content.toLowerCase(), alias).length > 0);
    const rootTriggerMessageId = this.resolveRootTriggerMessageId(workgroup.id, sourceMessage);
    if (selection.targets.length === 0) {
      if (!hasExplicitMention) {
        return;
      }
      this.appendHandoffRoutingFailure(workgroup.id, sourceMessage.id, sender, unmatchedMentions);
      this.logWorkgroupEvent(
        "warn",
        "Failed workgroup member handoff because no targets could be routed.",
        this.buildWorkgroupLogMeta(workgroup, {
          traceId: rootTriggerMessageId ?? sourceMessage.id,
          triggerMessageId: sourceMessage.id,
          senderMemberId: sender.id,
          senderMemberName: sender.name,
          unmatchedMentions,
        }),
      );
      this.emitSnapshot(workgroup.id);
      this.emitSummaries();
      return;
    }

    const alreadyHandledMemberIds = rootTriggerMessageId
      ? this.collectHandledMemberIdsForRoot(workgroup.id, rootTriggerMessageId)
      : new Set<string>();
    alreadyHandledMemberIds.delete(sender.id);

    const filteredTargets = selection.targets.filter((member) => !alreadyHandledMemberIds.has(member.id));
    const skippedTargets = selection.targets.filter((member) => alreadyHandledMemberIds.has(member.id));
    if (filteredTargets.length === 0) {
      this.appendHandoffSkipNote(workgroup.id, sourceMessage.id, sender, skippedTargets, unmatchedMentions);
      this.logWorkgroupEvent(
        "info",
        "Skipped workgroup member handoff because all routed targets were already handled.",
        this.buildWorkgroupLogMeta(workgroup, {
          traceId: rootTriggerMessageId ?? sourceMessage.id,
          triggerMessageId: sourceMessage.id,
          senderMemberId: sender.id,
          senderMemberName: sender.name,
          skippedMemberIds: skippedTargets.map((member) => member.id),
          skippedMemberNames: skippedTargets.map((member) => member.name),
          unmatchedMentions,
        }),
      );
      this.emitSnapshot(workgroup.id);
      this.emitSummaries();
      return;
    }

    const routedMessage = workgroupCollaborationStore.appendMessage(workgroup.id, {
      senderType: "system",
      senderName: "System",
      triggerMessageId: sourceMessage.id,
      content: `Handoff queued from @${sender.name} to ${formatMemberMentionList(filteredTargets)}${unmatchedMentions.length > 0 ? ` Unmatched: ${formatMentionList(unmatchedMentions)}.` : ""}${skippedTargets.length > 0 ? ` Skipped: ${formatMemberMentionList(skippedTargets)} already handled this request.` : ""}`,
      status: "done",
    });
    this.logWorkgroupEvent(
      "info",
      "Created workgroup member handoff.",
      this.buildWorkgroupLogMeta(workgroup, {
        traceId: rootTriggerMessageId ?? sourceMessage.id,
        triggerMessageId: sourceMessage.id,
        handoffMessageId: routedMessage.id,
        senderMemberId: sender.id,
        senderMemberName: sender.name,
        targetMemberIds: filteredTargets.map((member) => member.id),
        targetMemberNames: filteredTargets.map((member) => member.name),
        skippedMemberIds: skippedTargets.map((member) => member.id),
        skippedMemberNames: skippedTargets.map((member) => member.name),
        unmatchedMentions,
      }),
    );
    this.emitSnapshot(workgroup.id);
    this.emitSummaries();

    const recentMessages = workgroupCollaborationStore
      .listMessages(workgroup.id)
      .slice(-DEFAULT_CONTEXT_MESSAGE_COUNT);

    await Promise.all(filteredTargets.map(async (member) => {
      await this.dispatchToMember(workgroup, member, recentMessages, sourceMessage);
    }));

    const latestSystemMessage = workgroupCollaborationStore.getMessage(workgroup.id, routedMessage.id);
    if (latestSystemMessage?.status !== "done") {
      workgroupCollaborationStore.updateMessage(workgroup.id, routedMessage.id, {
        status: "done",
      });
    }
    this.emitSnapshot(workgroup.id);
    this.emitSummaries();
  }

  private appendDispatchError(workgroupId: string, member: WorkgroupMember, error: string): void {
    workgroupCollaborationStore.appendMessage(workgroupId, {
      senderType: "error",
      senderName: member.name,
      memberId: member.id,
      memberRole: member.role,
      projectId: normalizeText(member.projectId),
      projectKind: member.projectKind ?? null,
      content: error,
      status: "done",
    });
    this.emitSnapshot(workgroupId);
    this.emitSummaries();
  }

  private appendDispatchSummary(
    workgroupId: string,
    triggerMessageId: string,
    results: DispatchAttemptResult[],
  ): void {
    const failed = results.filter((entry) => !entry.accepted);
    if (failed.length === 0) {
      return;
    }
    const acceptedCount = results.length - failed.length;
    const failedMembers = failed.map((entry) => `@${entry.memberName}`).join(", ");
    const reasonSummary = failed
      .map((entry) => `${entry.memberName}: ${entry.reason ?? "dispatch failed"}`)
      .join(" | ");
    const workgroup = workgroupStore.getWorkgroupById(workgroupId);

    const payload = acceptedCount <= 0
      ? {
          senderType: "error" as const,
          content: `Delivery failed: no member accepted this message. ${reasonSummary}`.trim(),
        }
      : {
          senderType: "system" as const,
          content: `Delivery partial: ${acceptedCount}/${results.length} members accepted. Failed: ${failedMembers}`.trim(),
        };

    workgroupCollaborationStore.appendMessage(workgroupId, {
      senderType: payload.senderType,
      senderName: "System",
      triggerMessageId,
      content: payload.content,
      status: "done",
    });
    if (workgroup) {
      this.logWorkgroupEvent(
        acceptedCount <= 0 ? "warn" : "info",
        "Recorded workgroup dispatch summary.",
        this.buildWorkgroupLogMeta(workgroup, {
          traceId: triggerMessageId,
          acceptedCount,
          failedCount: failed.length,
          failedMembers: failed.map((entry) => entry.memberName),
          failedMemberIds: failed.map((entry) => entry.memberId),
          failedProjectIds: failed.map((entry) => entry.projectId),
          failedReasons: failed.map((entry) => entry.reason ?? "dispatch failed"),
          acceptedRunIds: results.filter((entry) => entry.accepted).map((entry) => entry.runId ?? null),
          summaryContent: payload.content,
        }),
      );
    }
    this.emitSnapshot(workgroupId);
    this.emitSummaries();
  }

  private resolveRootTriggerMessageId(
    workgroupId: string,
    message: Pick<WorkgroupCollaborationMessage, "id" | "senderType" | "triggerMessageId">,
  ): string | null {
    const normalizedWorkgroupId = workgroupId.trim();
    let currentId = message.id?.trim() || "";
    let currentTriggerId = message.triggerMessageId?.trim() || "";
    const visited = new Set<string>();

    if (message.senderType === "user" && currentId) {
      return currentId;
    }

    while (currentTriggerId) {
      if (visited.has(currentTriggerId)) {
        return currentTriggerId;
      }
      visited.add(currentTriggerId);

      const parent = workgroupCollaborationStore.getMessage(normalizedWorkgroupId, currentTriggerId);
      if (!parent) {
        return currentTriggerId;
      }
      if (parent.senderType === "user") {
        return parent.id;
      }

      currentId = parent.id?.trim() || currentId;
      currentTriggerId = parent.triggerMessageId?.trim() || "";
    }

    return currentId || null;
  }

  private collectHandledMemberIdsForRoot(workgroupId: string, rootTriggerMessageId: string): Set<string> {
    const normalizedRootTriggerMessageId = rootTriggerMessageId.trim();
    const handled = new Set<string>();
    if (!normalizedRootTriggerMessageId) {
      return handled;
    }

    for (const message of workgroupCollaborationStore.listMessages(workgroupId)) {
      const memberId = message.memberId?.trim() || "";
      if (!memberId) {
        continue;
      }
      if (!this.shouldCountAsHandledMemberMessage(message)) {
        continue;
      }
      if (this.resolveRootTriggerMessageId(workgroupId, message) !== normalizedRootTriggerMessageId) {
        continue;
      }
      handled.add(memberId);
    }

    const activeDispatches = this.activeDispatchesByWorkgroup.get(workgroupId);
    if (!activeDispatches) {
      return handled;
    }

    for (const record of activeDispatches.values()) {
      if (record.rootTriggerMessageId !== normalizedRootTriggerMessageId) {
        continue;
      }
      if (record.memberId) {
        handled.add(record.memberId);
      }
    }

    return handled;
  }

  private registerActiveDispatch(record: ActiveDispatchRecord): void {
    const workgroupId = record.workgroupId.trim();
    if (!workgroupId || !record.runId.trim()) {
      return;
    }
    const activeDispatches = this.activeDispatchesByWorkgroup.get(workgroupId) ?? new Map<string, ActiveDispatchRecord>();
    activeDispatches.set(record.runId, {
      ...record,
      workgroupId,
      runId: record.runId.trim(),
      rootTriggerMessageId: record.rootTriggerMessageId.trim(),
      memberId: record.memberId.trim(),
      projectId: record.projectId.trim(),
      messageId: record.messageId.trim(),
      triggerMessageId: record.triggerMessageId.trim(),
      startedAt: Number(record.startedAt) || Date.now(),
    });
    this.activeDispatchesByWorkgroup.set(workgroupId, activeDispatches);
  }

  private hasActiveDispatch(workgroupId: string, runId: string): boolean {
    const normalizedWorkgroupId = workgroupId.trim();
    const normalizedRunId = runId.trim();
    if (!normalizedWorkgroupId || !normalizedRunId) {
      return false;
    }
    return this.activeDispatchesByWorkgroup.get(normalizedWorkgroupId)?.has(normalizedRunId) ?? false;
  }

  private acquireWriteSlot(
    workgroup: Workgroup,
    member: WorkgroupMember,
    project: CollaborationBoundProject,
    runId: string,
    trigger: WorkgroupCollaborationMessage,
  ): string | null {
    if (member.executionMode !== "write") {
      return null;
    }
    if (workgroup.requireWriteApproval && trigger.senderType !== "user") {
      return "Write-capable members can only start from a human-approved group request.";
    }
    if (!workgroup.singleWriterPerWorkspace) {
      return null;
    }
    const workspaceKey = project.kind === "remote"
      ? `remote:${project.id}`
      : `local:${project.path.trim().toLowerCase()}`;
    if (!workspaceKey || workspaceKey === "local:") {
      return null;
    }
    const activeRunId = this.activeWriterRunByWorkspace.get(workspaceKey);
    if (activeRunId && activeRunId !== runId) {
      return "Another write-capable member is already running in this workspace.";
    }
    this.activeWriterRunByWorkspace.set(workspaceKey, runId);
    return null;
  }

  private clearActiveDispatch(workgroupId: string, runId: string): boolean {
    const normalizedWorkgroupId = workgroupId.trim();
    const normalizedRunId = runId.trim();
    if (!normalizedWorkgroupId || !normalizedRunId) {
      return false;
    }
    const activeDispatches = this.activeDispatchesByWorkgroup.get(normalizedWorkgroupId);
    const record = activeDispatches?.get(normalizedRunId);
    if (!record || !activeDispatches?.delete(normalizedRunId)) {
      return false;
    }
    for (const [workspaceKey, activeRunId] of this.activeWriterRunByWorkspace.entries()) {
      if (activeRunId === normalizedRunId) {
        this.activeWriterRunByWorkspace.delete(workspaceKey);
      }
    }
    if (activeDispatches.size === 0) {
      this.activeDispatchesByWorkgroup.delete(normalizedWorkgroupId);
    }
    return true;
  }

  private pruneDetachedActiveDispatches(workgroupId: string): boolean {
    const normalizedWorkgroupId = workgroupId.trim();
    const activeDispatches = this.activeDispatchesByWorkgroup.get(normalizedWorkgroupId);
    if (!activeDispatches || activeDispatches.size === 0) {
      return false;
    }

    let changed = false;
    for (const [runId, record] of activeDispatches.entries()) {
      const message = workgroupCollaborationStore.getMessage(normalizedWorkgroupId, record.messageId);
      if (message?.status === "streaming") {
        continue;
      }
      this.clearActiveDispatch(normalizedWorkgroupId, runId);
      changed = true;
    }

    if (activeDispatches.size === 0) {
      this.activeDispatchesByWorkgroup.delete(normalizedWorkgroupId);
    }
    return changed;
  }

  private pruneDuplicateStreamingMessages(workgroupId: string): boolean {
    const groups = new Map<string, WorkgroupCollaborationMessage[]>();
    for (const message of workgroupCollaborationStore.listMessages(workgroupId)) {
      if (message.senderType !== "member" || message.status !== "streaming") {
        continue;
      }
      const memberId = message.memberId?.trim() || "";
      if (!memberId) {
        continue;
      }
      const rootTriggerMessageId = this.resolveRootTriggerMessageId(workgroupId, message) ?? message.triggerMessageId ?? message.id;
      const key = `${memberId}::${rootTriggerMessageId}`;
      const items = groups.get(key) ?? [];
      items.push(message);
      groups.set(key, items);
    }

    let changed = false;
    for (const messages of groups.values()) {
      if (messages.length <= 1) {
        continue;
      }

      const ordered = [...messages].sort((left, right) => (
        right.updatedAt - left.updatedAt
        || right.createdAt - left.createdAt
        || right.id.localeCompare(left.id)
      ));
      const newest = ordered[0];
      for (const duplicate of ordered.slice(1)) {
        this.clearActiveDispatch(workgroupId, duplicate.dispatchRunId?.trim() ?? "");
        workgroupCollaborationStore.updateMessage(workgroupId, duplicate.id, {
          content: duplicate.content.trim() || `${duplicate.senderName} skipped a duplicate handoff.`,
          status: "done",
        });
        changed = true;
      }

      const activeDispatches = this.activeDispatchesByWorkgroup.get(workgroupId);
      if (!activeDispatches) {
        continue;
      }
      for (const record of Array.from(activeDispatches.values())) {
        if (
          record.memberId === (newest.memberId?.trim() ?? "")
          && record.rootTriggerMessageId === (this.resolveRootTriggerMessageId(workgroupId, newest) ?? newest.triggerMessageId ?? newest.id)
          && record.runId !== (newest.dispatchRunId?.trim() ?? "")
        ) {
          this.clearActiveDispatch(workgroupId, record.runId);
          changed = true;
        }
      }
    }

    return changed;
  }

  private repairRecoveredMemberMessages(workgroupId: string): boolean {
    let changed = false;

    for (const message of workgroupCollaborationStore.listMessages(workgroupId)) {
      if (message.status !== "done") {
        continue;
      }

      const stalePrefix = `${message.senderName} stopped before replying.`;
      if (!message.content.startsWith(stalePrefix)) {
        continue;
      }

      const recoveredContent = message.content.slice(stalePrefix.length).trimStart();
      if (!recoveredContent) {
        continue;
      }

      workgroupCollaborationStore.updateMessage(workgroupId, message.id, {
        senderType: "member",
        status: "done",
        content: recoveredContent,
      });
      changed = true;
    }

    return changed;
  }

  private finalizeStaleMemberMessage(
    workgroupId: string,
    messageId: string,
    senderName: string,
    content: string,
  ): void {
    const normalizedContent = content.trim();
    workgroupCollaborationStore.updateMessage(workgroupId, messageId, {
      senderType: normalizedContent ? "member" : "error",
      status: "done",
      content: normalizedContent || `${senderName} stopped before replying.`,
    });
  }

  private shouldWaitForMemberResponse(
    message: WorkgroupCollaborationMessage,
    snapshot: ProjectSessionSnapshot | null,
  ): boolean {
    const content = message.content.trim();
    if (content) {
      return false;
    }

    const runId = message.dispatchRunId?.trim() ?? "";
    if (runId && snapshot) {
      if (snapshot.queue.some((entry) => entry.runId === runId)) {
        return true;
      }
      if (snapshot.messages.some((entry) => entry.id === runId || entry.id === `${runId}:assistant`)) {
        return true;
      }
      if (snapshot.messages.some((entry) => entry.id === `${runId}:assistant:error`)) {
        return false;
      }
    }

    const referenceAt = Math.max(
      Number(message.updatedAt) || 0,
      Number(message.createdAt) || 0,
    );
    const graceMs = message.projectKind === "remote"
      ? REMOTE_MEMBER_RESPONSE_GRACE_MS
      : LOCAL_MEMBER_RESPONSE_GRACE_MS;
    return Date.now() - referenceAt < graceMs;
  }

  private resolveRemoteDispatchResolution(
    message: WorkgroupCollaborationMessage,
    snapshot: ProjectSessionSnapshot | null,
  ): RemoteDispatchResolution {
    if (message.projectKind !== "remote") {
      return { status: "pending" };
    }

    const runId = message.dispatchRunId?.trim() ?? "";
    if (!runId || !snapshot) {
      return { status: "pending" };
    }

    const errorMessage = snapshot.messages.find((entry) => entry.id === `${runId}:assistant:error`);
    if (errorMessage?.content.trim()) {
      return {
        status: "error",
        content: errorMessage.content.trim(),
      };
    }

    const assistantMessage = snapshot.messages.find((entry) => entry.id === `${runId}:assistant`);
    if (assistantMessage?.content.trim()) {
      return {
        status: assistantMessage.status === "streaming" ? "streaming" : "done",
        content: assistantMessage.content,
      };
    }

    if (snapshot.queue.some((entry) => entry.runId === runId)) {
      return { status: "pending" };
    }

    if (snapshot.messages.some((entry) => entry.id === runId)) {
      return { status: "pending" };
    }

    if (snapshot.isRunning && snapshot.currentSource === "remote") {
      return { status: "pending" };
    }

    return { status: "pending" };
  }

  private shouldCountAsHandledMemberMessage(message: WorkgroupCollaborationMessage): boolean {
    if (message.senderType !== "member") {
      return false;
    }

    const normalizedContent = message.content.trim();
    if (!normalizedContent) {
      return false;
    }

    return normalizedContent !== `${message.senderName} stopped before replying.`
      && normalizedContent !== `${message.senderName} skipped a duplicate handoff.`;
  }

  private emitSummaries(): void {
    this.emit("summaries", this.listSummaries());
  }

  private emitSnapshot(workgroupId: string): void {
    const snapshot = this.getSession(workgroupId);
    if (!snapshot) {
      return;
    }
    this.emit("snapshot", workgroupId, snapshot);
  }
}
