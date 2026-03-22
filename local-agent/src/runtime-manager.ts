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
import SessionHistoryStore, { PersistedProjectState, PersistedQueuedRun } from "./session-history-store";
import type {
  CliProvider,
  CliTraceEntry,
  ProjectSessionSnapshot,
  QueuedRunSnapshot,
  RunAttachment,
  RunSource,
  SessionActivity,
  SessionMessage,
} from "./runtime-types";

export interface RuntimeConfig {
  getProjectProvider: (projectId: string) => CliProvider;
  getProjectModel: (projectId: string) => string | null;
  updateProject: (projectId: string, updates: { cliModel?: string | null }) => void;
  onProjectConfigChanged?: (projectId: string) => void;
  captureProjectScreenshot?: (projectId: string) => Promise<RunAttachment>;
}

export interface EnqueueMessageOptions {
  projectId: string;
  cwd: string;
  prompt: string;
  attachments?: RunAttachment[];
  source: RunSource;
  interruptCurrent?: boolean;
  interruptReason?: string;
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

interface ProjectState {
  projectId: string;
  queue: PendingRun[];
  active: boolean;
  provider: CliProvider;
  model: string | null;
  currentSource: RunSource | null;
  currentPrompt: string | null;
  currentStartedAt: number | null;
  cliTrace: CliTraceEntry[];
  messages: SessionMessage[];
  activities: SessionActivity[];
  claudeSessionId: string | null;
  codexThreadId: string | null;
  process: ChildProcessWithoutNullStreams | null;
  pendingStop: PendingStop | null;
}

interface PendingStop {
  reason: string;
  notifyAsError: boolean;
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
}

interface RunProcessOptions {
  onChildSpawn?: (child: ChildProcessWithoutNullStreams) => void;
}

const MAX_CLI_TRACE_ENTRIES = 60;
const MAX_CLI_TRACE_TOTAL_CHARS = 24_000;
const MAX_CLI_TRACE_ENTRY_CHARS = 1_200;
const SNAPSHOT_EMIT_INTERVAL_MS = 120;
const CLI_TRACE_NOISE_PATTERNS = [
  /^reading prompt from stdin\.\.\.$/i,
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
      queuedAt: Date.now(),
    };

    if (options.interruptCurrent && state.active) {
      state.queue.unshift(pendingRun);
      this.stopCurrentRun(
        options.projectId,
        options.interruptReason ?? "Interrupted by a newer prompt.",
        false,
      );
    } else {
      state.queue.push(pendingRun);
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
    state.process.kill();
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
    const provider = state.active ? state.provider : this.getResolvedProvider(projectId);
    return {
      projectId,
      provider,
      model: state.model,
      automationMode: "full-auto",
      isRunning: state.active,
      queuedCount: state.queue.length,
      currentSource: state.currentSource,
      currentPrompt: state.currentPrompt,
      currentStartedAt: state.currentStartedAt,
      queue: state.queue.map((entry) => ({
        runId: entry.runId,
        prompt: entry.prompt,
        attachments: this.cloneAttachments(entry.attachments),
        source: entry.source,
        queuedAt: entry.queuedAt,
      })),
      cliTrace: state.cliTrace.map((entry) => ({ ...entry })),
      messages: state.messages.map((message) => this.cloneMessage(message)),
      activities: state.activities.map((activity) => ({
        ...activity,
        meta: activity.meta ? { ...activity.meta } : undefined,
      })),
      sessionRefs: {
        claudeSessionId: state.claudeSessionId,
        codexThreadId: state.codexThreadId,
      },
    };
  }

  getLatestSyncSeq(projectId: string): number {
    return this.historyStore.getLatestSeq(projectId);
  }

  buildSyncDelta(projectId: string, afterSeq = 0) {
    return this.historyStore.buildSyncDelta(projectId, afterSeq);
  }

  dispose(): void {
    for (const timer of this.snapshotEmitTimers.values()) {
      clearTimeout(timer);
    }
    this.snapshotEmitTimers.clear();
    this.lastSnapshotEmitAt.clear();
    for (const state of this.states.values()) {
      if (state.process && !state.process.killed) {
        state.process.kill();
      }
      state.process = null;
    }
    this.historyStore.flushAll();
  }

