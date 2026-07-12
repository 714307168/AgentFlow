import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import appLogger from "./app-logger";
import {
  buildImagePreviewDataUrlFromPath,
  createRunAttachmentFromPath,
  getUniqueAttachmentPath,
  isImageAttachment,
} from "./attachment-utils";
import {
  buildCodexCompletionArgs,
  buildCodexFeaturesArgs,
  buildCodexExecArgs,
  buildCodexGoalPrompt,
  buildCodexInitPrompt,
  buildCodexMcpArgs,
  buildCodexPlanPrompt,
  buildCodexReviewArgs,
  buildCodexSearchStatusMessage,
  buildCodexSearchUsageMessage,
  buildCodexUnsupportedSlashMessage,
  buildCodexVersionArgs,
  buildProviderToolsMessage,
  buildSlashHelpMessage,
  parseSlashToggleIntent,
  type CodexReasoningEffort,
} from "./codex-command-support";
import { createProviderNativeCliCapabilities, getProviderLabel as getRegisteredProviderLabel } from "./provider-registry";
import { executeProviderSdkRun, type ProviderSdkConfig, type ProviderSdkGuidanceEvent } from "./provider-sdk";
import { type ProviderRuntimeSelection } from "./provider-runtime";
import { terminateProcessHandle } from "./process-cleanup";
import SessionHistoryStore, {
  ChatHistoryRepairSummary,
  PersistedProjectState,
  PersistedQueuedRun,
  ProjectSyncRequest,
} from "./session-history-store";
import type {
  CliProvider,
  CliTraceEntry,
  ConversationSummary,
  HistoryPageKind,
  HistoryPageRequest,
  HistoryPageResult,
  ProjectSessionSnapshot,
  QueuedRunSnapshot,
  RunAttachment,
  RunSource,
  SessionActivity,
  SessionMessage,
} from "./runtime-types";
import { createProjectSyncBucket } from "./project-sync-bucket";
import { createProjectSessionSignature } from "./project-session-signature";
import { createSessionSnapshotRevision } from "./session-snapshot-revision";

export interface RuntimeConfig {
  getProjectProvider: (projectId: string) => CliProvider;
  getProjectModel: (projectId: string) => string | null;
  getProjectCodexWebSearchEnabled?: (projectId: string) => boolean;
  getProjectPrompt?: (projectId: string) => string | null;
  getProviderEnvironment?: (provider: CliProvider) => Record<string, string>;
  resolveProviderRuntime?: (projectId: string, provider: CliProvider) => Promise<ProviderRuntimeSelection>;
  getProviderSdkConfig?: (provider: CliProvider) => ProviderSdkConfig | null;
  shouldResumeConversation?: (projectId: string, provider: CliProvider) => boolean;
  shouldPersistProjectHistory?: (projectId: string) => boolean;
  updateProject: (projectId: string, updates: {
    cliModel?: string | null;
    codexWebSearchEnabled?: boolean;
  }) => void;
  onProjectConfigChanged?: (projectId: string) => void;
  captureProjectScreenshot?: (projectId: string) => Promise<RunAttachment>;
  generateProjectImageAsset?: (options: {
    projectId: string;
    cwd: string;
    provider: CliProvider;
    model: string | null;
    prompt: string;
  }) => Promise<{
    attachment: RunAttachment;
    savedPath: string;
    model: string | null;
    revisedPrompt?: string | null;
  }>;
}

export interface EnqueueMessageOptions {
  projectId: string;
  cwd: string;
  prompt: string;
  attachments?: RunAttachment[];
  source: RunSource;
  queuedAt?: number;
  interruptCurrent?: boolean;
  interruptReason?: string;
  reasoningEffort?: CodexReasoningEffort | null;
  runId?: string;
  responseMessageId?: string;
  onTextDelta?: (chunk: string) => void;
  onDone?: () => void;
  onError?: (error: string) => void;
}

interface PendingRun extends EnqueueMessageOptions {
  runId: string;
  queuedAt: number;
}

interface ModelSessionRef {
  claudeSessionId: string | null;
  codexThreadId: string | null;
  updatedAt: number;
}

interface ProjectConversationState {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  cliTrace: CliTraceEntry[];
  messages: SessionMessage[];
  activities: SessionActivity[];
  claudeSessionId: string | null;
  codexThreadId: string | null;
  modelSessionRefs: Record<string, ModelSessionRef>;
}

interface ProjectState {
  projectId: string;
  queue: PendingRun[];
  active: boolean;
  provider: CliProvider;
  model: string | null;
  currentSource: RunSource | null;
  currentPrompt: string | null;
  currentStartedAt: number | null;
  activeConversationId: string | null;
  conversations: ProjectConversationState[];
  cliTrace: CliTraceEntry[];
  messages: SessionMessage[];
  activities: SessionActivity[];
  claudeSessionId: string | null;
  codexThreadId: string | null;
  pendingModelSwitchContext: string | null;
  process: ActiveRunProcessHandle | null;
  pendingStop: PendingStop | null;
}

interface PendingStop {
  reason: string;
  notifyAsError: boolean;
}

interface ActiveRunProcessHandle {
  killed: boolean;
  kill: () => void;
}

interface RunContext {
  runId: string;
  runStatusActivityId: string | null;
  assistantMessageId: string | null;
  thinkingActivityId: string | null;
  activityIdsByKey: Map<string, string>;
}

interface SlashCommand {
  name: string;
  args: string;
}

interface PreparedRunResult {
  run: PendingRun;
  handledLocally: boolean;
  completionDetail?: string;
  customExecutor?: (state: ProjectState, run: PendingRun, context: RunContext) => Promise<void>;
}

interface RunProcessOptions {
  onChildSpawn?: (child: ChildProcessWithoutNullStreams) => void;
  shouldTreatCloseAsSuccess?: (result: {
    code: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
  }) => boolean;
  successCloseMessage?: string | null;
}

const MAX_CLI_TRACE_ENTRIES = 60;
const MAX_CLI_TRACE_TOTAL_CHARS = 24_000;
const MAX_CLI_TRACE_ENTRY_CHARS = 1_200;
const DEFAULT_HISTORY_PAGE_SIZE = 30;
const MAX_ACTIVITY_HISTORY_ENTRIES = 30;
const SNAPSHOT_EMIT_INTERVAL_MS = 120;
const CODEX_EXIT_CODE_1_MAX_RETRIES = 3;
const CODEX_EXIT_CODE_1_RETRY_DELAY_MS = 1_500;
const MODEL_SWITCH_CONTEXT_MAX_CHARS = 6_000;
const MODEL_SWITCH_CONTEXT_MESSAGE_LIMIT = 12;
const CLI_TRACE_NOISE_PATTERNS = [
  /reading prompt from stdin/i,
] as const;
const CODEX_STREAM_LAG_WARNING_PATTERN = /event stream lagged; dropped \d+ events/i;
const CONTEXT_PRESSURE_WARNING_PATTERNS = [
  /long threads and multiple compactions/i,
  /keep threads small and targeted/i,
  /context window/i,
] as const;
const DIRECT_SCREENSHOT_REJECTION_PATTERNS = [
  /功能/u,
  /方案/u,
  /设计/u,
  /实现/u,
  /开发/u,
  /修复/u,
  /为什么/u,
  /怎么/u,
  /如何/u,
  /能不能/u,
  /可以不可以/u,
  /支持不支持/u,
  /问题/u,
  /报错/u,
  /链路/u,
  /workflow/i,
  /feature/i,
  /implement/i,
  /support/i,
  /design/i,
] as const;

class StopRunError extends Error {
  constructor(
    message: string,
    readonly notifyAsError: boolean,
  ) {
    super(message);
    this.name = "StopRunError";
  }
}

class RuntimeManager extends EventEmitter {
  private readonly states = new Map<string, ProjectState>();
  private readonly historyStore = new SessionHistoryStore();
  private readonly snapshotEmitTimers = new Map<string, NodeJS.Timeout>();
  private readonly lastSnapshotEmitAt = new Map<string, number>();

  constructor(private readonly getConfig: () => RuntimeConfig) {
    super();
    this.restorePersistedStates();
  }

  enqueueMessage(options: EnqueueMessageOptions): void {
    const prompt = options.prompt.replace(/\r\n/g, "\n");
    const attachments = this.normalizeAttachments(options.attachments);
    const normalizedPrompt = prompt.trim() ? prompt : this.describeAttachmentPrompt(attachments);

    if (!normalizedPrompt.trim()) {
      options.onError?.("Prompt cannot be empty");
      return;
    }

    const state = this.ensureState(options.projectId);
    const pendingRun: PendingRun = {
      ...options,
      prompt: normalizedPrompt,
      attachments,
      runId: options.runId ?? uuidv4(),
      queuedAt: Number.isFinite(options.queuedAt) && Number(options.queuedAt) > 0
        ? Number(options.queuedAt)
        : Date.now(),
    };

    this.enqueuePendingRun(state, pendingRun);
    if (options.interruptCurrent && state.active) {
      this.stopCurrentRun(
        options.projectId,
        options.interruptReason ?? "Interrupted by a newer prompt.",
        false,
      );
    }
    this.emitSnapshot(options.projectId);
    void this.processNext(options.projectId);
  }

  stopCurrentRun(projectId: string, reason = "Run interrupted.", notifyAsError = true): boolean {
    const state = this.states.get(projectId);
    if (!state?.active || !state.process) {
      return false;
    }
    this.appendCliTrace(state, "system", `Interrupt requested: ${reason}`);
    state.pendingStop = { reason, notifyAsError };
    terminateProcessHandle(state.process);
    return true;
  }

  removeQueuedRun(projectId: string, runId: string): boolean {
    const state = this.ensureState(projectId);
    const index = state.queue.findIndex((entry) => entry.runId === runId);
    if (index === -1) {
      return false;
    }

    state.queue.splice(index, 1);
    this.emitSnapshot(projectId);
    return true;
  }

  getSnapshot(projectId: string): ProjectSessionSnapshot {
    const state = this.ensureState(projectId);
    this.syncActiveConversationMeta(state);
    const provider = state.active ? state.provider : this.getResolvedProvider(projectId);
    const visibleCurrentSource = this.getProjectVisibleCurrentSource(state);
    const visibleQueue = this.getVisibleProjectQueue(state);
    const visibleMessages = this.getVisibleProjectMessages(state);
    const visibleActivities = this.getVisibleProjectActivities(state);
    const snapshotBase: ProjectSessionSnapshot = {
      projectId,
      provider,
      model: state.model,
      automationMode: "full-auto",
      projectSignature: null,
      syncBucket: null,
      isRunning: state.active,
      queuedCount: visibleQueue.length,
      currentSource: visibleCurrentSource,
      currentPrompt: visibleCurrentSource ? state.currentPrompt : null,
      currentStartedAt: visibleCurrentSource ? state.currentStartedAt : null,
      activeConversationId: state.activeConversationId,
      conversations: this.listConversationSummaries(projectId),
      messageTotal: visibleMessages.length,
      activityTotal: visibleActivities.length,
      cliTraceTotal: state.cliTrace.length,
      queue: visibleQueue.map((entry) => ({
        runId: entry.runId,
        prompt: entry.prompt,
        attachments: this.cloneAttachments(entry.attachments),
        source: entry.source,
        queuedAt: entry.queuedAt,
      })),
      cliTrace: state.cliTrace.slice(-DEFAULT_HISTORY_PAGE_SIZE).map((entry) => ({ ...entry })),
      messages: visibleMessages.slice(-DEFAULT_HISTORY_PAGE_SIZE).map((message) => this.cloneMessage(message)),
      activities: visibleActivities.slice(-DEFAULT_HISTORY_PAGE_SIZE).map((activity) => ({
        ...activity,
        meta: activity.meta ? { ...activity.meta } : undefined,
      })),
      sessionRefs: {
        claudeSessionId: state.claudeSessionId,
        codexThreadId: state.codexThreadId,
      },
    };
    const syncBucket = createProjectSyncBucket(snapshotBase);
    const snapshotRevision = createSessionSnapshotRevision(snapshotBase);
    return {
      ...snapshotBase,
      syncBucket,
      projectSignature: createProjectSessionSignature(snapshotBase, snapshotRevision),
    };
  }

