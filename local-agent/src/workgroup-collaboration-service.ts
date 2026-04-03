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
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeRoleMention(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function buildMemberMentionTokens(member: WorkgroupMember): string[] {
  const tokens = new Set<string>();
  const name = member.name.trim();
  if (name) {
    tokens.add(name.toLowerCase());
    tokens.add(normalizeRoleMention(name));
  }

  if (member.role === "project_manager") {
    [
      "pm",
      "pmagent",
      "projectmanager",
      "manager",
      "项目经理",
    ].forEach((token) => tokens.add(normalizeRoleMention(token)));
  }

  return Array.from(tokens).filter(Boolean);
}

function buildMessageLabel(message: WorkgroupCollaborationMessage): string {
  if (message.senderType === "member") {
    const role = message.memberRole ? ` (${message.memberRole})` : "";
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

interface ResolvedTargetSelection {
  targets: WorkgroupMember[];
  mode: "broadcast" | "explicit";
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
  memberName: string;
  accepted: boolean;
  reason?: string;
}

export default class WorkgroupCollaborationService extends EventEmitter {
  private readonly activeDispatchesByWorkgroup = new Map<string, Map<string, ActiveDispatchRecord>>();

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

    return {
      workgroupId: workgroup.id,
      workgroupName: workgroup.name,
      description: normalizeText(workgroup.description),
      allowDirectMemberMessages: Boolean(workgroup.allowDirectMemberMessages),
      updatedAt,
      isRunning: this.computeWorkgroupRunningState(workgroup.id),
      messageTotal: historyPage.total,
      members,
      messages: historyPage.items,
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

    const members = workgroupStore.listMembers(workgroup.id);
    const selection = this.resolveTargets(workgroup, members, trimmedContent);
    if (selection.targets.length === 0) {
      return { success: false, error: "No bound workgroup members available for this message" };
    }

    const normalizedClientMessageId = clientMessageId?.trim() || "";
    if (normalizedClientMessageId) {
      const existingMessage = workgroupCollaborationStore.getMessage(workgroup.id, normalizedClientMessageId);
      if (existingMessage?.senderType === "user") {
        const session = this.getSession(workgroup.id);
        return {
          success: true,
          session: session ?? undefined,
        };
      }
    }

    const userMessage = workgroupCollaborationStore.appendMessage(workgroup.id, {
      id: normalizedClientMessageId || undefined,
      senderType: "user",
      senderName: "You",
      content: trimmedContent,
      status: "done",
    });
    this.appendRoutingNote(workgroup.id, selection);
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
    return workgroupStore
      .listMembers(workgroup.id)
      .map((member) => {
        const project = member.projectId ? this.options.getBoundProject(member.projectId) : null;
        const projectSnapshot = project?.id
          ? this.options.getProjectSessionSnapshot(project.id)
          : null;
        return {
          id: member.id,
          name: member.name,
          role: member.role,
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
        workgroupCollaborationStore.updateMessage(workgroup.id, message.id, {
          senderType: "member",
          status: remoteResolution.status === "streaming" ? "streaming" : "done",
          content: remoteResolution.content ?? message.content,
        });
        changed = true;
        continue;
      }
      if (remoteResolution.status === "error") {
        this.clearActiveDispatch(workgroup.id, dispatchRunId);
        workgroupCollaborationStore.updateMessage(workgroup.id, message.id, {
          senderType: "error",
          status: "done",
          content: remoteResolution.content?.trim() || `${message.senderName} failed to respond.`,
        });
        changed = true;
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
      this.emit("snapshot", workgroup.id, this.getSession(workgroup.id));
    }
  }

  private resolveTargets(
    workgroup: Workgroup,
    members: WorkgroupMember[],
    content: string,
    options: ResolveTargetOptions = {},
  ): ResolvedTargetSelection {
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
    if (boundMembers.length === 0) {
      return {
        targets: [],
        mode: "broadcast",
      };
    }

    const normalizedContent = content.toLowerCase();
    if (/@all\b/.test(normalizedContent) || /@全部/.test(normalizedContent)) {
      return {
        targets: boundMembers,
        mode: "explicit",
      };
    }

    const matchedMembers = new Map<string, WorkgroupMember>();
    for (const member of boundMembers) {
      const mentionTokens = buildMemberMentionTokens(member);
      if (mentionTokens.some((token) => normalizedContent.includes(`@${token}`))) {
        matchedMembers.set(member.id, member);
      }
    }

    const mentionAliases = new Map<WorkgroupRole, string[]>([
      ["developer", ["developer", "dev", "开发"]],
      ["qa", ["qa", "test", "deploy", "测试", "部署"]],
      ["project_manager", ["projectmanager", "manager", "pm", "项目经理"]],
      ["custom", []],
    ]);
    for (const [role, aliases] of mentionAliases.entries()) {
      if (aliases.some((alias) => normalizedContent.includes(`@${alias}`) || normalizedContent.includes(`@${normalizeRoleMention(alias)}`))) {
        for (const member of boundMembers) {
          if (member.role === role) {
            matchedMembers.set(member.id, member);
          }
        }
      }
    }

    return matchedMembers.size > 0
      ? {
          targets: Array.from(matchedMembers.values()),
          mode: "explicit",
        }
      : (options.requireExplicitMention
        ? {
            targets: [],
            mode: "explicit",
          }
        : {
            targets: boundMembers,
            mode: "broadcast",
          });
  }

  private appendRoutingNote(workgroupId: string, selection: ResolvedTargetSelection): void {
    if (selection.targets.length === 0) {
      return;
    }

    const memberMentions = selection.targets.map((member) => `@${member.name}`).join(", ");
    const content = selection.mode === "explicit"
      ? `Notified ${memberMentions}`
      : selection.targets.length === 1
        ? `Sent to ${memberMentions}`
        : `Broadcast to ${memberMentions}`;

    workgroupCollaborationStore.appendMessage(workgroupId, {
      senderType: "system",
      senderName: "System",
      content,
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
    const roleInstruction = member.role === "developer"
      ? "You are the implementation role. Make code and local repo changes only inside your bound project."
      : member.role === "qa"
        ? "You are the verification and deployment role. Focus on testing, verification, deployment checks, logs, and evidence."
        : member.role === "project_manager"
          ? "You are the coordination role. Break tasks down, summarize status, and call out handoffs or blockers."
          : "Follow your custom role instructions while staying scoped to your bound project.";
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
      `You are: ${member.name}`,
      `Role: ${member.role}`,
      `Bound project: ${project?.name ?? member.projectName ?? member.projectId ?? "unknown"}`,
      "",
      "Operating rules",
      roleInstruction,
      "Reply only as your own role. Do not fabricate work from other members.",
      workgroup.allowDirectMemberMessages
        ? "You may mention other members for handoff notes, but only report work you actually completed."
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
      "Reply in first person as your role, keep it concise, and include outcome, validation, blockers, and any handoff note if needed.",
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
      return { memberName: member.name, accepted: false, reason };
    }

    const project = this.options.getBoundProject(projectId);
    if (!project) {
      const reason = "Bound project is unavailable.";
      this.appendDispatchError(workgroup.id, member, reason);
      return { memberName: member.name, accepted: false, reason };
    }

    if (project.kind === "remote" && !project.online) {
      const reason = "Remote member project is offline.";
      this.appendDispatchError(workgroup.id, member, reason);
      return { memberName: member.name, accepted: false, reason };
    }

    const runId = uuidv4();
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
      this.emitSnapshot(workgroup.id);
      this.emitSummaries();
    };

    if (project.kind === "remote") {
      const remoteSessionStore = this.options.getRemoteSessionStore();
      if (!remoteSessionStore) {
        const reason = "Remote controller is unavailable.";
        handleError(reason);
        return { memberName: member.name, accepted: false, reason };
      }

      const result = await remoteSessionStore.sendPrompt(project.id, prompt, undefined, {
        runId,
        onTextDelta: handleText,
        onDone: handleDone,
        onError: handleError,
      });
      if (!result.success) {
        const reason = result.error ?? "Remote dispatch failed.";
        handleError(reason);
        return { memberName: member.name, accepted: false, reason };
      }
      return { memberName: member.name, accepted: true };
    }

    this.options.runtimeManager.enqueueMessage({
      projectId: project.id,
      cwd: project.path,
      prompt,
      source: "workgroup",
      runId,
      responseMessageId: replyMessage.id,
      onTextDelta: handleText,
      onDone: handleDone,
      onError: handleError,
    });
    return { memberName: member.name, accepted: true };
  }

  private async dispatchMemberHandoffs(
    workgroup: Workgroup,
    sender: WorkgroupMember,
    sourceMessage: WorkgroupCollaborationMessage,
  ): Promise<void> {
    const senderCanHandoff = workgroup.allowDirectMemberMessages || sender.role === "project_manager";
    if (!senderCanHandoff) {
      return;
    }

    const members = workgroupStore.listMembers(workgroup.id);
    const selection = this.resolveTargets(workgroup, members, sourceMessage.content, {
      requireExplicitMention: true,
      excludeMemberIds: [sender.id],
    });
    if (selection.targets.length === 0) {
      return;
    }

    const rootTriggerMessageId = this.resolveRootTriggerMessageId(workgroup.id, sourceMessage);
    const alreadyHandledMemberIds = rootTriggerMessageId
      ? this.collectHandledMemberIdsForRoot(workgroup.id, rootTriggerMessageId)
      : new Set<string>();
    alreadyHandledMemberIds.delete(sender.id);

    const filteredTargets = selection.targets.filter((member) => !alreadyHandledMemberIds.has(member.id));
    if (filteredTargets.length === 0) {
      return;
    }

    const routedMessage = workgroupCollaborationStore.appendMessage(workgroup.id, {
      senderType: "system",
      senderName: "System",
      triggerMessageId: sourceMessage.id,
      content: `Handoff from @${sender.name} to ${filteredTargets.map((member) => `@${member.name}`).join(", ")}`,
      status: "done",
    });
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

  private clearActiveDispatch(workgroupId: string, runId: string): boolean {
    const normalizedWorkgroupId = workgroupId.trim();
    const normalizedRunId = runId.trim();
    if (!normalizedWorkgroupId || !normalizedRunId) {
      return false;
    }
    const activeDispatches = this.activeDispatchesByWorkgroup.get(normalizedWorkgroupId);
    if (!activeDispatches?.delete(normalizedRunId)) {
      return false;
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
      activeDispatches.delete(runId);
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
