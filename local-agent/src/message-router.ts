import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import RelayClient from "./relay-client";
import projectStore from "./project-store";
import RuntimeManager, { CliProvider } from "./runtime-manager";
import { Envelope, Events } from "./types";

interface MessageRouterOptions {
  revealProjectWindow?: (projectId: string, projectName: string) => void;
  revealWakeupWindow?: () => void;
  runtimeManager?: RuntimeManager;
  getDefaultCliProvider?: () => CliProvider;
  syncProjectCatalog?: () => void;
  onProjectsChanged?: () => void;
}

class MessageRouter {
  private relayClient: RelayClient;
  private streamSeq: Map<string, number> = new Map();
  private fileBuffers: Map<string, { fileName: string; chunks: Map<number, Buffer>; totalChunks: number }> = new Map();
  private options: MessageRouterOptions;

  constructor(relayClient: RelayClient, options: MessageRouterOptions = {}) {
    this.relayClient = relayClient;
    this.options = options;
    this.relayClient.on("message", (env: Envelope) => this.handleEnvelope(env));
  }

  private normalizeCliProvider(
    provider: string | null | undefined,
    fallback: CliProvider,
  ): CliProvider {
    if (provider === "claude" || provider === "codex") {
      return provider;
    }
    return fallback;
  }

  handleEnvelope(env: Envelope): void {
    switch (env.event) {
      case Events.MESSAGE_SEND:
        this.handleMessageSend(env);
        break;
      case Events.PROJECT_BIND:
        this.handleProjectBind(env);
        break;
      case Events.PROJECT_BOUND:
        this.handleProjectBound(env);
        break;
      case Events.PROJECT_LIST_REQUEST:
        this.handleProjectListRequest();
        break;
      case Events.SESSION_SYNC_REQUEST:
        this.handleSessionSyncRequest(env);
        break;
      case Events.AGENT_WAKEUP:
        this.handleAgentWakeup(env);
        break;
      case Events.FILE_UPLOAD:
        this.handleFileUpload(env);
        break;
      case Events.FILE_CHUNK:
        this.handleFileChunk(env);
        break;
      case Events.FILE_DONE:
        this.handleFileDone(env);
        break;
      case Events.AUTH_OK:
        console.log("[MessageRouter] Auth OK");
        break;
      case Events.AUTH_ERROR:
        console.error("[MessageRouter] Auth error:", env.payload);
        break;
      default:
        console.log("[MessageRouter] Unhandled event: " + env.event);
    }
  }

  private handleMessageSend(env: Envelope): void {
    console.log("[MessageRouter] Received message.send:", JSON.stringify(env));
    const projectId = env.project_id;
    const streamId = env.stream_id || uuidv4(); // Generate if not provided

    if (!projectId) {
      console.error("[MessageRouter] message.send missing project_id");
      return;
    }

    const project = projectStore.getById(projectId);
    console.log("[MessageRouter] All projects:", JSON.stringify(projectStore.getAll()));
    if (!project) {
      console.error("[MessageRouter] Unknown project: " + projectId);
      this.relayClient.send({
        id: uuidv4(),
        event: Events.MESSAGE_ERROR,
        project_id: projectId,
        stream_id: streamId,
        ts: Date.now(),
        payload: { error: "Project " + projectId + " not found" },
      });
      return;
    }

    this.options.revealProjectWindow?.(projectId, project.name);
    const payload = env.payload as { content?: string } | undefined;
    const content = payload?.content ?? "";
    this.streamSeq.set(streamId, 0);
    if (!this.options.runtimeManager) {
      this.relayClient.send({
        id: uuidv4(),
        event: Events.MESSAGE_ERROR,
        project_id: projectId,
        stream_id: streamId,
        ts: Date.now(),
        payload: { error: "Runtime manager is not configured" },
      });
      return;
    }

    this.options.runtimeManager.enqueueMessage({
      projectId,
      cwd: project.path,
      prompt: content,
      source: "remote",
      runId: env.id,
      responseMessageId: streamId,
      onTextDelta: (chunk) => {
        if (chunk) {
          this.sendChunk(projectId, streamId, chunk, false);
        }
      },
      onDone: () => {
        this.sendChunk(projectId, streamId, "", true);
        this.streamSeq.delete(streamId);
      },
      onError: (error) => {
        this.streamSeq.delete(streamId);
        this.relayClient.send({
          id: uuidv4(),
          event: Events.MESSAGE_ERROR,
          project_id: projectId,
          stream_id: streamId,
          ts: Date.now(),
          payload: { error },
        });
      },
    });
  }

  private handleProjectBind(env: Envelope): void {
    console.log("[MessageRouter] Received project.bind:", JSON.stringify(env));
    const payload = env.payload as {
      project_id?: string;
      id?: string;
      name?: string;
      path?: string;
      agent_id?: string;
      cli_provider?: CliProvider;
      cli_model?: string | null;
    } | undefined;
    const projectId = payload?.project_id ?? payload?.id;

    if (!projectId || !payload?.name || !payload?.path) {
      console.error("[MessageRouter] project.bind missing required fields, payload:", JSON.stringify(payload));
      return;
    }

    const existing = projectStore.getById(projectId);
    const fallbackProvider = existing?.cliProvider ?? (this.options.getDefaultCliProvider?.() ?? "claude");
    const cliProvider = this.normalizeCliProvider(payload.cli_provider, fallbackProvider);
    if (existing) {
      projectStore.update(projectId, {
        name: payload.name,
        path: payload.path,
        cliProvider,
        cliModel: payload.cli_model?.trim() ? payload.cli_model.trim() : existing.cliModel ?? null,
      });
    } else {
      projectStore.add({
        id: projectId,
        name: payload.name,
        path: payload.path,
        agentId: payload.agent_id ?? "",
        cliProvider,
        cliModel: payload.cli_model?.trim() ? payload.cli_model.trim() : null,
        createdAt: Date.now(),
      });
    }

    console.log("[MessageRouter] Project bound: " + payload.name + " (" + projectId + ")");
    this.options.onProjectsChanged?.();

    this.relayClient.send({
      id: uuidv4(),
      event: Events.PROJECT_BOUND,
      project_id: projectId,
      ts: Date.now(),
      payload: { project_id: projectId },
    });
  }