  getLatestSyncSeq(projectId: string): number {
    if (!this.shouldPersistProjectHistory(projectId)) {
      return 0;
    }
    return this.historyStore.getLatestSeq(projectId);
  }

  buildSyncDelta(projectId: string, request: number | ProjectSyncRequest = 0) {
    if (!this.shouldPersistProjectHistory(projectId)) {
      return {
        latestSeq: 0,
        items: [],
        truncated: false,
      };
    }
    return this.historyStore.buildSyncDelta(projectId, request);
  }

  getHistoryPage(
    projectId: string,
    kind: HistoryPageKind,
    request: HistoryPageRequest = {},
  ): HistoryPageResult<SessionMessage | SessionActivity | CliTraceEntry> {
    const state = this.ensureState(projectId);
    const conversation = this.getConversationById(state, request.conversationId) ?? this.getActiveConversation(state);
    if (!conversation) {
      return {
        conversationId: null,
        items: [],
        hasMore: false,
        total: 0,
      };
    }

    const sourceItems = kind === "messages"
      ? this.getVisibleProjectMessages(conversation)
      : (kind === "activities" ? this.getVisibleProjectActivities(conversation) : conversation.cliTrace);
    const limit = Number(request.limit) > 0 ? Math.max(1, Number(request.limit)) : DEFAULT_HISTORY_PAGE_SIZE;
    const beforeId = request.beforeId?.trim() || "";
    const anchorIndex = beforeId
      ? sourceItems.findIndex((entry) => entry.id === beforeId)
      : sourceItems.length;
    const safeAnchorIndex = anchorIndex >= 0 ? anchorIndex : sourceItems.length;
    const startIndex = Math.max(0, safeAnchorIndex - limit);
    const items = sourceItems.slice(startIndex, safeAnchorIndex).map((entry) => this.cloneHistoryItem(kind, entry));

    return {
      conversationId: conversation.id,
      items,
      hasMore: startIndex > 0,
      total: sourceItems.length,
    };
  }