  clearProject(projectId: string): void {
    const state = this.states.get(projectId);
    if (state?.process && !state.process.killed) {
      state.process.kill();
    }
    this.clearScheduledSnapshot(projectId);
    this.states.delete(projectId);
    this.historyStore.clearProject(projectId);
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
    state.currentSource = next.source;
    state.currentPrompt = next.prompt;
    state.currentStartedAt = Date.now();

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
      const prepared = await this.prepareRun(state, next, context);

      if (prepared.handledLocally) {
        completionDetail = prepared.completionDetail ?? completionDetail;
      } else {
        const run = prepared.run;
        if (state.provider === "claude") {
          await this.executeClaude(state, run, context);
        } else {
          await this.executeCodex(state, run, context);
        }
      }
      this.finalizeRun(
        state,
        context,
        "completed",
        completionDetail,
      );
      next.onDone?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof StopRunError) {
        this.finalizeRun(state, context, "completed", message);
        if (error.notifyAsError) {
          next.onError?.(message);
        }
      } else {
        this.finalizeRun(state, context, "error", message);
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

  private executeClaude(state: ProjectState, run: PendingRun, context: RunContext): Promise<void> {
    const command = process.platform === "win32" ? "claude.cmd" : "claude";
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
    if (state.claudeSessionId) {
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
    );
  }

  private executeCodex(state: ProjectState, run: PendingRun, context: RunContext): Promise<void> {
    const command = process.platform === "win32" ? "codex.cmd" : "codex";
    let codexChild: ChildProcessWithoutNullStreams | null = null;
    let logicalCompletionSeen = false;
    const args = state.codexThreadId
      ? [
          "exec",
          "resume",
          "--json",
          "--dangerously-bypass-approvals-and-sandbox",
          "--skip-git-repo-check",
          ...(state.model ? ["--model", state.model] : []),
          state.codexThreadId,
        ]
      : [
          "exec",
          "--json",
          "--dangerously-bypass-approvals-and-sandbox",
          "--skip-git-repo-check",
          ...(state.model ? ["--model", state.model] : []),
        ];

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
                  runId: run.runId,
                },
              });
            }
            return;
          }

          if (event.type === "item.completed") {
            this.addActivity(state, {
              id: uuidv4(),
              kind: "status",
              title: String(item.type ?? "Item"),
              detail: JSON.stringify(item, null, 2),
              status: "completed",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              meta: {
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
            child.kill();
          }, 1500);
          return;
        }

        if (logicalCompletionSeen && event.type === "error") {
          return;
        }
      },
      this.buildPromptWithAttachments(run),
      {
        onChildSpawn: (child) => {
          codexChild = child;
        },
      },
    );
  }

  private async prepareRun(
    state: ProjectState,
    run: PendingRun,
    context: RunContext,
  ): Promise<PreparedRunResult> {
    const command = this.parseSlashCommand(run.prompt);
    if (!command) {
      return { run, handledLocally: false };
    }

    if (command.name === "help") {
      const helpText = this.buildSlashHelpMessage(state.provider);
      this.appendAssistantText(state, context, run, helpText);
      run.onTextDelta?.(helpText);
      return {
        run,
        handledLocally: true,
        completionDetail: "Displayed slash command help.",
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

    if (state.provider === "codex") {
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
            prompt: this.buildCodexInitPrompt(command.args),
          },
          handledLocally: false,
        };
      }

      const unsupportedText = this.buildCodexUnsupportedSlashMessage(command.name);
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

  private runProcess(
    state: ProjectState,
    command: string,
    args: string[],
    cwd: string,
    onStdoutLine: (line: string) => void,
    stdinData?: string,
    options?: RunProcessOptions,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          FORCE_COLOR: "0",
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

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk: string) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          onStdoutLine(trimmed);
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

      child.on("exit", () => {
        // Force-destroy streams so inherited handles from grandchild processes
        // don't prevent the "close" event from firing on Windows.
        child.stdout.destroy();
        child.stderr.destroy();
      });

      child.on("close", (code) => {
        if (stdoutBuffer.trim()) {
          const finalStdout = stdoutBuffer.trim();
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

        if (code === 0) {
          this.appendCliTrace(state, "system", `${command} exited with code 0`);
          resolve();
          return;
        }

        const stderr = stderrBuffer.trim();
        this.appendCliTrace(state, "system", `${command} exited with code ${code ?? "unknown"}`);
        reject(new Error(stderr || `${command} exited with code ${code ?? "unknown"}`));
      });
    });
  }

  private appendCliTrace(
    state: ProjectState,
    stream: CliTraceEntry["stream"],
    text: string,
  ): void {
    const normalized = text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !this.isCliNoiseLine(line))
      .join("\n")
      .trim();
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
    this.historyStore.upsertMessage(state.projectId, message);
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
      this.historyStore.upsertMessage(state.projectId, existing);
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
    this.historyStore.upsertMessage(state.projectId, message);
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
    this.historyStore.upsertMessage(state.projectId, message);
    this.emitSnapshot(state.projectId);
  }

  private addActivity(state: ProjectState, activity: SessionActivity): string {
    state.activities.push(activity);
    this.trimActivities(state);
    this.historyStore.upsertActivity(state.projectId, activity);
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
    this.historyStore.upsertActivity(state.projectId, activity);
    this.emitSnapshot(state.projectId);
  }

  private appendActivityDetail(state: ProjectState, activityId: string, chunk: string): void {
    const activity = state.activities.find((entry) => entry.id === activityId);
    if (!activity) {
      return;
    }

    activity.detail += chunk;
    activity.updatedAt = Date.now();
    this.historyStore.upsertActivity(state.projectId, activity);
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
      this.historyStore.upsertActivity(state.projectId, activity);
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

  private getProviderLabel(provider: CliProvider): string {
    return provider === "codex" ? "OpenAI Codex" : "Claude Code";
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
    if (!attachments || attachments.length === 0) {
      return run.prompt;
    }

    const lines = [run.prompt.trim() || this.describeAttachmentPrompt(attachments), "", "Local attachments:"];
    for (const attachment of attachments) {
      lines.push(`- [${attachment.kind}] ${attachment.name}: ${attachment.path}`);
    }
    lines.push("Use the exact local paths above when you inspect or modify these attachments.");
    if (attachments.some((attachment) => attachment.kind === "image")) {
      lines.push("If an attachment is an image, open the image file directly instead of inferring from its filename.");
    }

    return lines.join("\n");
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

  private buildSlashHelpMessage(provider: CliProvider): string {
    const lines = [
      "Supported slash commands in this app:",
      "- /help: show slash-command support in the desktop workspace.",
      "- /init [extra notes]: initialize project guidance for future agent runs.",
      "- /model: show the current project model.",
      "- /model <name>: switch the current project to a specific model.",
      "- /model auto: return to the provider default model.",
      "- /screenshot: capture the primary desktop display and send it back into this chat.",
      "- /send-image <path>: copy a local image into this chat. Relative paths resolve from the project root.",
      "",
      "Provider behavior:",
      "- Claude Code: native slash commands are passed through when Claude's headless mode supports them.",
      "- OpenAI Codex: headless codex exec does not expose native slash commands, so this app emulates local commands such as /help, /model, /screenshot, and /send-image.",
    ];

    if (provider === "codex") {
      lines.push("- For other Codex slash commands, use a normal prompt or the full interactive Codex CLI.");
    }

    return lines.join("\n");
  }

  private buildCodexUnsupportedSlashMessage(commandName: string): string {
    return [
      `/${commandName} is not available in headless Codex mode.`,
      "This workspace currently emulates /help, /model, /screenshot, and /send-image for Codex projects.",
      "Use a normal prompt for the same intent, or run the full interactive Codex CLI if you need native slash commands.",
    ].join("\n");
  }

  private buildCodexInitPrompt(extraNotes: string): string {
    const parts = [
      "Initialize this repository for future Codex and coding-agent sessions.",
      "Inspect the repository first, then create or update a root-level AGENTS.md file.",
      "Keep AGENTS.md concise and practical.",
      "Include only guidance you can verify from the repository, such as project structure, important commands, test/build/lint workflows, and coding conventions.",
      "If AGENTS.md already exists, improve it in place instead of duplicating content.",
    ];

    if (extraNotes) {
      parts.push(`Additional user guidance: ${extraNotes}`);
    }

    return parts.join("\n");
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

    this.getConfig().updateProject(state.projectId, {
      cliModel: nextModel,
    });
    state.model = nextModel;
    this.getConfig().onProjectConfigChanged?.(state.projectId);

    const message = nextModel
      ? `Switched ${this.getProviderLabel(state.provider)} to model: ${nextModel}`
      : `Switched ${this.getProviderLabel(state.provider)} back to the provider default model.`;
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

  private restorePersistedStates(): void {
    for (const { projectId, state: snapshot } of this.historyStore.getAllProjects()) {
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

      this.states.set(projectId, {
        projectId,
        queue: restoredQueue,
        active: false,
        provider: this.getResolvedProvider(projectId),
        model: this.getResolvedModel(projectId),
        currentSource: null,
        currentPrompt: null,
        currentStartedAt: null,
        cliTrace: [],
        messages: (snapshot.messages ?? []).map((message) => ({
          ...message,
          status: "done",
        })),
        activities: (snapshot.activities ?? []).map((activity) => ({
          ...activity,
          status: activity.status === "running" || activity.status === "pending" ? "error" : activity.status,
          updatedAt: activity.updatedAt ?? activity.createdAt ?? Date.now(),
        })),
        claudeSessionId: snapshot.claudeSessionId ?? null,
        codexThreadId: snapshot.codexThreadId ?? null,
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
      cliTrace: [],
      messages: [],
      activities: [],
      claudeSessionId: null,
      codexThreadId: null,
      process: null,
      pendingStop: null,
    };
    this.states.set(projectId, created);
    return created;
  }

  private emitSnapshot(projectId: string): void {
    const state = this.states.get(projectId);
    if (state) {
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
        claudeSessionId: state.claudeSessionId,
        codexThreadId: state.codexThreadId,
      });
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
    void state;
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