  private handleProjectBound(env: Envelope): void {
    const projectId = env.project_id ?? "unknown";
    console.log("[MessageRouter] Project bind acknowledged:", projectId);
  }

  private handleProjectListRequest(): void {
    this.options.syncProjectCatalog?.();
  }

  private handleSessionSyncRequest(env: Envelope): void {
    const projectId = env.project_id;
    if (!projectId || !this.options.runtimeManager) {
      return;
    }

    const snapshot = this.options.runtimeManager.getSnapshot(projectId);
    this.relayClient.send({
      id: uuidv4(),
      event: Events.SESSION_SYNC,
      project_id: projectId,
      ts: Date.now(),
      payload: {
        project_id: projectId,
        provider: snapshot.provider,
        model: snapshot.model,
        isRunning: snapshot.isRunning,
        queuedCount: snapshot.queuedCount,
        currentSource: snapshot.currentSource,
        currentPrompt: snapshot.currentPrompt,
        currentStartedAt: snapshot.currentStartedAt,
        queue: snapshot.queue,
        messages: snapshot.messages,
        activities: snapshot.activities,
      },
    });
  }

  private handleAgentWakeup(env: Envelope): void {
    console.log("[MessageRouter] Agent wakeup received", env.payload);
    this.options.revealWakeupWindow?.();
  }

  private handleFileUpload(env: Envelope): void {
    const payload = env.payload as any;
    const fileId = env.id;
    const fileName = payload?.file_name;

    if (!fileId || !fileName) {
      console.error("[MessageRouter] file.upload missing required fields");
      return;
    }

    const safeFileName = this.sanitizeUploadFileName(String(fileName));
    console.log(`[MessageRouter] File upload started: ${fileName} (${fileId})`);
    this.fileBuffers.set(fileId, {
      fileName: safeFileName,
      chunks: new Map(),
      totalChunks: 0
    });
  }

  private handleFileChunk(env: Envelope): void {
    const payload = env.payload as any;
    const fileId = payload?.file_id;
    const chunkData = payload?.chunk;
    const seq = payload?.seq || 0;

    if (!fileId || !chunkData) {
      console.error("[MessageRouter] file.chunk missing required fields");
      return;
    }

    const buffer = this.fileBuffers.get(fileId);
    if (!buffer) {
      console.error(`[MessageRouter] No buffer found for file ${fileId}`);
      return;
    }

    // Decode base64 chunk
    const chunkBuffer = Buffer.from(chunkData, 'base64');
    buffer.chunks.set(seq, chunkBuffer);
    console.log(`[MessageRouter] Received chunk ${seq} for file ${fileId}`);
  }

  private handleFileDone(env: Envelope): void {
    const payload = env.payload as any;
    const fileId = payload?.file_id;

    if (!fileId) {
      console.error("[MessageRouter] file.done missing file_id");
      return;
    }

    const buffer = this.fileBuffers.get(fileId);
    if (!buffer) {
      console.error(`[MessageRouter] No buffer found for file ${fileId}`);
      return;
    }

    try {
      // Assemble chunks in order
      const sortedChunks = Array.from(buffer.chunks.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([_, chunk]) => chunk);

      const completeFile = Buffer.concat(sortedChunks);

      // Save to downloads folder
      const downloadsPath = app.getPath('downloads');
      const filePath = path.join(downloadsPath, buffer.fileName);
      fs.writeFileSync(filePath, completeFile);

      console.log(`[MessageRouter] File saved: ${filePath}`);

      // Send confirmation back
      this.relayClient.send({
        id: uuidv4(),
        event: Events.FILE_DONE,
        project_id: env.project_id,
        stream_id: fileId,
        ts: Date.now(),
        payload: {
          file_id: fileId,
          file_name: buffer.fileName,
          file_path: filePath
        }
      });

      // Clean up
      this.fileBuffers.delete(fileId);
    } catch (error) {
      console.error(`[MessageRouter] Error saving file:`, error);
      this.relayClient.send({
        id: uuidv4(),
        event: Events.FILE_ERROR,
        project_id: env.project_id,
        stream_id: fileId,
        ts: Date.now(),
        payload: { error: String(error) }
      });
      this.fileBuffers.delete(fileId);
    }
  }

  private sanitizeUploadFileName(fileName: string): string {
    const baseName = path.basename(fileName).trim();
    const sanitized = baseName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
    return sanitized || "download.bin";
  }

  private sendChunk(
    projectId: string,
    streamId: string,
    content: string,
    done: boolean
  ): void {
    const seq = (this.streamSeq.get(streamId) ?? 0) + 1;
    this.streamSeq.set(streamId, seq);

    this.relayClient.send({
      id: uuidv4(),
      event: done ? Events.MESSAGE_DONE : Events.MESSAGE_CHUNK,
      project_id: projectId,
      stream_id: streamId,
      seq,
      ts: Date.now(),
      payload: done ? { seq_total: seq } : { seq, content },
    });
  }
}

export default MessageRouter;