  searchMessages(
    projectId: string,
    request: {
      query: string;
      conversationId?: string | null;
      limit?: number;
    },
  ): SessionMessage[] {
    const state = this.ensureState(projectId);
    const query = request.query.trim().toLowerCase();
    if (!query) {
      return [];
    }

    const conversation = this.getConversationById(state, request.conversationId) ?? this.getActiveConversation(state);
    if (!conversation) {
      return [];
    }

    const limit = Number(request.limit) > 0 ? Math.max(1, Number(request.limit)) : 200;
    return this.getVisibleProjectMessages(conversation)
      .filter((message) => {
        const attachmentText = (message.attachments ?? [])
          .map((attachment) => `${attachment.name} ${attachment.path}`)
          .join(" ")
          .toLowerCase();
        const haystack = [
          message.role,
          message.provider ?? "",
          message.content,
          attachmentText,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .slice(-limit)
      .map((message) => this.cloneMessage(message));
  }

  listConversationSummaries(projectId: string): ConversationSummary[] {
    const state = this.ensureState(projectId);
    this.syncActiveConversationMeta(state);
    return state.conversations
      .map((conversation) => {
        const visibleMessages = this.getVisibleProjectMessages(conversation);
        const visibleActivities = this.getVisibleProjectActivities(conversation);
        return {
          id: conversation.id,
          title: this.getConversationTitle(conversation),
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          isActive: conversation.id === state.activeConversationId,
          messageCount: visibleMessages.length,
          activityCount: visibleActivities.length,
          cliCount: conversation.cliTrace.length,
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt);
  }

  createConversation(projectId: string): { success: boolean; conversationId?: string; error?: string } {
    const state = this.ensureState(projectId);
    if (state.active || state.queue.length > 0) {
      return { success: false, error: "Stop the current run and clear the queue before creating a new conversation." };
    }

    const conversation = this.createConversationState();
    state.conversations.push(conversation);
    this.activateConversationState(state, conversation.id);
    this.emitSnapshot(projectId);
    return { success: true, conversationId: conversation.id };
  }

  activateConversation(projectId: string, conversationId: string): { success: boolean; error?: string } {
    const state = this.ensureState(projectId);
    if (state.active || state.queue.length > 0) {
      return { success: false, error: "Stop the current run and clear the queue before switching conversations." };
    }

    const nextConversation = this.getConversationById(state, conversationId);
    if (!nextConversation) {
      return { success: false, error: "Conversation not found." };
    }

    this.activateConversationState(state, nextConversation.id);
    this.emitSnapshot(projectId);
    return { success: true };
  }

  dispose(): void {
    for (const timer of this.snapshotEmitTimers.values()) {
      clearTimeout(timer);
    }
    this.snapshotEmitTimers.clear();
    this.lastSnapshotEmitAt.clear();
    for (const state of this.states.values()) {
      if (state.process && !state.process.killed) {
        terminateProcessHandle(state.process);
      }
      state.process = null;
    }
    this.historyStore.flushAll();
  }

  flushPersistence(): void {
    this.historyStore.flushAll();
  }

  clearProject(projectId: string): void {
    const state = this.states.get(projectId);
    if (state?.process && !state.process.killed) {
      terminateProcessHandle(state.process);
    }
    this.clearScheduledSnapshot(projectId);
    this.states.delete(projectId);
    this.historyStore.clearProject(projectId);
  }

  clearHistoryCache(projectId?: string | null): { cleared: number; skipped: number } {
    const targetStates = projectId
      ? Array.from(this.states.values()).filter((state) => state.projectId === projectId)
      : Array.from(this.states.values());
    let cleared = 0;
    let skipped = 0;

    for (const state of targetStates) {
      if (state.active || state.queue.length > 0) {
        skipped += 1;
        continue;
      }
      this.resetProjectHistoryState(state);
      this.rebuildProjectHistoryStore(state);
      cleared += 1;
      this.emitSnapshot(state.projectId);
    }

    return { cleared, skipped };
  }

  repairChatHistory(projectId?: string | null): ChatHistoryRepairSummary {
    const normalizedProjectId = projectId?.trim() || null;
    const targetProjectIds = (
      normalizedProjectId
        ? [normalizedProjectId]
        : Array.from(new Set([
            ...this.historyStore.listProjectIds(),
            ...this.states.keys(),
          ])).sort((left, right) => left.localeCompare(right))
    ).filter((projectIdToRepair) => this.shouldPersistProjectHistory(projectIdToRepair));

    if (targetProjectIds.length === 0) {
      return {
        scanned: 0,
        repaired: 0,
        reset: 0,
        results: [],
      };
    }

    const repairedResults = new Map<string, ChatHistoryRepairSummary["results"][number]>();
    for (const projectIdToRepair of targetProjectIds) {
      const state = this.states.get(projectIdToRepair);
      if (!state) {
        continue;
      }
      this.syncActiveConversationMeta(state);
      this.rebuildProjectHistoryStore(state);
      repairedResults.set(projectIdToRepair, {
        projectId: projectIdToRepair,
        repaired: true,
        reset: false,
        backupPath: null,
        conversationCount: state.conversations.length,
        totalItems: state.conversations.reduce(
          (total, conversation) => total + conversation.messages.length + conversation.activities.length + conversation.cliTrace.length,
          0,
        ),
      });
      this.emitSnapshot(projectIdToRepair);
    }

    const coldProjectIds = targetProjectIds.filter((projectIdToRepair) => !repairedResults.has(projectIdToRepair));
    const coldSummary = coldProjectIds.length > 0
      ? this.historyStore.repairProjects(coldProjectIds)
      : { scanned: 0, repaired: 0, reset: 0, results: [] };

    for (const result of coldSummary.results) {
      repairedResults.set(result.projectId, result);
    }

    const results = targetProjectIds
      .map((projectIdToRepair) => repairedResults.get(projectIdToRepair))
      .filter((result): result is ChatHistoryRepairSummary["results"][number] => Boolean(result));

    return {
      scanned: results.length,
      repaired: results.filter((result) => result.repaired).length,
      reset: results.filter((result) => result.reset).length,
      results,
    };
  }

  hasActiveOrQueuedRuns(): boolean {
    for (const state of this.states.values()) {
      if (state.active || state.queue.length > 0) {
        return true;
      }
    }
    return false;
  }

  pruneHistoryCache(retentionDays: number): { changed: number } {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
      return { changed: 0 };
    }

    const cutoff = Date.now() - Math.floor(retentionDays * 24 * 60 * 60 * 1000);
    let changed = 0;
    for (const state of this.states.values()) {
      if (state.active || state.queue.length > 0) {
        continue;
      }
      this.syncActiveConversationMeta(state);
      const keptConversations = state.conversations
        .filter((conversation) => conversation.updatedAt >= cutoff);
      if (keptConversations.length === state.conversations.length) {
        continue;
      }

      state.conversations = keptConversations.length > 0 ? keptConversations : [this.createConversationState()];
      this.activateConversationState(state, state.conversations[state.conversations.length - 1].id);
      this.rebuildProjectHistoryStore(state);
      changed += 1;
      this.emitSnapshot(state.projectId);
    }

    return { changed };
  }

  private async processNext(projectId: string): Promise<void> {
    const state = this.ensureState(projectId);
    if (state.active) {
      return;
    }

    const next = state.queue.shift();
    if (!next) {
      return;
    }

    state.cliTrace = [];
    state.active = true;
    state.provider = this.getResolvedProvider(projectId);
    state.model = this.getResolvedModel(projectId);
    this.restoreModelSessionRefsForState(state);
    state.currentSource = next.source;
    state.currentPrompt = next.prompt;
    state.currentStartedAt = Date.now();
    this.emit("run-started", {
      projectId: state.projectId,
      runId: next.runId,
      provider: state.provider,
      source: next.source,
    });
    const context: RunContext = {
      runId: next.runId,
      runStatusActivityId: null,
      assistantMessageId: null,
      thinkingActivityId: null,
      activityIdsByKey: new Map<string, string>(),
    };

    this.addMessage(state, {
      id: next.runId,
      role: "user",
      content: next.prompt,
      attachments: this.cloneAttachments(next.attachments),
      provider: state.provider,
      source: next.source,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "done",
    });

    context.runStatusActivityId = this.addActivity(state, {
      id: uuidv4(),
      kind: "status",
      title: `${this.getProviderLabel(state.provider)} started`,
      detail: "Running in full-auto mode without approval prompts.",
      status: "running",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      meta: {
        source: next.source,
        runId: next.runId,
      },
    });

    try {
      let completionDetail = `${this.getProviderLabel(state.provider)} finished successfully.`;
      let handledLocally = false;
      const prepared = await this.prepareRun(state, next, context);
      handledLocally = prepared.handledLocally;
      const providerRuntime = prepared.handledLocally
        ? null
        : await this.resolveProviderRuntime(state.projectId, state.provider);

      if (prepared.handledLocally) {
        completionDetail = prepared.completionDetail ?? completionDetail;
      } else if (prepared.customExecutor) {
        await prepared.customExecutor(state, prepared.run, context);
        completionDetail = prepared.completionDetail ?? completionDetail;
      } else {
        const run = prepared.run;
        if (!providerRuntime || providerRuntime.kind === "unavailable") {
          throw new Error(providerRuntime?.detail ?? "No provider runtime is available.");
        }
        if (providerRuntime.kind === "sdk") {
          await this.executeProviderSdk(state, run, context, providerRuntime);
        } else if (state.provider === "claude") {
          await this.executeClaude(state, run, context, providerRuntime);
        } else {
          let lastCodexError: unknown = null;
          for (let attempt = 0; attempt <= CODEX_EXIT_CODE_1_MAX_RETRIES; attempt += 1) {
            try {
              await this.executeCodex(state, run, context, providerRuntime);
              lastCodexError = null;
              break;
            } catch (error) {
              lastCodexError = error;
              if (!this.shouldRetryCodexExitCode1(error, attempt)) {
                throw error;
              }
              const nextAttempt = attempt + 2;
              this.appendCliTrace(
                state,
                "system",
                `Codex exited with code 1. Retrying ${nextAttempt}/${CODEX_EXIT_CODE_1_MAX_RETRIES + 1}...`,
              );
              await this.delay(CODEX_EXIT_CODE_1_RETRY_DELAY_MS);
            }
          }
          if (lastCodexError) {
            throw lastCodexError;
          }
        }
      }
      this.finalizeRun(
        state,
        context,
        "completed",
        completionDetail,
      );
      this.emit("run-completed", {
        projectId: state.projectId,
        runId: next.runId,
        provider: state.provider,
        source: next.source,
        handledLocally,
        finalStatus: "completed",
      });
      next.onDone?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof StopRunError) {
        this.finalizeRun(state, context, "completed", message);
        this.emit("run-completed", {
          projectId: state.projectId,
          runId: next.runId,
          provider: state.provider,
          source: next.source,
          handledLocally: false,
          finalStatus: "completed",
        });
        if (error.notifyAsError) {
          next.onError?.(message);
        } else {
          next.onDone?.();
        }
      } else {
        this.finalizeRun(state, context, "error", message);
        this.emit("run-completed", {
          projectId: state.projectId,
          runId: next.runId,
          provider: state.provider,
          source: next.source,
          handledLocally: false,
          finalStatus: "error",
        });
        this.addMessage(state, {
          id: uuidv4(),
          role: "error",
          content: message,
          provider: state.provider,
          source: next.source,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: "done",
        });
        this.addActivity(state, {
          id: uuidv4(),
          kind: "error",
          title: `${this.getProviderLabel(state.provider)} failed`,
          detail: message,
          status: "error",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {
            source: next.source,
            runId: next.runId,
          },
        });
        next.onError?.(message);
      }
    } finally {
      state.active = false;
      state.currentSource = null;
      state.currentPrompt = null;
      state.currentStartedAt = null;
      state.process = null;
      state.pendingStop = null;
      this.emitSnapshot(projectId);
      void this.processNext(projectId);
    }
  }

  private executeClaude(
    state: ProjectState,
    run: PendingRun,
    context: RunContext,
    runtime: ProviderRuntimeSelection,
  ): Promise<void> {
    const command = runtime.cliStatus?.command ?? (process.platform === "win32" ? "claude.cmd" : "claude");
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
    ];

    if (state.model) {
      args.push("--model", state.model);
    }
    if (this.shouldResumeConversation(state.projectId, "claude") && state.claudeSessionId) {
      args.push("-r", state.claudeSessionId);
    }

    return this.runProcess(
      state,
      command,
      args,
      run.cwd,
      (line) => {
        if (line.startsWith("{\"type\":\"system\",\"subtype\":\"hook_")) {
          return;
        }
        if (line.startsWith("{\"type\":\"system\",\"subtype\":\"hook_response\"")) {
          return;
        }

        const parsed = this.safeParse(line);
        if (!parsed || typeof parsed !== "object" || parsed === null) {
          this.appendCliTrace(state, "stdout", line);
          return;
        }

        const event = parsed as Record<string, any>;
        if (typeof event.session_id === "string") {
          state.claudeSessionId = event.session_id;
        }
        if (typeof event.model === "string" && event.model.trim()) {
          state.model = event.model.trim();
        }

        if (event.type === "stream_event" && event.event?.type === "content_block_delta") {
          const deltaType = event.event.delta?.type;
          if (deltaType === "text_delta") {
            const text = String(event.event.delta?.text ?? "");
            if (text) {
              this.appendAssistantText(state, context, run, text);
              run.onTextDelta?.(text);
            }
          } else if (deltaType === "thinking_delta") {
            const thinking = String(event.event.delta?.thinking ?? "");
            if (thinking) {
              const thinkingId = context.thinkingActivityId
                ?? this.addActivity(state, {
                  id: uuidv4(),
                  kind: "thinking",
                  title: "Thinking",
                  detail: "",
                  status: "running",
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  meta: {
                    source: run.source,
                    runId: run.runId,
                  },
                });
              context.thinkingActivityId = thinkingId;
              this.appendActivityDetail(state, thinkingId, thinking);
            }
          }
          return;
        }

        if (event.type === "assistant" && event.message?.content) {
          if (typeof event.message.model === "string" && event.message.model.trim()) {
            state.model = event.message.model.trim();
          }
          const content = Array.isArray(event.message.content) ? event.message.content : [];
          for (const block of content) {
            if (block?.type === "tool_use") {
              const toolId = String(block.id ?? uuidv4());
              context.activityIdsByKey.set(
                toolId,
                this.addActivity(state, {
                  id: uuidv4(),
                  kind: "tool",
                  title: `${String(block.name ?? "Tool")} request`,
                  detail: this.formatToolInput(block.input),
                  status: "running",
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  meta: {
                    source: run.source,
                    runId: run.runId,
                  },
                }),
              );
            } else if (block?.type === "text") {
              const text = String(block.text ?? "");
              if (text && !context.assistantMessageId) {
                this.appendAssistantText(state, context, run, text);
                run.onTextDelta?.(text);
              }
            }
          }
          return;
        }

        if (event.type === "user" && event.tool_use_result) {
          const toolResult = event.tool_use_result as Record<string, any>;
          const content = Array.isArray(event.message?.content) ? event.message.content : [];
          const toolUseId = String(content[0]?.tool_use_id ?? "");
          const activityId = context.activityIdsByKey.get(toolUseId);
          if (activityId) {
            this.updateActivity(state, activityId, {
              detail: this.formatToolResult(toolResult),
              status: toolResult.is_error ? "error" : "completed",
            });
          }
          return;
        }

        if (event.type === "result" && event.subtype === "success") {
          const resultText = String(event.result ?? "").trim();
          if (resultText && !context.assistantMessageId) {
            this.appendAssistantText(state, context, run, resultText);
            run.onTextDelta?.(resultText);
          }
          if (context.assistantMessageId) {
            this.updateMessage(state, context.assistantMessageId, {
              status: "done",
            });
          }
          if (context.thinkingActivityId) {
            this.updateActivity(state, context.thinkingActivityId, {
              status: "completed",
            });
          }
        }
      },
      this.buildPromptWithAttachments(run),
      this.getConfig().getProviderEnvironment?.("claude"),
    );
  }

  private executeCodex(
    state: ProjectState,
    run: PendingRun,
    context: RunContext,
    runtime: ProviderRuntimeSelection,
  ): Promise<void> {
    const command = runtime.cliStatus?.command ?? (process.platform === "win32" ? "codex.cmd" : "codex");
    let codexChild: ChildProcessWithoutNullStreams | null = null;
    let logicalCompletionSeen = false;
    const args = buildCodexExecArgs({
      canResumeConversation: this.shouldResumeConversation(state.projectId, "codex"),
      codexThreadId: state.codexThreadId,
      model: state.model,
      reasoningEffort: run.reasoningEffort ?? null,
      searchEnabled: this.isCodexWebSearchEnabled(state.projectId),
      capabilities: {
        resumeConversation: runtime.capabilities.resumeConversation,
        webSearch: runtime.capabilities.webSearch,
      },
    });

    return this.runProcess(
      state,
      command,
      args,
      run.cwd,
      (line) => {
        const parsed = this.safeParse(line);
        if (!parsed || typeof parsed !== "object" || parsed === null) {
          this.appendCliTrace(state, "stdout", line);
          return;
        }

        const event = parsed as Record<string, any>;
        if (typeof event.thread_id === "string") {
          state.codexThreadId = event.thread_id;
        }

        if (event.type === "item.started" || event.type === "item.completed") {
          const item = event.item as Record<string, any> | undefined;
          if (!item) {
            return;
          }

          if (item.type === "command_execution") {
            const activityKey = String(item.id ?? uuidv4());
            const existingActivityId = context.activityIdsByKey.get(activityKey);
            if (event.type === "item.started" || !existingActivityId) {
              const activityId = existingActivityId
                ?? this.addActivity(state, {
                  id: uuidv4(),
                  kind: "command",
                  title: "Command execution",
                  detail: String(item.command ?? ""),
                  status: "running",
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  meta: {
                    source: run.source,
                    runId: run.runId,
                  },
                });
              context.activityIdsByKey.set(activityKey, activityId);
              if (event.type === "item.completed") {
                this.updateActivity(state, activityId, {
                  detail: this.formatCodexCommand(item),
                  status: Number(item.exit_code ?? 0) === 0 ? "completed" : "error",
                });
              }
            } else {
              this.updateActivity(state, existingActivityId, {
                detail: this.formatCodexCommand(item),
                status: Number(item.exit_code ?? 0) === 0 ? "completed" : "error",
              });
            }
            return;
          }

          if (item.type === "agent_message" && event.type === "item.completed") {
            const text = String(item.text ?? "");
            if (text) {
              const prefix = context.assistantMessageId ? "\n\n" : "";
              this.appendAssistantText(state, context, run, `${prefix}${text}`);
              run.onTextDelta?.(`${prefix}${text}`);
              this.addActivity(state, {
                id: uuidv4(),
                kind: "agent",
                title: "Agent update",
                detail: text,
                status: "completed",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                meta: {
                  source: run.source,
                  runId: run.runId,
                },
              });
            }
            return;
          }

          if (event.type === "item.completed") {
            const normalizedItem = this.normalizeCodexActivityItem(item);
            this.addActivity(state, {
              id: uuidv4(),
              kind: normalizedItem.kind,
              title: normalizedItem.title,
              detail: normalizedItem.detail,
              status: normalizedItem.status,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              meta: {
                source: run.source,
                runId: run.runId,
              },
            });
          }
          return;
        }

        if (event.type === "turn.completed") {
          if (context.assistantMessageId) {
            this.updateMessage(state, context.assistantMessageId, {
              status: "done",
            });
          }
          logicalCompletionSeen = true;
          this.appendCliTrace(state, "system", "Codex turn completed.");
          setTimeout(() => {
            const child = codexChild;
            if (!child) {
              return;
            }
            const stillRunning = child.exitCode === null && child.signalCode === null;
            if (!stillRunning) {
              return;
            }
            if (state.process !== child) {
              return;
            }
            this.appendCliTrace(state, "system", "Codex process lingered after turn.completed; terminating it.");
            terminateProcessHandle(child);
          }, 1500);
          return;
        }

        if (logicalCompletionSeen && event.type === "error") {
          return;
        }
      },
      this.buildPromptWithAttachments(run),
      this.getConfig().getProviderEnvironment?.("codex"),
      {
        onChildSpawn: (child) => {
          codexChild = child;
        },
        shouldTreatCloseAsSuccess: ({ code, signal }) => {
          return logicalCompletionSeen && code === null && signal === "SIGTERM";
        },
        successCloseMessage: "Codex process terminated after logical completion.",
      },
    );
  }

  private normalizeCodexActivityItem(item: Record<string, any>): {
    kind: SessionActivity["kind"];
    title: string;
    detail: string;
    status: SessionActivity["status"];
  } {
    const itemType = String(item.type ?? "Item").trim() || "Item";
    const message = String(item.message ?? "").trim();
    if (itemType.toLowerCase() !== "error") {
      return {
        kind: "status",
        title: itemType,
        detail: JSON.stringify(item, null, 2),
        status: "completed",
      };
    }

    if (CODEX_STREAM_LAG_WARNING_PATTERN.test(message)) {
      return {
        kind: "status",
        title: "Event stream warning",
        detail: message,
        status: "completed",
      };
    }

    if (CONTEXT_PRESSURE_WARNING_PATTERNS.some((pattern) => pattern.test(message))) {
      return {
        kind: "status",
        title: "Context warning",
        detail: message,
        status: "completed",
      };
    }

    return {
      kind: "error",
      title: "Runtime error",
      detail: message || JSON.stringify(item, null, 2),
      status: "error",
    };
  }

  private async prepareRun(
    state: ProjectState,
    run: PendingRun,
    context: RunContext,
  ): Promise<PreparedRunResult> {
    if (this.isDirectScreenshotRequest(run.prompt)) {
      const completionDetail = await this.handleScreenshotSlashCommand(state, run, context);
      return {
        run,
        handledLocally: true,
        completionDetail,
      };
    }

    const command = this.parseSlashCommand(run.prompt);
    if (!command) {
      return { run, handledLocally: false };
    }

    if (command.name === "help") {
      const helpText = buildSlashHelpMessage(state.provider);
      this.appendAssistantText(state, context, run, helpText);
      run.onTextDelta?.(helpText);
      return {
        run,
        handledLocally: true,
        completionDetail: "Displayed slash command help.",
      };
    }

    if (command.name === "tools") {
      const runtime = await this.resolveProviderRuntime(state.projectId, state.provider);
      const toolsText = buildProviderToolsMessage({
        provider: state.provider,
        model: state.model,
        codexSearchEnabled: this.isCodexWebSearchEnabled(state.projectId),
        runtimeKind: runtime.kind,
        runtimeDetail: runtime.detail,
        runtimeStatus: runtime.cliStatus,
      });
      this.appendAssistantText(state, context, run, toolsText);
      run.onTextDelta?.(toolsText);
      return {
        run,
        handledLocally: true,
        completionDetail: "Displayed provider tool support.",
      };
    }

    if (command.name === "model") {
      const completionDetail = this.handleModelSlashCommand(state, run, context, command.args);
      return {
        run,
        handledLocally: true,
        completionDetail,
      };
    }

    if (command.name === "search") {
      const completionDetail = this.handleSearchSlashCommand(state, run, context, command.args);
      return {
        run,
        handledLocally: true,
        completionDetail,
      };
    }

    if (command.name === "screenshot") {
      const completionDetail = await this.handleScreenshotSlashCommand(state, run, context);
      return {
        run,
        handledLocally: true,
        completionDetail,
      };
    }

    if (command.name === "send-image") {
      const completionDetail = this.handleShareImageSlashCommand(state, run, context, command.args);
      return {
        run,
        handledLocally: true,
        completionDetail,
      };
    }

    if (command.name === "image") {
      const completionDetail = await this.handleGenerateImageSlashCommand(state, run, context, command.args);
      return {
        run,
        handledLocally: true,
        completionDetail,
      };
    }

    if (state.provider === "codex") {
      const runtime = await this.resolveProviderRuntime(state.projectId, state.provider);
      if (command.name === "init") {
        const detail = "Headless Codex mode does not expose native slash commands; /init is being emulated with an equivalent AGENTS.md bootstrap prompt.";
        if (context.runStatusActivityId) {
          this.updateActivity(state, context.runStatusActivityId, {
            detail,
          });
        }
        return {
          run: {
            ...run,
            prompt: buildCodexInitPrompt(command.args),
          },
          handledLocally: false,
        };
      }

      if (command.name === "plan") {
        return this.prepareCodexPromptModeSlashCommand(
          run,
          context,
          buildCodexPlanPrompt(command.args),
          "Codex plan mode: producing an implementation plan without editing files.",
        );
      }

      if (command.name === "goal" || command.name === "target") {
        const prompt = buildCodexGoalPrompt(command.args);
        if (!prompt) {
          const message = `Usage: /${command.name} <objective>`;
          this.appendAssistantText(state, context, run, message);
          run.onTextDelta?.(message);
          return {
            run,
            handledLocally: true,
            completionDetail: `Displayed /${command.name} usage.`,
          };
        }
        return this.prepareCodexPromptModeSlashCommand(
          run,
          context,
          prompt,
          `Codex ${command.name === "target" ? "target" : "goal"} mode: working toward the requested objective.`,
        );
      }

      if (command.name === "review") {
        if (runtime.kind !== "cli") {
          return this.handleCliOnlyCodexCommandUnavailable(state, run, context, command.name, runtime.detail);
        }
        return this.prepareCodexReviewSlashCommand(state, run, context, command.args);
      }

      if (command.name === "features") {
        if (runtime.kind !== "cli") {
          return this.handleCliOnlyCodexCommandUnavailable(state, run, context, command.name, runtime.detail);
        }
        return this.prepareCodexFeaturesSlashCommand(state, run, context, command.args);
      }

      if (command.name === "version") {
        if (runtime.kind !== "cli") {
          return this.handleCliOnlyCodexCommandUnavailable(state, run, context, command.name, runtime.detail);
        }
        return this.prepareCodexVersionSlashCommand(run, context);
      }

      if (command.name === "completion") {
        if (runtime.kind !== "cli") {
          return this.handleCliOnlyCodexCommandUnavailable(state, run, context, command.name, runtime.detail);
        }
        return this.prepareCodexCompletionSlashCommand(run, context, command.args);
      }

      if (command.name === "mcp") {
        if (runtime.kind !== "cli") {
          return this.handleCliOnlyCodexCommandUnavailable(state, run, context, command.name, runtime.detail);
        }
        return this.prepareCodexMcpSlashCommand(run, context, command.args);
      }

      const unsupportedText = buildCodexUnsupportedSlashMessage(command.name);
      this.appendAssistantText(state, context, run, unsupportedText);
      run.onTextDelta?.(unsupportedText);
      return {
        run,
        handledLocally: true,
        completionDetail: `Slash command /${command.name} is not available in headless Codex mode.`,
      };
    }

    return { run, handledLocally: false };
  }

  private prepareCodexPromptModeSlashCommand(
    run: PendingRun,
    context: RunContext,
    prompt: string,
    statusDetail: string,
  ): PreparedRunResult {
    const state = this.ensureState(run.projectId);
    if (context.runStatusActivityId) {
      this.updateActivity(state, context.runStatusActivityId, {
        detail: statusDetail,
      });
    }
    return {
      run: {
        ...run,
        prompt,
      },
      handledLocally: false,
    };
  }

  private prepareCodexReviewSlashCommand(
    _state: ProjectState,
    run: PendingRun,
    context: RunContext,
    rawArgs: string,
  ): PreparedRunResult {
    return this.prepareCodexTextSlashCommand(
      run,
      context,
      buildCodexReviewArgs(rawArgs, this.getResolvedModel(run.projectId)),
      {
        usageCompletionDetail: "Displayed /review usage.",
        successCompletionDetail: "Completed Codex review.",
        statusDetail: "Running `codex review` for this workspace.",
        emptyOutputMessage: "Codex review completed with no text output.",
      },
    );
  }

  private handleCliOnlyCodexCommandUnavailable(
    state: ProjectState,
    run: PendingRun,
    context: RunContext,
    commandName: string,
    detail: string,
  ): PreparedRunResult {
    const message = [
      `/${commandName} currently requires a compatible local Codex CLI.`,
      detail,
    ].join("\n");
    this.appendAssistantText(state, context, run, message);
    run.onTextDelta?.(message);
    return {
      run,
      handledLocally: true,
      completionDetail: `Displayed /${commandName} runtime requirements.`,
    };
  }

  private prepareCodexFeaturesSlashCommand(
    _state: ProjectState,
    run: PendingRun,
    context: RunContext,
    rawArgs: string,
  ): PreparedRunResult {
    return this.prepareCodexTextSlashCommand(
      run,
      context,
      buildCodexFeaturesArgs(rawArgs, this.getResolvedModel(run.projectId)),
      {
        usageCompletionDetail: "Displayed /features usage.",
        successCompletionDetail: "Displayed Codex feature flags.",
        statusDetail: "Listing Codex CLI feature flags.",
        emptyOutputMessage: "Codex feature listing completed with no text output.",
      },
    );
  }

  private prepareCodexVersionSlashCommand(
    run: PendingRun,
    context: RunContext,
  ): PreparedRunResult {
    return this.prepareCodexTextSlashCommand(
      run,
      context,
      buildCodexVersionArgs(),
      {
        usageCompletionDetail: "Displayed Codex CLI version.",
        successCompletionDetail: "Displayed Codex CLI version.",
        statusDetail: "Checking the installed Codex CLI version.",
        emptyOutputMessage: "Codex CLI version command completed with no text output.",
      },
    );
  }

  private prepareCodexCompletionSlashCommand(
    run: PendingRun,
    context: RunContext,
    rawArgs: string,
  ): PreparedRunResult {
    return this.prepareCodexTextSlashCommand(
      run,
      context,
      buildCodexCompletionArgs(rawArgs),
      {
        usageCompletionDetail: "Displayed /completion usage.",
        successCompletionDetail: "Generated Codex shell completion output.",
        statusDetail: "Generating a Codex shell completion script.",
        emptyOutputMessage: "Codex completion command completed with no text output.",
      },
    );
  }

  private prepareCodexMcpSlashCommand(
    run: PendingRun,
    context: RunContext,
    rawArgs: string,
  ): PreparedRunResult {
    return this.prepareCodexTextSlashCommand(
      run,
      context,
      buildCodexMcpArgs(rawArgs),
      {
        usageCompletionDetail: "Displayed /mcp usage.",
        successCompletionDetail: "Displayed Codex MCP configuration.",
        statusDetail: "Inspecting Codex MCP server configuration.",
        emptyOutputMessage: "Codex MCP command completed with no text output.",
      },
    );
  }

  private prepareCodexTextSlashCommand(
    run: PendingRun,
    context: RunContext,
    commandArgs: {
      args: string[] | null;
      errorMessage?: string;
    },
    options: {
      usageCompletionDetail: string;
      successCompletionDetail: string;
      statusDetail: string;
      emptyOutputMessage: string;
    },
  ): PreparedRunResult {
    if (!commandArgs.args) {
      const message = commandArgs.errorMessage ?? "Invalid Codex command arguments.";
      const state = this.ensureState(run.projectId);
      this.appendAssistantText(state, context, run, message);
      run.onTextDelta?.(message);
      return {
        run,
        handledLocally: true,
        completionDetail: options.usageCompletionDetail,
      };
    }

    return {
      run,
      handledLocally: false,
      completionDetail: options.successCompletionDetail,
      customExecutor: async (projectState, preparedRun, preparedContext) => {
        await this.executeCodexTextCommand(
          projectState,
          preparedRun,
          preparedContext,
          commandArgs.args!,
          {
            statusDetail: options.statusDetail,
            emptyOutputMessage: options.emptyOutputMessage,
          },
        );
      },
    };
  }

  private runProcess(
    state: ProjectState,
    command: string,
    args: string[],
    cwd: string,
    onStdoutLine: (line: string) => void,
    stdinData?: string,
    envOverrides?: Record<string, string>,
    options?: RunProcessOptions,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          FORCE_COLOR: "0",
          ...(envOverrides ?? {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      state.process = child;
      options?.onChildSpawn?.(child);
      this.appendCliTrace(state, "system", `$ ${this.formatCliCommand(command, args)}`);
      this.appendCliTrace(state, "system", `cwd ${cwd}`);
      this.appendCliTrace(state, "system", `pid ${child.pid ?? "unknown"}`);
      if (stdinData) {
        child.stdin.write(stdinData, "utf8");
      }
      child.stdin.end();

      let stdoutBuffer = "";
      let stderrBuffer = "";
      let stderrTraceBuffer = "";
      let exitCode: number | null = null;
      let exitSignal: NodeJS.Signals | null = null;

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk: string) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const normalized = this.normalizeCliOutputText(line);
          if (!normalized) {
            continue;
          }
          onStdoutLine(normalized);
          this.emitSnapshot(state.projectId);
        }
      });

      child.stderr.on("data", (chunk: string) => {
        stderrBuffer += chunk;
        stderrTraceBuffer += chunk;
        const lines = stderrTraceBuffer.split(/\r?\n/);
        stderrTraceBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          this.appendCliTrace(state, "stderr", trimmed);
        }
      });

