import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as readline from "readline";

export interface CodexAppServerEvent {
  method: string;
  params: Record<string, unknown>;
}

export interface CodexAppServerOptions {
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  onEvent?: (event: CodexAppServerEvent) => void;
  onExit?: (error: Error) => void;
}

export class CodexAppServer {
  readonly child: ChildProcessWithoutNullStreams;
  private nextRequestId = 1;
  private readonly pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>();

  constructor(options: CodexAppServerOptions) {
    this.child = spawn(options.command, ["app-server", "--stdio"], {
      cwd: options.cwd,
      env: { ...process.env, FORCE_COLOR: "0", ...(options.env ?? {}) },
      windowsHide: true,
    });
    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line, options.onEvent));
    this.child.stderr.on("data", () => undefined);
    this.child.once("error", (error) => {
      this.rejectAll(error);
      options.onExit?.(error);
    });
    this.child.once("close", () => {
      const error = new Error("Codex app server exited before the turn completed.");
      this.rejectAll(error);
      options.onExit?.(error);
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "AgentFlow Desktop", version: "1.0" },
      capabilities: {},
    });
    this.notify("initialized", {});
  }

  async startThread(options: { cwd: string; model: string | null }): Promise<string> {
    const result = await this.request("thread/start", {
      cwd: options.cwd,
      model: options.model,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
    });
    const threadId = String(result?.thread?.id ?? "");
    if (!threadId) throw new Error("Codex app server did not return a thread id.");
    return threadId;
  }

  async resumeThread(threadId: string): Promise<void> {
    await this.request("thread/resume", { threadId });
  }

  async startTurn(options: { threadId: string; prompt: string; cwd: string; model: string | null; effort: string | null }): Promise<string> {
    const result = await this.request("turn/start", {
      threadId: options.threadId,
      input: [{ type: "text", text: options.prompt }],
      cwd: options.cwd,
      model: options.model,
      effort: options.effort,
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    });
    const turnId = String(result?.turn?.id ?? result?.turnId ?? "");
    if (!turnId) throw new Error("Codex app server did not return a turn id.");
    return turnId;
  }

  async steer(options: { threadId: string; expectedTurnId: string; prompt: string }): Promise<void> {
    await this.request("turn/steer", {
      threadId: options.threadId,
      expectedTurnId: options.expectedTurnId,
      input: [{ type: "text", text: options.prompt }],
    });
  }

  stop(): void {
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill();
  }

  private request(method: string, params: Record<string, unknown>): Promise<any> {
    const id = this.nextRequestId++;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private handleLine(line: string, onEvent?: (event: CodexAppServerEvent) => void): void {
    let message: any;
    try { message = JSON.parse(line); } catch { return; }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(String(message.error.message ?? "Codex app server request failed.")));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.method === "string") onEvent?.({ method: message.method, params: message.params ?? {} });
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
