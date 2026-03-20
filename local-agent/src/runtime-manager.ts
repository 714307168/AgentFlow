import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { EventEmitter } from "events";
import Store from "electron-store";
import { v4 as uuidv4 } from "uuid";
import appLogger from "./app-logger";

export type CliProvider = "claude" | "codex";
export type RunSource = "remote" | "desktop";

export interface RuntimeConfig {
  getProjectProvider: (projectId: string) => CliProvider;
  getProjectModel: (projectId: string) => string | null;
  updateProject: (projectId: string, updates: { cliModel?: string | null }) => void;
  onProjectConfigChanged?: (projectId: string) => void;
}

export interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  provider?: CliProvider | null;
  source: RunSource;
  createdAt: number;
  updatedAt: number;
  status: "streaming" | "done";
}

export interface SessionActivity {
  id: string;
  kind: "status" | "thinking" | "tool" | "command" | "agent" | "error";
  title: string;
  detail: string;
  status: "pending" | "running" | "completed" | "error";
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, string | number | boolean>;
}

export interface QueuedRunSnapshot {
  runId: string;
  prompt: string;
  source: RunSource;
  queuedAt: number;
}

export interface CliTraceEntry {
  id: string;
  stream: "system" | "stdout" | "stderr";
  text: string;
  createdAt: number;
}

export interface ProjectSessionSnapshot {
  projectId: string;
  provider: CliProvider;
  model: string | null;
  automationMode: "full-auto";
  isRunning: boolean;
  queuedCount: number;
  currentSource: RunSource | null;
  currentPrompt: string | null;
  currentStartedAt: number | null;
  queue: QueuedRunSnapshot[];
  cliTrace: CliTraceEntry[];
  messages: SessionMessage[];
  activities: SessionActivity[];
  sessionRefs: {
    claudeSessionId: string | null;
    codexThreadId: string | null;
  };
}

export interface EnqueueMessageOptions {
  projectId: string;
  cwd: string;
  prompt: string;
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

interface PersistedProjectState {
  messages: SessionMessage[];
  activities: SessionActivity[];
  claudeSessionId: string | null;
  codexThreadId: string | null;
}

interface RuntimeStoreSchema {
  sessionsByProjectId: Record<string, PersistedProjectState>;
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
  private readonly store = new Store<RuntimeStoreSchema>({
    name: "runtime-sessions",
    defaults: {
      sessionsByProjectId: {},
    },
  });

  constructor(private readonly getConfig: () => RuntimeConfig) {
    super();
    this.restorePersistedStates();
  }

  enqueueMessage(options: EnqueueMessageOptions): void {
    const prompt = options.prompt.replace(/\r\n/g, "\n");
    if (!prompt.trim()) {
      options.onError?.("Prompt cannot be empty");
      return;
    }

    const state = this.ensureState(options.projectId);
    const pendingRun: PendingRun = {
      ...options,
      prompt,
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
        source: entry.source,
        queuedAt: entry.queuedAt,
      })),
      cliTrace: state.cliTrace.map((entry) => ({ ...entry })),
      messages: state.messages.map((message) => ({ ...message })),
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

  dispose(): void {
    for (const state of this.states.values()) {
      if (state.process && !state.process.killed) {
        state.process.kill();
      }
      state.process = null;
    }
  }

  clearProject(projectId: string): void {
    const state = this.states.get(projectId);
    if (state?.process && !state.process.killed) {
      state.process.kill();
    }
    this.states.delete(projectId);
    const sessionsByProjectId = { ...this.store.get("sessionsByProjectId", {}) };
    delete sessionsByProjectId[projectId];
    this.store.set("sessionsByProjectId", sessionsByProjectId);
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
      run.prompt,
    );
  }

  private executeCodex(state: ProjectState, run: PendingRun, context: RunContext): Promise<void> {
    const command = process.platform === "win32" ? "codex.cmd" : "codex";
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

        if (event.type === "turn.completed" && context.assistantMessageId) {
          this.updateMessage(state, context.assistantMessageId, {
            status: "done",
          });
        }
      },
      run.prompt,
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
          this.appendCliTrace(state, "stdout", trimmed);
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
          this.appendCliTrace(state, "stdout", finalStdout);
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
    const normalized = text.replace(/\r\n/g, "\n").trim();
    if (!normalized) {
      return;
    }

    state.cliTrace.push({
      id: uuidv4(),
      stream,
      text: normalized,
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
  }

  private addMessage(state: ProjectState, message: SessionMessage): void {
    state.messages.push(message);
    this.trimMessages(state);
    this.emitSnapshot(state.projectId);
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
    this.emitSnapshot(state.projectId);
  }

  private addActivity(state: ProjectState, activity: SessionActivity): string {
    state.activities.push(activity);
    this.trimActivities(state);
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
    this.emitSnapshot(state.projectId);
  }

  private appendActivityDetail(state: ProjectState, activityId: string, chunk: string): void {
    const activity = state.activities.find((entry) => entry.id === activityId);
    if (!activity) {
      return;
    }

    activity.detail += chunk;
    activity.updatedAt = Date.now();
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
      "",
      "Provider behavior:",
      "- Claude Code: native slash commands are passed through when Claude's headless mode supports them.",
      "- OpenAI Codex: headless codex exec does not expose native slash commands, so this app emulates /init, /help, and /model.",
    ];

    if (provider === "codex") {
      lines.push("- For other Codex slash commands, use a normal prompt or the full interactive Codex CLI.");
    }

    return lines.join("\n");
  }

  private buildCodexUnsupportedSlashMessage(commandName: string): string {
    return [
      `/${commandName} is not available in headless Codex mode.`,
      "This workspace currently emulates /help, /init, and /model for Codex projects.",
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

  private restorePersistedStates(): void {
    const persisted = this.store.get("sessionsByProjectId", {});
    for (const [projectId, snapshot] of Object.entries(persisted)) {
      this.states.set(projectId, {
        projectId,
        queue: [],
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
    }
  }

  private persistState(projectId: string): void {
    const state = this.states.get(projectId);
    if (!state) {
      return;
    }

    const sessionsByProjectId = {
      ...this.store.get("sessionsByProjectId", {}),
      [projectId]: {
        messages: state.messages.map((message) => ({ ...message })),
        activities: state.activities.map((activity) => ({
          ...activity,
          meta: activity.meta ? { ...activity.meta } : undefined,
        })),
        claudeSessionId: state.claudeSessionId,
        codexThreadId: state.codexThreadId,
      },
    };
    this.store.set("sessionsByProjectId", sessionsByProjectId);
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
    this.persistState(projectId);
    this.emit("snapshot", projectId, this.getSnapshot(projectId));
  }

  private trimMessages(state: ProjectState): void {
    const maxMessages = 80;
    if (state.messages.length > maxMessages) {
      state.messages.splice(0, state.messages.length - maxMessages);
    }
  }

  private trimActivities(state: ProjectState): void {
    const maxActivities = 160;
    if (state.activities.length > maxActivities) {
      state.activities.splice(0, state.activities.length - maxActivities);
    }
  }

  private trimCliTrace(state: ProjectState): void {
    const maxCliTraceEntries = 240;
    if (state.cliTrace.length > maxCliTraceEntries) {
      state.cliTrace.splice(0, state.cliTrace.length - maxCliTraceEntries);
    }
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