      child.on("error", (error) => {
        this.appendCliTrace(state, "stderr", `Spawn error: ${error.message}`);
        if (state.pendingStop) {
          reject(new StopRunError(state.pendingStop.reason, state.pendingStop.notifyAsError));
          return;
        }
        reject(error);
      });

      child.on("exit", (code, signal) => {
        exitCode = code;
        exitSignal = signal;
        // Force-destroy streams so inherited handles from grandchild processes
        // don't prevent the "close" event from firing on Windows.
        child.stdout.destroy();
        child.stderr.destroy();
      });

      child.on("close", (code, signal) => {
        const resolvedCode = code ?? exitCode;
        const resolvedSignal = signal ?? exitSignal;
        const finalStdout = this.normalizeCliOutputText(stdoutBuffer);
        if (finalStdout) {
          onStdoutLine(finalStdout);
          this.emitSnapshot(state.projectId);
        }
        if (stderrTraceBuffer.trim()) {
          this.appendCliTrace(state, "stderr", stderrTraceBuffer.trim());
        }

        if (state.pendingStop) {
          const pendingStop = state.pendingStop;
          this.appendCliTrace(state, "system", `Interrupted: ${pendingStop.reason}`);
          reject(new StopRunError(pendingStop.reason, pendingStop.notifyAsError));
          return;
        }

        if (resolvedCode === 0) {
          this.appendCliTrace(state, "system", `${command} exited with code 0`);
          resolve();
          return;
        }

        const stderr = this.normalizeCliOutputText(stderrBuffer);
        if (options?.shouldTreatCloseAsSuccess?.({
          code: resolvedCode,
          signal: resolvedSignal,
          stderr,
        })) {
          this.appendCliTrace(
            state,
            "system",
            options.successCloseMessage?.trim() || `${command} closed after completion`,
          );
          resolve();
          return;
        }

        const exitDetail = resolvedCode !== null
          ? `exited with code ${resolvedCode}`
          : (resolvedSignal ? `terminated by signal ${resolvedSignal}` : "terminated without an exit code");
        this.appendCliTrace(state, "system", `${command} ${exitDetail}`);
        reject(new Error(stderr || `${command} ${exitDetail}`));
      });
    });
  }

  private appendCliTrace(
    state: ProjectState,
    stream: CliTraceEntry["stream"],
    text: string,
  ): void {
    const normalized = this.normalizeCliOutputText(text);
    if (!normalized) {
      return;
    }

    const traceText = this.limitCliTraceEntry(normalized);
    state.cliTrace.push({
      id: uuidv4(),
      stream,
      text: traceText,
      createdAt: Date.now(),
    });
    this.trimCliTrace(state);
    const latestEntry = state.cliTrace[state.cliTrace.length - 1];
    if (latestEntry && this.shouldPersistProjectHistory(state.projectId)) {
      this.historyStore.appendCliTrace(state.projectId, state.activeConversationId, latestEntry);
    }
    appLogger.info("runtime", normalized, {
      projectId: state.projectId,
      provider: state.provider,
      stream,
    });
    this.emitSnapshot(state.projectId);
  }

  private isCliNoiseLine(line: string): boolean {
    return CLI_TRACE_NOISE_PATTERNS.some((pattern) => pattern.test(line));
  }

  private normalizeCliOutputText(text: string): string {
    return text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !this.isCliNoiseLine(line))
      .join("\n")
      .trim();
  }

  private async executeCodexTextCommand(
    state: ProjectState,
    run: PendingRun,
    context: RunContext,
    args: string[],
    options: {
      statusDetail: string;
      emptyOutputMessage: string;
    },
  ): Promise<void> {
    const command = process.platform === "win32" ? "codex.cmd" : "codex";
    let producedOutput = false;

    if (context.runStatusActivityId) {
      this.updateActivity(state, context.runStatusActivityId, {
        detail: options.statusDetail,
      });
    }

    await this.runProcess(
      state,
      command,
      args,
      run.cwd,
      (line) => {
        producedOutput = true;
        const chunk = context.assistantMessageId ? `\n${line}` : line;
        this.appendAssistantText(state, context, run, chunk);
        run.onTextDelta?.(chunk);
      },
      undefined,
      this.getConfig().getProviderEnvironment?.("codex"),
    );

    if (!producedOutput) {
      this.appendAssistantText(state, context, run, options.emptyOutputMessage);
      run.onTextDelta?.(options.emptyOutputMessage);
    }

    if (context.assistantMessageId) {
      this.updateMessage(state, context.assistantMessageId, {
        status: "done",
      });
    }
  }

  private async executeProviderSdk(
    state: ProjectState,
    run: PendingRun,
    context: RunContext,
    runtime: ProviderRuntimeSelection,
  ): Promise<void> {
    const sdkConfig = this.getConfig().getProviderSdkConfig?.(state.provider) ?? null;
    if (!sdkConfig) {
      throw new Error(runtime.detail || "Provider SDK fallback is not configured.");
    }

    if (context.runStatusActivityId) {
      this.updateActivity(state, context.runStatusActivityId, {
        detail: `Running through the ${state.provider === "codex" ? "OpenAI" : "Anthropic"} API fallback runtime.`,
      });
    }

    const abortController = new AbortController();
    const processHandle: ActiveRunProcessHandle = {
      killed: false,
      kill: () => {
        processHandle.killed = true;
        abortController.abort();
      },
    };
    state.process = processHandle;

    try {
      const result = await executeProviderSdkRun({
        provider: state.provider,
        config: sdkConfig,
        model: state.model,
        prompt: run.prompt,
        projectPrompt: this.getConfig().getProjectPrompt?.(state.projectId) ?? null,
        messages: state.messages,
        attachments: run.attachments,
        signal: abortController.signal,
        onTextDelta: (chunk) => {
          this.appendAssistantText(state, context, run, chunk);
          run.onTextDelta?.(chunk);
        },
        onGuidance: (event) => {
          this.recordProviderSdkGuidance(state, context, run, event);
        },
      });

      if (result.model) {
        state.model = result.model;
      }
      if (!context.assistantMessageId) {
        this.appendAssistantText(state, context, run, result.text);
        run.onTextDelta?.(result.text);
      }
      if (context.assistantMessageId) {
        this.updateMessage(state, context.assistantMessageId, {
          status: "done",
        });
      }
      this.addActivity(state, {
        id: uuidv4(),
        kind: "status",
        title: `${this.getProviderLabel(state.provider)} API fallback`,
        detail: "Completed through the provider API runtime.",
        status: "completed",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        meta: {
          source: run.source,
          runId: run.runId,
        },
      });
    } catch (error) {
      if (state.pendingStop) {
        throw new StopRunError(state.pendingStop.reason, state.pendingStop.notifyAsError);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  }

  private recordProviderSdkGuidance(
    state: ProjectState,
    context: RunContext,
    run: PendingRun,
    event: ProviderSdkGuidanceEvent,
  ): void {
    const key = "provider-sdk:" + event.key;
    let activityId = context.activityIdsByKey.get(key);
    const status = event.status ?? "running";
    if (!activityId) {
      activityId = this.addActivity(state, {
        id: uuidv4(),
        kind: event.kind,
        title: event.title,
        detail: event.detail ?? event.delta ?? "",
        status,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        meta: {
          source: run.source,
          runId: run.runId,
          eventKey: event.key,
        },
      });
      context.activityIdsByKey.set(key, activityId);
      return;
    }

    if (event.delta) {
      this.appendActivityDetail(state, activityId, event.delta);
    }
    if (event.detail !== undefined || event.status !== undefined) {
      this.updateActivity(state, activityId, {
        detail: event.detail,
        status,
      });
    }
  }

  private async resolveProviderRuntime(projectId: string, provider: CliProvider): Promise<ProviderRuntimeSelection> {
    const configured = this.getConfig().resolveProviderRuntime;
    if (configured) {
      return await configured(projectId, provider);
    }
    return {
      provider,
      kind: "cli",
      detail: "Using the local CLI runtime.",
      sdkConfigured: false,
      cliStatus: null,
      capabilities: createProviderNativeCliCapabilities(provider),
    };
  }

  private shouldResumeConversation(projectId: string, provider: CliProvider): boolean {
    return this.getConfig().shouldResumeConversation?.(projectId, provider) ?? true;
  }

  private shouldPersistProjectHistory(projectId: string): boolean {
    return this.getConfig().shouldPersistProjectHistory?.(projectId) ?? true;
  }

  private shouldRetryCodexExitCode1(error: unknown, attempt: number): boolean {
    if (attempt >= CODEX_EXIT_CODE_1_MAX_RETRIES) {
      return false;
    }
    if (error instanceof StopRunError) {
      return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    return /codex(?:\.cmd)? exited with code 1/i.test(message);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private formatCliCommand(command: string, args: string[]): string {
    return [command, ...args]
      .map((part) => (/[\s"]/u.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part))
      .join(" ");
  }

  private appendAssistantText(
    state: ProjectState,
    context: RunContext,
    run: PendingRun,
    chunk: string,
  ): void {
    if (!chunk) {
      return;
    }

    if (!context.assistantMessageId) {
      const messageId = run.responseMessageId ?? uuidv4();
      context.assistantMessageId = messageId;
      this.addMessage(state, {
        id: messageId,
        role: "assistant",
        content: chunk,
        provider: state.provider,
        source: run.source,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "streaming",
      });
      return;
    }

    const message = state.messages.find((entry) => entry.id === context.assistantMessageId);
    if (!message) {
      return;
    }

    message.content += chunk;
    message.updatedAt = Date.now();
    message.status = "streaming";
    this.trimMessages(state);
    if (this.shouldPersistProjectHistory(state.projectId)) {
      this.historyStore.upsertMessage(state.projectId, state.activeConversationId, message);
    }
    this.emitSnapshot(state.projectId);
  }

  private addAssistantMessage(
    state: ProjectState,
    context: RunContext,
    run: PendingRun,
    content: string,
    attachments?: RunAttachment[],
  ): void {
    const messageId = context.assistantMessageId ?? run.responseMessageId ?? uuidv4();
    const normalizedAttachments = this.cloneAttachments(attachments);
    context.assistantMessageId = messageId;

    const existing = state.messages.find((entry) => entry.id === messageId);
    if (existing) {
      existing.content = content;
      existing.attachments = normalizedAttachments;
      existing.updatedAt = Date.now();
      existing.status = "done";
      this.trimMessages(state);
      if (this.shouldPersistProjectHistory(state.projectId)) {
        this.historyStore.upsertMessage(state.projectId, state.activeConversationId, existing);
      }
      this.emitSnapshot(state.projectId);
      return;
    }

    this.addMessage(state, {
      id: messageId,
      role: "assistant",
      content,
      attachments: normalizedAttachments,
      provider: state.provider,
      source: run.source,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "done",
    });
  }

  private addMessage(state: ProjectState, message: SessionMessage): void {
    state.messages.push(message);
    this.trimMessages(state);
    if (this.shouldPersistProjectHistory(state.projectId)) {
      this.historyStore.upsertMessage(state.projectId, state.activeConversationId, message);
    }
    this.emitSnapshot(state.projectId);
  }

  private cloneAttachments(attachments?: RunAttachment[]): RunAttachment[] | undefined {
    if (!attachments || attachments.length === 0) {
      return undefined;
    }

    return attachments.map((attachment) => ({ ...attachment }));
  }

  private cloneMessage(message: SessionMessage): SessionMessage {
    return {
      ...message,
      attachments: this.cloneAttachments(message.attachments),
    };
  }

  private isProjectVisibleMessage(message: SessionMessage): boolean {
    return message.source !== "workgroup";
  }

  private isProjectVisibleActivity(activity: SessionActivity): boolean {
    return activity.meta?.source !== "workgroup";
  }

  private isProjectVisibleQueueEntry(entry: Pick<PendingRun, "source">): boolean {
    return entry.source !== "workgroup";
  }

  private getProjectVisibleCurrentSource(state: ProjectState): RunSource | null {
    return state.currentSource === "workgroup" ? null : state.currentSource;
  }

  private getVisibleProjectMessages(
    owner: Pick<ProjectState | ProjectConversationState, "messages">,
  ): SessionMessage[] {
    return owner.messages.filter((message) => this.isProjectVisibleMessage(message));
  }

  private getVisibleProjectActivities(
    owner: Pick<ProjectState | ProjectConversationState, "activities">,
  ): SessionActivity[] {
    return owner.activities.filter((activity) => this.isProjectVisibleActivity(activity));
  }

  private getVisibleProjectQueue(state: Pick<ProjectState, "queue">): PendingRun[] {
    return state.queue.filter((entry) => this.isProjectVisibleQueueEntry(entry));
  }

  private updateMessage(
    state: ProjectState,
    messageId: string,
    patch: Partial<Pick<SessionMessage, "content" | "status">>,
  ): void {
    const message = state.messages.find((entry) => entry.id === messageId);
    if (!message) {
      return;
    }

    if (patch.content !== undefined) {
      message.content = patch.content;
    }
    if (patch.status !== undefined) {
      message.status = patch.status;
    }
    message.updatedAt = Date.now();
    if (this.shouldPersistProjectHistory(state.projectId)) {
      this.historyStore.upsertMessage(state.projectId, state.activeConversationId, message);
    }
    this.emitSnapshot(state.projectId);
  }

  private addActivity(state: ProjectState, activity: SessionActivity): string {
    state.activities.push(activity);
    this.trimActivities(state);
    if (this.shouldPersistProjectHistory(state.projectId)) {
      this.historyStore.upsertActivity(state.projectId, state.activeConversationId, activity);
    }
    this.emitSnapshot(state.projectId);
    return activity.id;
  }

  private updateActivity(
    state: ProjectState,
    activityId: string,
    patch: Partial<Pick<SessionActivity, "detail" | "status" | "meta">>,
  ): void {
    const activity = state.activities.find((entry) => entry.id === activityId);
    if (!activity) {
      return;
    }

    if (patch.detail !== undefined) {
      activity.detail = patch.detail;
    }
    if (patch.status !== undefined) {
      activity.status = patch.status;
    }
    if (patch.meta !== undefined) {
      activity.meta = patch.meta;
    }
    activity.updatedAt = Date.now();
    if (this.shouldPersistProjectHistory(state.projectId)) {
      this.historyStore.upsertActivity(state.projectId, state.activeConversationId, activity);
    }
    this.emitSnapshot(state.projectId);
  }

  private appendActivityDetail(state: ProjectState, activityId: string, chunk: string): void {
    const activity = state.activities.find((entry) => entry.id === activityId);
    if (!activity) {
      return;
    }

    activity.detail += chunk;
    activity.updatedAt = Date.now();
    if (this.shouldPersistProjectHistory(state.projectId)) {
      this.historyStore.upsertActivity(state.projectId, state.activeConversationId, activity);
    }
    this.emitSnapshot(state.projectId);
  }

  private finalizeRun(
    state: ProjectState,
    context: RunContext,
    status: "completed" | "error",
    detail: string,
  ): void {
    if (context.assistantMessageId) {
      this.updateMessage(state, context.assistantMessageId, {
        status: "done",
      });
    }

    for (const activity of state.activities) {
      if (activity.meta?.runId !== context.runId) {
        continue;
      }

      if (activity.status !== "running" && activity.status !== "pending") {
        continue;
      }

      activity.status = status;
      if (activity.kind === "status" && detail) {
        activity.detail = detail;
      }
      activity.updatedAt = Date.now();
      if (this.shouldPersistProjectHistory(state.projectId)) {
        this.historyStore.upsertActivity(state.projectId, state.activeConversationId, activity);
      }
    }

    this.emitSnapshot(state.projectId);
  }

  private safeParse(line: string): unknown {
    try {
      return JSON.parse(line);
    } catch (_error) {
      return null;
    }
  }

  private getResolvedProvider(projectId: string): CliProvider {
    return this.getConfig().getProjectProvider(projectId) === "codex" ? "codex" : "claude";
  }

  private getResolvedModel(projectId: string): string | null {
    const model = this.getConfig().getProjectModel(projectId)?.trim() ?? "";
    return model || null;
  }

  private isCodexWebSearchEnabled(projectId: string): boolean {
    return this.getConfig().getProjectCodexWebSearchEnabled?.(projectId) ?? false;
  }

  private getProviderLabel(provider: CliProvider): string {
    return getRegisteredProviderLabel(provider);
  }

  private getModelSessionKey(provider: CliProvider, model: string | null | undefined): string {
    const normalizedModel = model?.trim().toLowerCase() || "auto";
    return provider + ":" + normalizedModel;
  }

  private normalizeModelSessionRefs(input: unknown): Record<string, ModelSessionRef> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return {};
    }
    const refs: Record<string, ModelSessionRef> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (!key || !value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      const record = value as Record<string, unknown>;
      refs[key] = {
        claudeSessionId: typeof record.claudeSessionId === "string" && record.claudeSessionId.trim()
          ? record.claudeSessionId.trim()
          : null,
        codexThreadId: typeof record.codexThreadId === "string" && record.codexThreadId.trim()
          ? record.codexThreadId.trim()
          : null,
        updatedAt: Number(record.updatedAt) > 0 ? Number(record.updatedAt) : Date.now(),
      };
    }
    return refs;
  }

  private storeCurrentModelSessionRefs(
    state: ProjectState,
    conversation: ProjectConversationState | null = this.getActiveConversation(state),
  ): void {
    if (!conversation) {
      return;
    }
    const key = this.getModelSessionKey(state.provider, state.model);
    conversation.modelSessionRefs[key] = {
      claudeSessionId: state.claudeSessionId,
      codexThreadId: state.codexThreadId,
      updatedAt: Date.now(),
    };
  }

  private restoreModelSessionRefsForState(
    state: ProjectState,
    conversation: ProjectConversationState | null = this.getActiveConversation(state),
  ): boolean {
    if (!conversation) {
      state.claudeSessionId = null;
      state.codexThreadId = null;
      return false;
    }
    const key = this.getModelSessionKey(state.provider, state.model);
    let refs = conversation.modelSessionRefs[key];
    if (!refs && Object.keys(conversation.modelSessionRefs).length === 0) {
      const legacyRef: ModelSessionRef = {
        claudeSessionId: conversation.claudeSessionId,
        codexThreadId: conversation.codexThreadId,
        updatedAt: conversation.updatedAt,
      };
      if (legacyRef.claudeSessionId || legacyRef.codexThreadId) {
        refs = legacyRef;
        conversation.modelSessionRefs[key] = legacyRef;
      }
    }
    state.claudeSessionId = refs?.claudeSessionId ?? null;
    state.codexThreadId = refs?.codexThreadId ?? null;
    return Boolean(
      state.provider === "claude"
        ? state.claudeSessionId
        : state.codexThreadId,
    );
  }

  private normalizeAttachments(attachments?: RunAttachment[]): RunAttachment[] | undefined {
    if (!attachments || attachments.length === 0) {
      return undefined;
    }

    const normalized = attachments
      .filter((attachment) => attachment && typeof attachment.path === "string" && attachment.path.trim())
      .map((attachment) => ({
        id: attachment.id || uuidv4(),
        name: attachment.name?.trim() || "attachment",
        path: attachment.path.trim(),
        size: Number.isFinite(attachment.size) ? Math.max(0, attachment.size) : 0,
        kind: attachment.kind === "image" ? "image" as const : "file" as const,
        mimeType: typeof attachment.mimeType === "string" && attachment.mimeType.trim()
          ? attachment.mimeType.trim()
          : undefined,
        previewDataUrl: typeof attachment.previewDataUrl === "string" && attachment.previewDataUrl.trim()
          ? attachment.previewDataUrl.trim()
          : undefined,
      }));

    return normalized.length > 0 ? normalized : undefined;
  }

  private describeAttachmentPrompt(attachments?: RunAttachment[]): string {
    if (!attachments || attachments.length === 0) {
      return "";
    }

    if (attachments.length === 1) {
      const [attachment] = attachments;
      return attachment.kind === "image"
        ? `Inspect the attached image "${attachment.name}".`
        : `Inspect the attached file "${attachment.name}".`;
    }

    return "Inspect the attached local files.";
  }

  private buildPromptWithAttachments(run: PendingRun): string {
    const attachments = this.normalizeAttachments(run.attachments);
    const projectPrompt = this.buildProjectPrompt(run.projectId);
    const state = this.states.get(run.projectId);
    const modelSwitchContext = state?.pendingModelSwitchContext?.trim() ?? "";
    if (state) {
      state.pendingModelSwitchContext = null;
    }
    if (!attachments || attachments.length === 0) {
      return [projectPrompt, modelSwitchContext, run.prompt].filter(Boolean).join("\n\n");
    }

    const lines = [
      projectPrompt,
      modelSwitchContext,
      run.prompt.trim() || this.describeAttachmentPrompt(attachments),
      "",
      "Local attachments:",
    ].filter((line) => line !== "");
    for (const attachment of attachments) {
      lines.push(`- [${attachment.kind}] ${attachment.name}: ${attachment.path}`);
    }
    lines.push("Use the exact local paths above when you inspect or modify these attachments.");
    if (attachments.some((attachment) => attachment.kind === "image")) {
      lines.push("If an attachment is an image, open the image file directly instead of inferring from its filename.");
    }

    return lines.join("\n");
  }

  private buildModelSwitchContext(
    state: ProjectState,
    previousModel: string | null,
    nextModel: string | null,
  ): string | null {
    const messages = this.getVisibleProjectMessages(state)
      .filter((message) => {
        const content = message.content.trim();
        return (
          (message.role === "user" || message.role === "assistant")
          && content.length > 0
          && !/^\/model(?:\s|$)/i.test(content)
        );
      })
      .slice(-MODEL_SWITCH_CONTEXT_MESSAGE_LIMIT);
    if (messages.length === 0) {
      return null;
    }

    const header = [
      "Context handoff for model switch.",
      `Previous model: ${previousModel?.trim() || "provider default"}`,
      `New model: ${nextModel?.trim() || "provider default"}`,
      "Use this as bounded continuity only. Do not assume hidden prior session state exists.",
      "",
      "Recent conversation context:",
    ].join("\n");
    const parts: string[] = [];
    let remaining = MODEL_SWITCH_CONTEXT_MAX_CHARS - header.length;
    for (let index = messages.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const message = messages[index];
      const role = message.role === "assistant" ? "Assistant" : "User";
      const normalized = message.content.replace(/\s+/g, " ").trim();
      const prefix = `- ${role}: `;
      const entryBudget = Math.max(0, remaining - prefix.length - 1);
      if (entryBudget <= 0) {
        continue;
      }
      const body = normalized.length > entryBudget
        ? normalized.slice(0, Math.max(0, entryBudget - 3)).trimEnd() + "..."
        : normalized;
      const entry = prefix + body;
      parts.unshift(entry);
      remaining -= entry.length + 1;
    }

    if (parts.length === 0) {
      return null;
    }
    return [header, ...parts].join("\n");
  }

  private buildProjectPrompt(projectId: string): string {
    const prompt = this.getConfig().getProjectPrompt?.(projectId)?.trim() ?? "";
    if (!prompt) {
      return "";
    }

    return [
      "Project guidance:",
      prompt,
      "",
      "Use the project guidance above as persistent context for this repository.",
    ].join("\n");
  }

  private parseSlashCommand(prompt: string): SlashCommand | null {
    const trimmed = prompt.trim();
    const match = /^\/([A-Za-z0-9._:-]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
    if (!match) {
      return null;
    }

    return {
      name: match[1].toLowerCase(),
      args: (match[2] ?? "").trim(),
    };
  }

  private handleModelSlashCommand(
    state: ProjectState,
    run: PendingRun,
    context: RunContext,
    rawArgs: string,
  ): string {
    const args = rawArgs.trim();
    if (!args) {
      const currentModel = state.model ?? "Auto";
      const message = [
        `Current provider: ${this.getProviderLabel(state.provider)}`,
        `Current model: ${currentModel}`,
        "Use /model <name> to switch, or /model auto to return to the provider default.",
      ].join("\n");
      this.appendAssistantText(state, context, run, message);
      run.onTextDelta?.(message);
      return "Displayed current model configuration.";
    }

    const normalized = args.toLowerCase();
    const nextModel = normalized === "auto" || normalized === "default" || normalized === "reset"
      ? null
      : args;
    const previousModel = state.model;
    const previousKey = this.getModelSessionKey(state.provider, previousModel);
    const nextKey = this.getModelSessionKey(state.provider, nextModel);
    const modelChanged = previousKey !== nextKey;

    this.storeCurrentModelSessionRefs(state);
    this.getConfig().updateProject(state.projectId, {
      cliModel: nextModel,
    });
    state.model = nextModel;
    let restoredSession = true;
    if (modelChanged) {
      restoredSession = this.restoreModelSessionRefsForState(state);
      state.pendingModelSwitchContext = restoredSession
        ? null
        : this.buildModelSwitchContext(state, previousModel, nextModel);
    }
    this.getConfig().onProjectConfigChanged?.(state.projectId);

    const message = [
      nextModel
        ? `Switched ${this.getProviderLabel(state.provider)} to model: ${nextModel}`
        : `Switched ${this.getProviderLabel(state.provider)} back to the provider default model.`,
      modelChanged && !restoredSession
        ? `The next prompt will include a capped recent-context handoff for the new model.`
        : null,
      modelChanged && restoredSession
        ? `Restored the saved session for this model.`
        : null,
    ].filter(Boolean).join("\n");
    this.appendAssistantText(state, context, run, message);
    run.onTextDelta?.(message);
    return message;
  }

  private handleSearchSlashCommand(
    state: ProjectState,
    run: PendingRun,
    context: RunContext,
    rawArgs: string,
  ): string {
    if (state.provider !== "codex") {
      const message = "The /search command is currently available only for OpenAI Codex projects.";
      this.appendAssistantText(state, context, run, message);
      run.onTextDelta?.(message);
      return message;
    }

    const currentEnabled = this.isCodexWebSearchEnabled(state.projectId);
    const intent = parseSlashToggleIntent(rawArgs);
    if (!intent) {
      const usage = buildCodexSearchUsageMessage();
      this.appendAssistantText(state, context, run, usage);
      run.onTextDelta?.(usage);
      return usage;
    }

    if (intent === "status") {
      const statusMessage = [
        buildCodexSearchStatusMessage(currentEnabled),
        "Use /search on, /search off, or /search toggle to change it.",
      ].join("\n");
      this.appendAssistantText(state, context, run, statusMessage);
      run.onTextDelta?.(statusMessage);
      return "Displayed Codex web search status.";
    }

    const nextEnabled = intent === "toggle" ? !currentEnabled : intent === "enable";
    if (nextEnabled !== currentEnabled) {
      this.getConfig().updateProject(state.projectId, {
        codexWebSearchEnabled: nextEnabled,
      });
      this.getConfig().onProjectConfigChanged?.(state.projectId);
    }

    const message = [
      buildCodexSearchStatusMessage(nextEnabled),
      nextEnabled
        ? "Future Codex runs will include the `--search` flag."
        : "Future Codex runs will no longer include the `--search` flag.",
    ].join("\n");
    this.appendAssistantText(state, context, run, message);
    run.onTextDelta?.(message);
    return message;
  }

  private async handleScreenshotSlashCommand(
    state: ProjectState,
    run: PendingRun,
    context: RunContext,
  ): Promise<string> {
    const captureProjectScreenshot = this.getConfig().captureProjectScreenshot;
    if (!captureProjectScreenshot) {
      const message = "Desktop screenshot capture is not available in this build.";
      this.appendAssistantText(state, context, run, message);
      run.onTextDelta?.(message);
      return message;
    }

    try {
      const attachment = await captureProjectScreenshot(state.projectId);
      this.addAssistantMessage(
        state,
        context,
        run,
        `Captured a desktop screenshot: ${attachment.name}`,
        [attachment],
      );
      return "Captured and shared a desktop screenshot.";
    } catch (error) {
      const message = `Unable to capture a desktop screenshot: ${error instanceof Error ? error.message : String(error)}`;
      this.appendAssistantText(state, context, run, message);
      run.onTextDelta?.(message);
      return message;
    }
  }

  private handleShareImageSlashCommand(
    state: ProjectState,
    run: PendingRun,
    context: RunContext,
    rawArgs: string,
  ): string {
    const rawPath = this.unwrapQuotedValue(rawArgs);
    if (!rawPath) {
      const message = "Usage: /send-image <absolute-or-relative-path>";
      this.appendAssistantText(state, context, run, message);
      run.onTextDelta?.(message);
      return "Displayed /send-image usage.";
    }

    try {
      const attachment = this.createProjectImageAttachment(state.projectId, run.cwd, rawPath);
      this.addAssistantMessage(
        state,
        context,
        run,
        `Shared an image from the desktop workspace: ${attachment.name}`,
        [attachment],
      );
      return `Shared image attachment ${attachment.name}.`;
    } catch (error) {
      const message = `Unable to share image: ${error instanceof Error ? error.message : String(error)}`;
      this.appendAssistantText(state, context, run, message);
      run.onTextDelta?.(message);
      return message;
    }
  }

  private async handleGenerateImageSlashCommand(
    state: ProjectState,
    run: PendingRun,
    context: RunContext,
    rawArgs: string,
  ): Promise<string> {
    const prompt = rawArgs.trim();
    if (!prompt) {
      const message = "Usage: /image <prompt>";
      this.appendAssistantText(state, context, run, message);
      run.onTextDelta?.(message);
      return "Displayed /image usage.";
    }

    const generateProjectImageAsset = this.getConfig().generateProjectImageAsset;
    if (!generateProjectImageAsset) {
      const message = "Project image generation is not available in this build.";
      this.appendAssistantText(state, context, run, message);
      run.onTextDelta?.(message);
      return message;
    }

    try {
      const result = await generateProjectImageAsset({
        projectId: state.projectId,
        cwd: run.cwd,
        provider: state.provider,
        model: state.model,
        prompt,
      });
      const relativePath = this.describeProjectAssetPath(run.cwd, result.savedPath);
      const messageLines = [
        `Generated image asset: ${result.attachment.name}`,
        `Saved to: ${relativePath}`,
      ];
      if (result.model) {
        messageLines.push(`Model: ${result.model}`);
      }
      if (result.revisedPrompt?.trim()) {
        messageLines.push(`Revised prompt: ${result.revisedPrompt.trim()}`);
      }
      this.addAssistantMessage(
        state,
        context,
        run,
        messageLines.join("\n"),
        [result.attachment],
      );
      return `Generated image asset ${result.attachment.name}.`;
    } catch (error) {
      const message = `Unable to generate image: ${error instanceof Error ? error.message : String(error)}`;
      this.appendAssistantText(state, context, run, message);
      run.onTextDelta?.(message);
      return message;
    }
  }

  private unwrapQuotedValue(rawValue: string): string {
    const trimmed = rawValue.trim();
    if (trimmed.length >= 2) {
      const quote = trimmed[0];
      if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
        return trimmed.slice(1, -1).trim();
      }
    }
    return trimmed;
  }

  private isDirectScreenshotRequest(prompt: string): boolean {
    const normalized = prompt.replace(/\s+/g, " ").trim();
    if (!normalized || normalized.startsWith("/")) {
      return false;
    }
    if (normalized.length > 120) {
      return false;
    }
    if (DIRECT_SCREENSHOT_REJECTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return false;
    }

    const screenshotIntent = /(桌面截图|屏幕截图|截个图|截张图|截图发|截图给|截屏发|截屏给|screen ?shot|screenshot|screen capture|capture (the )?(screen|desktop))/iu.test(normalized);
    if (!screenshotIntent) {
      return false;
    }

    return /(发给我|发我|给我看|看一下|看看|回传|发到app|发到聊天|send( it)? to me|send (it )?back|share( it)? here|show me)/iu.test(normalized);
  }

  private createProjectImageAttachment(
    projectId: string,
    cwd: string,
    rawPath: string,
  ): RunAttachment {
    const resolvedPath = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(cwd, rawPath);

    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath || rawPath}`);
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${resolvedPath}`);
    }
    if (!isImageAttachment(resolvedPath)) {
      throw new Error("Only image files are supported by /send-image.");
    }

    const stagedPath = getUniqueAttachmentPath(projectId, path.basename(resolvedPath));
    fs.copyFileSync(resolvedPath, stagedPath);
    return createRunAttachmentFromPath(stagedPath, {
      name: path.basename(resolvedPath),
      kind: "image",
      previewDataUrl: buildImagePreviewDataUrlFromPath(stagedPath, {
        maxDimension: 960,
        maxDataUrlChars: 180_000,
        format: "jpeg",
        jpegQuality: 78,
      }),
    });
  }

  private describeProjectAssetPath(projectPath: string, assetPath: string): string {
    const normalizedProjectPath = projectPath.trim();
    const normalizedAssetPath = assetPath.trim();
    if (!normalizedProjectPath || !normalizedAssetPath) {
      return normalizedAssetPath || assetPath;
    }
    const relativePath = path.relative(normalizedProjectPath, normalizedAssetPath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return normalizedAssetPath;
    }
    return relativePath.replace(/\\/g, "/");
  }

  private createConversationState(createdAt = Date.now()): ProjectConversationState {
    return {
      id: uuidv4(),
      title: "",
      createdAt,
      updatedAt: createdAt,
      cliTrace: [],
      messages: [],
      activities: [],
      claudeSessionId: null,
      codexThreadId: null,
      modelSessionRefs: {},
    };
  }

  private getConversationById(
    state: ProjectState,
    conversationId?: string | null,
  ): ProjectConversationState | null {
    const targetId = conversationId?.trim() || "";
    if (!targetId) {
      return null;
    }
    return state.conversations.find((entry) => entry.id === targetId) ?? null;
  }

  private getActiveConversation(state: ProjectState): ProjectConversationState | null {
    return this.getConversationById(state, state.activeConversationId)
      ?? state.conversations[0]
      ?? null;
  }

  private activateConversationState(
    state: ProjectState,
    conversationId: string,
    conversationState?: ProjectConversationState,
  ): void {
    this.syncActiveConversationMeta(state);
    const conversation = conversationState
      ?? this.getConversationById(state, conversationId)
      ?? null;
    if (!conversation) {
      return;
    }

    if (!state.conversations.some((entry) => entry.id === conversation.id)) {
      state.conversations.push(conversation);
    }

    state.activeConversationId = conversation.id;
    state.cliTrace = conversation.cliTrace;
    state.messages = conversation.messages;
    state.activities = conversation.activities;
    this.restoreModelSessionRefsForState(state, conversation);
    conversation.updatedAt = Date.now();
  }

  private syncActiveConversationMeta(state: ProjectState): void {
    const conversation = this.getConversationById(state, state.activeConversationId);
    if (!conversation) {
      return;
    }
    const visibleMessages = this.getVisibleProjectMessages(state);
    const visibleActivities = this.getVisibleProjectActivities(state);
    this.storeCurrentModelSessionRefs(state, conversation);
    conversation.claudeSessionId = state.claudeSessionId;
    conversation.codexThreadId = state.codexThreadId;
    conversation.updatedAt = Math.max(
      conversation.updatedAt,
      this.getProjectVisibleCurrentSource(state) ? (state.currentStartedAt ?? 0) : 0,
      visibleMessages[visibleMessages.length - 1]?.updatedAt ?? 0,
      visibleActivities[visibleActivities.length - 1]?.updatedAt ?? 0,
      state.cliTrace[state.cliTrace.length - 1]?.createdAt ?? 0,
    );
  }

  private getConversationTitle(conversation: ProjectConversationState): string {
    const explicitTitle = conversation.title?.trim() ?? "";
    if (explicitTitle) {
      return explicitTitle;
    }

    const firstUserMessage = this.getVisibleProjectMessages(conversation)
      .find((entry) => entry.role === "user" && entry.content.trim());
    if (firstUserMessage) {
      return this.previewConversationTitle(firstUserMessage.content);
    }

    return "New conversation";
  }

  private previewConversationTitle(content: string): string {
    const normalized = content.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "New conversation";
    }
    return normalized.length > 48 ? `${normalized.slice(0, 45)}...` : normalized;
  }

  private cloneHistoryItem(
    kind: HistoryPageKind,
    entry: SessionMessage | SessionActivity | CliTraceEntry,
  ): SessionMessage | SessionActivity | CliTraceEntry {
    if (kind === "messages") {
      return this.cloneMessage(entry as SessionMessage);
    }
    if (kind === "activities") {
      const activity = entry as SessionActivity;
      return {
        ...activity,
        meta: activity.meta ? { ...activity.meta } : undefined,
      };
    }
    return { ...(entry as CliTraceEntry) };
  }

  private resetProjectHistoryState(state: ProjectState): void {
    const freshConversation = this.createConversationState();
    state.conversations = [freshConversation];
    state.currentSource = null;
    state.currentPrompt = null;
    state.currentStartedAt = null;
    state.pendingStop = null;
    this.activateConversationState(state, freshConversation.id, freshConversation);
  }

  private rebuildProjectHistoryStore(state: ProjectState): void {
    this.historyStore.clearProject(state.projectId);
    if (!this.shouldPersistProjectHistory(state.projectId)) {
      return;
    }
    for (const conversation of state.conversations) {
      this.historyStore.upsertConversationMeta(state.projectId, {
        conversationId: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        claudeSessionId: conversation.claudeSessionId,
        codexThreadId: conversation.codexThreadId,
        modelSessionRefs: conversation.modelSessionRefs,
      });
      for (const message of conversation.messages) {
        this.historyStore.upsertMessage(state.projectId, conversation.id, message);
      }
      for (const activity of conversation.activities) {
        this.historyStore.upsertActivity(state.projectId, conversation.id, activity);
      }
      for (const entry of conversation.cliTrace) {
        this.historyStore.appendCliTrace(state.projectId, conversation.id, entry);
      }
    }
  }

  private restorePersistedStates(): void {
    for (const { projectId, state: snapshot } of this.historyStore.getAllProjects()) {
      if (!this.shouldPersistProjectHistory(projectId)) {
        this.historyStore.clearProject(projectId);
        continue;
      }
      const restoredQueue = (snapshot.queue ?? [])
        .filter((entry) => entry.source === "desktop")
        .map((entry) => ({
          projectId,
          cwd: entry.cwd,
          prompt: entry.prompt,
          attachments: this.normalizeAttachments(entry.attachments),
          source: entry.source,
          runId: entry.runId,
          queuedAt: entry.queuedAt,
        }));

      const restoredConversations = (snapshot.conversations ?? []).map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        cliTrace: (conversation.cliTrace ?? []).map((entry) => ({
          id: entry.id,
          stream: entry.stream,
          text: entry.text,
          createdAt: entry.createdAt,
        })),
        messages: (conversation.messages ?? []).map((message) => ({
          ...message,
          status: "done" as const,
        })),
        activities: (conversation.activities ?? []).map((activity) => ({
          ...activity,
          status: (activity.status === "running" || activity.status === "pending" ? "error" : activity.status) as SessionActivity["status"],
          updatedAt: activity.updatedAt ?? activity.createdAt ?? Date.now(),
        })),
        claudeSessionId: conversation.claudeSessionId ?? null,
        codexThreadId: conversation.codexThreadId ?? null,
        modelSessionRefs: this.normalizeModelSessionRefs((conversation as ProjectConversationState).modelSessionRefs),
      }));
      const initialConversation = restoredConversations.find((entry) => entry.id === snapshot.activeConversationId)
        ?? restoredConversations[0]
        ?? this.createConversationState();

      this.states.set(projectId, {
        projectId,
        queue: restoredQueue,
        active: false,
        provider: this.getResolvedProvider(projectId),
        model: this.getResolvedModel(projectId),
        currentSource: null,
        currentPrompt: null,
        currentStartedAt: null,
        activeConversationId: initialConversation.id,
        conversations: restoredConversations.length > 0 ? restoredConversations : [initialConversation],
        cliTrace: initialConversation.cliTrace,
        messages: initialConversation.messages,
        activities: initialConversation.activities,
        claudeSessionId: initialConversation.claudeSessionId,
        codexThreadId: initialConversation.codexThreadId,
        pendingModelSwitchContext: null,
        process: null,
        pendingStop: null,
      });

      if (restoredQueue.length > 0) {
        void this.processNext(projectId);
      }
    }
  }

  private ensureState(projectId: string): ProjectState {
    const existing = this.states.get(projectId);
    if (existing) {
      if (!existing.active) {
        existing.provider = this.getResolvedProvider(projectId);
        existing.model = this.getResolvedModel(projectId);
      }
      return existing;
    }

    const created: ProjectState = {
      projectId,
      queue: [],
      active: false,
      provider: this.getResolvedProvider(projectId),
      model: this.getResolvedModel(projectId),
      currentSource: null,
      currentPrompt: null,
      currentStartedAt: null,
      activeConversationId: null,
      conversations: [],
      cliTrace: [],
      messages: [],
      activities: [],
      claudeSessionId: null,
      codexThreadId: null,
      pendingModelSwitchContext: null,
      process: null,
      pendingStop: null,
    };
    const initialConversation = this.createConversationState();
    this.activateConversationState(created, initialConversation.id, initialConversation);
    this.states.set(projectId, created);
    return created;
  }

  private enqueuePendingRun(state: ProjectState, pendingRun: PendingRun): void {
    state.queue.push(pendingRun);
  }

  private emitSnapshot(projectId: string): void {
    const state = this.states.get(projectId);
    if (state) {
      this.syncActiveConversationMeta(state);
      if (this.shouldPersistProjectHistory(projectId)) {
        const activeConversation = this.getActiveConversation(state);
        this.historyStore.updateProjectMeta(projectId, {
          queue: state.queue
            .filter((entry) => entry.source === "desktop")
            .map((entry) => ({
              runId: entry.runId,
              cwd: entry.cwd,
              prompt: entry.prompt,
              attachments: this.cloneAttachments(entry.attachments),
              source: entry.source,
              queuedAt: entry.queuedAt,
            })),
          activeConversationId: state.activeConversationId,
          claudeSessionId: state.claudeSessionId,
          codexThreadId: state.codexThreadId,
          modelSessionRefs: activeConversation?.modelSessionRefs,
          conversationCreatedAt: activeConversation?.createdAt ?? null,
          conversationUpdatedAt: activeConversation?.updatedAt ?? Date.now(),
        });
      }
    }
    this.scheduleSnapshotEmit(projectId);
  }

  private scheduleSnapshotEmit(projectId: string): void {
    if (!this.states.has(projectId)) {
      return;
    }
    if (this.snapshotEmitTimers.has(projectId)) {
      return;
    }

    const elapsedMs = Date.now() - (this.lastSnapshotEmitAt.get(projectId) ?? 0);
    const delayMs = Math.max(0, SNAPSHOT_EMIT_INTERVAL_MS - elapsedMs);
    if (delayMs === 0) {
      this.flushSnapshot(projectId);
      return;
    }

    const timer = setTimeout(() => {
      this.snapshotEmitTimers.delete(projectId);
      this.flushSnapshot(projectId);
    }, delayMs);
    this.snapshotEmitTimers.set(projectId, timer);
  }

  private flushSnapshot(projectId: string): void {
    if (!this.states.has(projectId)) {
      this.clearScheduledSnapshot(projectId);
      return;
    }

    const timer = this.snapshotEmitTimers.get(projectId);
    if (timer) {
      clearTimeout(timer);
      this.snapshotEmitTimers.delete(projectId);
    }

    this.lastSnapshotEmitAt.set(projectId, Date.now());
    this.emit("snapshot", projectId, this.getSnapshot(projectId));
  }

  private clearScheduledSnapshot(projectId: string): void {
    const timer = this.snapshotEmitTimers.get(projectId);
    if (timer) {
      clearTimeout(timer);
      this.snapshotEmitTimers.delete(projectId);
    }
    this.lastSnapshotEmitAt.delete(projectId);
  }

  private trimMessages(state: ProjectState): void {
    void state;
  }

  private trimActivities(state: ProjectState): void {
    if (state.activities.length > MAX_ACTIVITY_HISTORY_ENTRIES) {
      state.activities.splice(0, state.activities.length - MAX_ACTIVITY_HISTORY_ENTRIES);
    }
    const activeConversation = this.getConversationById(state, state.activeConversationId);
    if (activeConversation && activeConversation.activities.length > MAX_ACTIVITY_HISTORY_ENTRIES) {
      activeConversation.activities.splice(0, activeConversation.activities.length - MAX_ACTIVITY_HISTORY_ENTRIES);
    }
  }

  private trimCliTrace(state: ProjectState): void {
    if (state.cliTrace.length > MAX_CLI_TRACE_ENTRIES) {
      state.cliTrace.splice(0, state.cliTrace.length - MAX_CLI_TRACE_ENTRIES);
    }

    let totalChars = state.cliTrace.reduce((sum, entry) => sum + entry.text.length, 0);
    while (state.cliTrace.length > 1 && totalChars > MAX_CLI_TRACE_TOTAL_CHARS) {
      const removed = state.cliTrace.shift();
      totalChars -= removed?.text.length ?? 0;
    }
  }

  private limitCliTraceEntry(text: string): string {
    if (text.length <= MAX_CLI_TRACE_ENTRY_CHARS) {
      return text;
    }

    const preservedTail = text.slice(-MAX_CLI_TRACE_ENTRY_CHARS);
    return `... earlier output omitted ...\n${preservedTail}`;
  }

  private formatToolInput(input: unknown): string {
    if (typeof input === "string") {
      return input;
    }
    if (input === null || input === undefined) {
      return "";
    }
    return JSON.stringify(input, null, 2);
  }

  private formatToolResult(result: Record<string, any>): string {
    const lines: string[] = [];
    const stdout = String(result.stdout ?? "").trim();
    const stderr = String(result.stderr ?? "").trim();

    if (stdout) {
      lines.push(stdout);
    }
    if (stderr) {
      lines.push(stderr);
    }
    if (lines.length === 0) {
      lines.push("No output");
    }
    return lines.join("\n\n");
  }

  private formatCodexCommand(item: Record<string, any>): string {
    const command = String(item.command ?? "").trim();
    const output = String(item.aggregated_output ?? "").trim();
    const exitCode = item.exit_code ?? "";
    const parts = [command];
    if (output) {
      parts.push(output);
    }
    if (exitCode !== "") {
      parts.push(`Exit code: ${exitCode}`);
    }
    return parts.filter(Boolean).join("\n\n");
  }
}

export default RuntimeManager;
export type {
  CliProvider,
  CliTraceEntry,
  ProjectSessionSnapshot,
  QueuedRunSnapshot,
  RunAttachment,
  RunSource,
  SessionActivity,
  SessionMessage,
} from "./runtime-types";
