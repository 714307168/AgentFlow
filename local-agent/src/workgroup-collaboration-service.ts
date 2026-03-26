import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
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

export default class WorkgroupCollaborationService extends EventEmitter {
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
    workgroupCollaborationStore.removeSession(workgroupId);
    this.emitSummaries();
  }

  async sendUserMessage(
    workgroupId: string,
    content: string,
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
    const targets = this.resolveTargets(workgroup, members, trimmedContent);
    if (targets.length === 0) {
      return { success: false, error: "No bound workgroup members available for this message" };
    }

    const userMessage = workgroupCollaborationStore.appendMessage(workgroup.id, {
      senderType: "user",
      senderName: "You",
      content: trimmedContent,
      status: "done",
    });
    this.emitSnapshot(workgroup.id);
    this.emitSummaries();

    const recentMessages = workgroupCollaborationStore
      .listMessages(workgroup.id)
      .slice(-DEFAULT_CONTEXT_MESSAGE_COUNT);

    await Promise.all(targets.map(async (member) => {
      await this.dispatchToMember(workgroup, member, recentMessages, userMessage);
    }));

    const session = this.getSession(workgroup.id);
    return {
      success: true,
      session: session ?? undefined,
    };
  }

  private buildSummary(workgroup: Workgroup): WorkgroupCollaborationSummary {
    const session = workgroupCollaborationStore.getSession(workgroup.id);
    const latestMessage = session?.messages[session.messages.length - 1] ?? null;
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
    return workgroupCollaborationStore
      .listMessages(workgroupId)
      .some((message) => message.status === "streaming");
  }

  private reconcileStaleStreamingMessages(workgroup: Workgroup): void {
    const messages = workgroupCollaborationStore.listMessages(workgroup.id);
    let changed = false;

    for (const message of messages) {
      if (message.senderType !== "member" || message.status !== "streaming") {
        continue;
      }

      const projectId = message.projectId?.trim() ?? "";
      if (!projectId) {
        workgroupCollaborationStore.updateMessage(workgroup.id, message.id, {
          status: "done",
          content: message.content.trim() || `${message.senderName} stopped before replying.`,
        });
        changed = true;
        continue;
      }

      const snapshot = this.options.getProjectSessionSnapshot(projectId);
      if (snapshot?.isRunning) {
        continue;
      }

      workgroupCollaborationStore.updateMessage(workgroup.id, message.id, {
        status: "done",
        content: message.content.trim() || `${message.senderName} stopped before replying.`,
      });
      changed = true;
    }

    if (changed) {
      this.emit("snapshot", workgroup.id, this.getSession(workgroup.id));
    }
  }

  private resolveTargets(workgroup: Workgroup, members: WorkgroupMember[], content: string): WorkgroupMember[] {
    const boundMembers = members.filter((member) => {
      if (!member.projectId) {
        return false;
      }
      const project = this.options.getBoundProject(member.projectId);
      return Boolean(project);
    });
    if (boundMembers.length === 0) {
      return [];
    }

    const normalizedContent = content.toLowerCase();
    if (/@all\b/.test(normalizedContent) || /@全部/.test(normalizedContent)) {
      return boundMembers;
    }

    const matchedMembers = new Map<string, WorkgroupMember>();
    for (const member of boundMembers) {
      if (normalizedContent.includes(`@${member.name.trim().toLowerCase()}`)) {
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

    return matchedMembers.size > 0 ? Array.from(matchedMembers.values()) : boundMembers;
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
  ): Promise<void> {
    const projectId = member.projectId?.trim() ?? "";
    if (!projectId) {
      this.appendDispatchError(workgroup.id, member, "Member has no bound project.");
      return;
    }

    const project = this.options.getBoundProject(projectId);
    if (!project) {
      this.appendDispatchError(workgroup.id, member, "Bound project is unavailable.");
      return;
    }

    if (project.kind === "remote" && !project.online) {
      this.appendDispatchError(workgroup.id, member, "Remote member project is offline.");
      return;
    }

    const runId = uuidv4();
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
    this.emitSnapshot(workgroup.id);
    this.emitSummaries();

    const prompt = this.buildPrompt(workgroup, member, recentMessages, userMessage);
    const handleText = (chunk: string) => {
      workgroupCollaborationStore.appendToMessage(workgroup.id, replyMessage.id, chunk);
      this.emitSnapshot(workgroup.id);
      this.emitSummaries();
    };
    const handleDone = () => {
      const current = workgroupCollaborationStore.getMessage(workgroup.id, replyMessage.id);
      workgroupCollaborationStore.updateMessage(workgroup.id, replyMessage.id, {
        content: current?.content?.trim() ? current.content : queuePlaceholderText(member),
        status: "done",
      });
      this.emitSnapshot(workgroup.id);
      this.emitSummaries();
    };
    const handleError = (error: string) => {
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
        handleError("Remote controller is unavailable.");
        return;
      }

      const result = await remoteSessionStore.sendPrompt(project.id, prompt, undefined, {
        runId,
        onTextDelta: handleText,
        onDone: handleDone,
        onError: handleError,
      });
      if (!result.success) {
        handleError(result.error ?? "Remote dispatch failed.");
      }
      return;
    }

    this.options.runtimeManager.enqueueMessage({
      projectId: project.id,
      cwd: project.path,
      prompt,
      source: "desktop",
      runId,
      responseMessageId: replyMessage.id,
      onTextDelta: handleText,
      onDone: handleDone,
      onError: handleError,
    });
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
