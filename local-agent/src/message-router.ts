import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import RelayClient from "./relay-client";
import ptyManager from "./pty-manager";
import projectStore from "./project-store";
import { Envelope, Events } from "./types";

class MessageRouter {
  private relayClient: RelayClient;
  private streamSeq: Map<string, number> = new Map();
  private fileBuffers: Map<string, { fileName: string; chunks: Map<number, Buffer>; totalChunks: number }> = new Map();

  constructor(relayClient: RelayClient) {
    this.relayClient = relayClient;
    this.relayClient.on("message", (env: Envelope) => this.handleEnvelope(env));
  }

  handleEnvelope(env: Envelope): void {
    switch (env.event) {
      case Events.MESSAGE_SEND:
        this.handleMessageSend(env);
        break;
      case Events.PROJECT_BIND:
        this.handleProjectBind(env);
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

    if (!ptyManager.isAlive(projectId)) {
      try {
        ptyManager.spawn(projectId, project.path);
      } catch (err) {
        console.error("[MessageRouter] Failed to spawn PTY:", err);
        this.relayClient.send({
          id: uuidv4(),
          event: Events.MESSAGE_ERROR,
          project_id: projectId,
          stream_id: streamId,
          ts: Date.now(),
          payload: { error: "Failed to start Claude session" },
        });
        return;
      }
    }

    const session = ptyManager.get(projectId)!;
    const parser = session.parser;

    parser.reset();
    this.streamSeq.set(streamId, 0);

    const onChunk = (content: string) => {
      this.sendChunk(projectId, streamId, content, false);
    };

    const onDone = () => {
      this.sendChunk(projectId, streamId, "", true);
      parser.removeListener("chunk", onChunk);
      parser.removeListener("done", onDone);
      this.streamSeq.delete(streamId);
    };

    parser.on("chunk", onChunk);
    parser.once("done", onDone);

    const payload = env.payload as { content?: string } | undefined;
    const content = payload?.content ?? "";
    try {
      ptyManager.write(projectId, content + "\n");
    } catch (err) {
      console.error("[MessageRouter] Failed to write to PTY:", err);
      parser.removeListener("chunk", onChunk);
      parser.removeListener("done", onDone);
      this.relayClient.send({
        id: uuidv4(), event: Events.MESSAGE_ERROR,
        project_id: projectId,
        stream_id: streamId,
        ts: Date.now(),
        payload: { error: "Failed to send message to Claude" },
      });
    }
  }

  private handleProjectBind(env: Envelope): void {
    console.log("[MessageRouter] Received project.bind:", JSON.stringify(env));
    const payload = env.payload as {
      project_id?: string;
      id?: string;
      name?: string;
      path?: string;
      agent_id?: string;
    } | undefined;
    const projectId = payload?.project_id ?? payload?.id;

    if (!projectId || !payload?.name || !payload?.path) {
      console.error("[MessageRouter] project.bind missing required fields, payload:", JSON.stringify(payload));
      return;
    }

    const existing = projectStore.getById(projectId);
    if (existing) {
      projectStore.update(projectId, { name: payload.name, path: payload.path });
    } else {
      projectStore.add({
        id: projectId,
        name: payload.name,
        path: payload.path,
        agentId: payload.agent_id ?? "",
        createdAt: Date.now(),
      });
    }

    console.log("[MessageRouter] Project bound: " + payload.name + " (" + projectId + ")");

    this.relayClient.send({
      id: uuidv4(),
      event: Events.PROJECT_BOUND,
      project_id: projectId,
      ts: Date.now(),
      payload: { project_id: projectId },
    });
  }

  private handleAgentWakeup(env: Envelope): void {
    console.log("[MessageRouter] Agent wakeup received", env.payload);
  }

  private handleFileUpload(env: Envelope): void {
    const payload = env.payload as any;
    const fileId = env.id;
    const fileName = payload?.file_name;

    if (!fileId || !fileName) {
      console.error("[MessageRouter] file.upload missing required fields");
      return;
    }

    console.log(`[MessageRouter] File upload started: ${fileName} (${fileId})`);
    this.fileBuffers.set(fileId, {
      fileName,
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
    const fileName = payload?.file_name;

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
      payload: done ? { seq_total: seq } : { content },
    });
  }
}

export default MessageRouter;
