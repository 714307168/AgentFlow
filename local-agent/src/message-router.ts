import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import RelayClient from "./relay-client";
import projectStore from "./project-store";
import RuntimeManager, { CliProvider, RunAttachment } from "./runtime-manager";
import type { SessionSyncKnownItemDigest } from "./session-sync-hash";
import { buildSessionSyncPayload } from "./session-sync-payload";
import { SessionSyncActions } from "./session-sync-actions";
import { Envelope, Events } from "./types";
import { createRunAttachmentFromPath, getUniqueAttachmentPath } from "./attachment-utils";

interface MessageRouterOptions {
  revealProjectWindow?: (projectId: string, projectName: string) => void;
  revealWakeupWindow?: () => void;
  runtimeManager?: RuntimeManager;
  getDefaultCliProvider?: () => CliProvider;
  syncProjectCatalog?: () => void;
  onProjectsChanged?: () => void;
  getWorkgroupRelayPayload?: () => { agent_id: string; workgroups: unknown[] } | null;
  dispatchWorkgroupTask?: (taskId: string) => Promise<{ success: boolean; error?: string; workgroup?: unknown }>;
  updateWorkgroupTaskStatus?: (data: {
    taskId: string;
    status: "todo" | "assigned" | "running" | "blocked" | "done" | "error";
    lastDispatchResult?: string | null;
  }) => { success: boolean; error?: string; workgroup?: unknown };
  getWorkgroupCollaborationRelayPayload?: () => { agent_id: string; workgroups: unknown[] } | null;
  getWorkgroupCollaborationSessionPayload?: (data: {
    workgroupId: string;
    beforeId?: string | null;
    limit?: number;
    knownItems?: SessionSyncKnownItemDigest[];
  }) => {
    agent_id: string;
    workgroup_id: string;
    session: unknown;
    page: unknown;
  } | null;
  sendWorkgroupCollaborationMessage?: (data: {
    workgroupId: string;
    content: string;
  }) => Promise<{ success: boolean; error?: string; session?: unknown }>;
}

class MessageRouter {
  private static readonly DOWNLOAD_REQUEST_KIND = "download_request";
  private static readonly DOWNLOAD_TRANSFER_KIND = "download";
  private static readonly DOWNLOAD_CHUNK_SIZE = 64 * 1024;
  private relayClient: RelayClient;
  private streamSeq: Map<string, number> = new Map();
  private fileBuffers: Map<string, {
    fileName: string;
    projectId: string;
    mimeType?: string;
    chunks: Map<number, Buffer>;
  }> = new Map();
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
      case Events.WORKGROUP_LIST_REQUEST:
        this.handleWorkgroupListRequest();
        break;
      case Events.WORKGROUP_COMMAND:
        void this.handleWorkgroupCommand(env);
        break;
      case Events.WORKGROUP_COLLABORATION_LIST_REQUEST:
        this.handleWorkgroupCollaborationListRequest();
        break;
      case Events.WORKGROUP_COLLABORATION_SESSION_REQUEST:
        this.handleWorkgroupCollaborationSessionRequest(env);
        break;
      case Events.WORKGROUP_COLLABORATION_MESSAGE_SEND:
        void this.handleWorkgroupCollaborationMessageSend(env);
        break;
      case Events.TASK_STOP:
        this.handleTaskStop(env);
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
      case Events.FILE_SYNC:
        this.handleFileSync(env);
        break;
      case Events.AUTH_OK:
        console.log("[MessageRouter] Auth OK");
        break;
      case Events.AUTH_ERROR:
        console.error("[MessageRouter] Auth error:", env.payload);
        break;
      case Events.ERROR:
        this.handleRelayError(env);
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
    const payload = env.payload as { content?: string; attachments?: unknown[] } | undefined;
    const content = payload?.content ?? "";
    const attachments = this.normalizeIncomingAttachments(payload?.attachments);
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
      attachments,
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
      group_name?: string | null;
      cli_provider?: CliProvider;
      cli_model?: string | null;
      project_prompt?: string | null;
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
        groupName: payload.group_name?.trim() || (existing.groupName ?? null),
        cliProvider,
        cliModel: payload.cli_model?.trim() ? payload.cli_model.trim() : existing.cliModel ?? null,
        projectPrompt: payload.project_prompt?.trim() ? payload.project_prompt.trim() : existing.projectPrompt ?? null,
      });
    } else {
      projectStore.add({
        id: projectId,
        name: payload.name,
        path: payload.path,
        agentId: payload.agent_id ?? "",
        groupName: payload.group_name?.trim() || null,
        cliProvider,
        cliModel: payload.cli_model?.trim() ? payload.cli_model.trim() : null,
        projectPrompt: payload.project_prompt?.trim() ? payload.project_prompt.trim() : null,
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

  private handleWorkgroupListRequest(): void {
    const payload = this.options.getWorkgroupRelayPayload?.();
    if (!payload) {
      return;
    }
    this.relayClient.send({
      id: uuidv4(),
      event: Events.WORKGROUP_LIST,
      agent_id: payload.agent_id,
      ts: Date.now(),
      payload,
    });
  }

  private async handleWorkgroupCommand(env: Envelope): Promise<void> {
    const payload = env.payload as {
      action?: string;
      task_id?: string;
      status?: "todo" | "assigned" | "running" | "blocked" | "done" | "error";
    } | undefined;
    const action = String(payload?.action ?? "").trim().toLowerCase();
    const taskId = String(payload?.task_id ?? "").trim();

    let result: { success: boolean; error?: string; workgroup?: unknown };
    if (!taskId) {
      result = { success: false, error: "Task id is required" };
    } else if (action === "dispatch_task") {
      if (!this.options.dispatchWorkgroupTask) {
        result = { success: false, error: "Workgroup dispatch is unavailable" };
      } else {
        result = await this.options.dispatchWorkgroupTask(taskId);
      }
    } else if (action === "update_status") {
      if (!this.options.updateWorkgroupTaskStatus) {
        result = { success: false, error: "Workgroup status updates are unavailable" };
      } else if (!payload?.status) {
        result = { success: false, error: "Task status is required" };
      } else {
        result = this.options.updateWorkgroupTaskStatus({
          taskId,
          status: payload.status,
        });
      }
    } else {
      result = { success: false, error: `Unsupported workgroup action: ${action || "unknown"}` };
    }

    const nextPayload = this.options.getWorkgroupRelayPayload?.();
    this.relayClient.send({
      id: uuidv4(),
      event: Events.WORKGROUP_COMMAND_RESULT,
      agent_id: nextPayload?.agent_id ?? "",
      ts: Date.now(),
      payload: {
        request_id: env.id,
        agent_id: nextPayload?.agent_id ?? "",
        success: result.success,
        error: result.error,
        workgroups: nextPayload?.workgroups ?? [],
      },
    });
  }

  private handleWorkgroupCollaborationListRequest(): void {
    const payload = this.options.getWorkgroupCollaborationRelayPayload?.();
    if (!payload) {
      return;
    }
    this.relayClient.send({
      id: uuidv4(),
      event: Events.WORKGROUP_COLLABORATION_LIST,
      agent_id: payload.agent_id,
      ts: Date.now(),
      payload,
    });
  }

  private handleWorkgroupCollaborationSessionRequest(env: Envelope): void {
    const payload = env.payload as {
      workgroup_id?: string;
      before_id?: string;
      limit?: number;
      known_items?: Array<{
        id?: string;
        content_md5?: string;
      }>;
    } | undefined;
    const workgroupId = String(payload?.workgroup_id ?? "").trim();
    if (!workgroupId) {
      return;
    }

    const sessionPayload = this.options.getWorkgroupCollaborationSessionPayload?.({
      workgroupId,
      beforeId: typeof payload?.before_id === "string" ? payload.before_id : null,
      limit: typeof payload?.limit === "number" ? payload.limit : undefined,
      knownItems: Array.isArray(payload?.known_items)
        ? payload.known_items
            .map((item) => ({
              id: String(item?.id ?? "").trim(),
              content_md5: typeof item?.content_md5 === "string" ? item.content_md5.trim() : undefined,
            }))
            .filter((item) => Boolean(item.id))
        : [],
    });
    if (!sessionPayload) {
      return;
    }

    this.relayClient.send({
      id: uuidv4(),
      event: Events.WORKGROUP_COLLABORATION_SESSION,
      agent_id: sessionPayload.agent_id,
      workgroup_id: workgroupId,
      ts: Date.now(),
      payload: {
        request_id: env.id,
        before_id: typeof payload?.before_id === "string" ? payload.before_id : "",
        ...sessionPayload,
      },
    });
  }

  private async handleWorkgroupCollaborationMessageSend(env: Envelope): Promise<void> {
    const payload = env.payload as {
      workgroup_id?: string;
      content?: string;
    } | undefined;
    const workgroupId = String(payload?.workgroup_id ?? "").trim();
    const content = typeof payload?.content === "string" ? payload.content : "";

    let result: { success: boolean; error?: string; session?: unknown };
    if (!workgroupId) {
      result = { success: false, error: "Workgroup id is required" };
    } else if (!this.options.sendWorkgroupCollaborationMessage) {
      result = { success: false, error: "Workgroup collaboration messaging is unavailable" };
    } else {
      result = await this.options.sendWorkgroupCollaborationMessage({
        workgroupId,
        content,
      });
    }

    const relayPayload = this.options.getWorkgroupCollaborationRelayPayload?.();
    this.relayClient.send({
      id: uuidv4(),
      event: Events.WORKGROUP_COLLABORATION_MESSAGE_RESULT,
      agent_id: relayPayload?.agent_id ?? "",
      workgroup_id: workgroupId,
      ts: Date.now(),
      payload: {
        request_id: env.id,
        agent_id: relayPayload?.agent_id ?? "",
        workgroup_id: workgroupId,
        success: result.success,
        error: result.error,
        session: result.session ?? null,
      },
    });
  }

  private handleSessionSyncRequest(env: Envelope): void {
    const projectId = env.project_id;
    if (!projectId || !this.options.runtimeManager) {
      return;
    }

    const payloadObject = env.payload as {
      after_seq?: number;
      before_seq?: number;
      limit?: number;
      action?: string;
      conversation_id?: string;
      item_id?: string;
      run_id?: string;
      project_updates?: {
        group_name?: string | null;
        cli_provider?: CliProvider;
        cli_model?: string | null;
        project_prompt?: string | null;
      };
      known_items?: Array<{
        id?: string;
        content_md5?: string;
        attachments_md5?: string;
      }>;
    } | undefined;
    const action = typeof payloadObject?.action === "string" ? payloadObject.action.trim().toLowerCase() : "";
    const requestedConversationId = typeof payloadObject?.conversation_id === "string"
      ? payloadObject.conversation_id.trim()
      : "";
    const requestedItemId = typeof payloadObject?.item_id === "string"
      ? payloadObject.item_id.trim()
      : "";
    const requestedRunId = typeof payloadObject?.run_id === "string"
      ? payloadObject.run_id.trim()
      : "";
    if (action === SessionSyncActions.NEW_CONVERSATION) {
      this.options.runtimeManager.createConversation(projectId);
    } else if (action === SessionSyncActions.SWITCH_CONVERSATION && requestedConversationId) {
      this.options.runtimeManager.activateConversation(projectId, requestedConversationId);
    } else if (action === SessionSyncActions.REMOVE_QUEUE && requestedRunId) {
      this.options.runtimeManager.removeQueuedRun(projectId, requestedRunId);
    } else if (action === SessionSyncActions.UPDATE_PROJECT_CONFIG) {
      const existing = projectStore.getById(projectId);
      if (existing) {
        const fallbackProvider = existing.cliProvider ?? (this.options.getDefaultCliProvider?.() ?? "claude");
        projectStore.update(projectId, {
          groupName: payloadObject?.project_updates?.group_name?.trim() || null,
          cliProvider: this.normalizeCliProvider(payloadObject?.project_updates?.cli_provider, fallbackProvider),
          cliModel: payloadObject?.project_updates?.cli_model?.trim()
            ? payloadObject.project_updates.cli_model.trim()
            : null,
          projectPrompt: payloadObject?.project_updates?.project_prompt?.trim()
            ? payloadObject.project_updates.project_prompt.trim()
            : null,
        });
        this.options.syncProjectCatalog?.();
        this.options.onProjectsChanged?.();
      }
    }

    const snapshot = this.options.runtimeManager.getSnapshot(projectId);
    const afterSeq = Number(payloadObject?.after_seq) > 0 ? Number(payloadObject?.after_seq) : 0;
    const beforeSeq = Number(payloadObject?.before_seq) > 0 ? Number(payloadObject?.before_seq) : 0;
    const limit = Number(payloadObject?.limit) > 0 ? Number(payloadObject?.limit) : undefined;
    const delta = this.options.runtimeManager.buildSyncDelta(projectId, {
      afterSeq,
      beforeSeq,
      limit,
      itemId: requestedItemId || undefined,
    });
    const payload = buildSessionSyncPayload(snapshot, delta, {
      afterSeq,
      beforeSeq,
      limit,
      fullItemId: action === SessionSyncActions.FETCH_ITEM_DETAIL ? requestedItemId : undefined,
      knownItems: Array.isArray(payloadObject?.known_items)
        ? payloadObject.known_items
            .map((item) => ({
              id: String(item?.id ?? "").trim(),
              content_md5: typeof item?.content_md5 === "string" ? item.content_md5.trim() : undefined,
              attachments_md5: typeof item?.attachments_md5 === "string" ? item.attachments_md5.trim() : undefined,
            }))
            .filter((item) => Boolean(item.id))
        : [],
    });
    this.relayClient.send({
      id: uuidv4(),
      event: Events.SESSION_SYNC,
      project_id: projectId,
      ts: Date.now(),
      payload,
    });
  }

  private handleTaskStop(env: Envelope): void {
    const projectId = env.project_id;
    if (!projectId || !this.options.runtimeManager) {
      return;
    }
    const stopped = this.options.runtimeManager.stopCurrentRun(projectId);
    console.log(`[MessageRouter] task.stop for project ${projectId}: stopped=${stopped}`);
  }

  private handleAgentWakeup(env: Envelope): void {
    console.log("[MessageRouter] Agent wakeup received", env.payload);
    this.options.revealWakeupWindow?.();
  }

  private handleRelayError(env: Envelope): void {
    const payload = env.payload as Record<string, unknown> | undefined;
    const code = typeof payload?.code === "string" ? payload.code.trim() : "";
    const message = typeof payload?.message === "string" ? payload.message.trim() : "";
    const refId = typeof payload?.ref_id === "string" ? payload.ref_id.trim() : "";
    const projectId = env.project_id?.trim() || (typeof payload?.project_id === "string" ? payload.project_id.trim() : "");
    const streamId = env.stream_id?.trim() || (typeof payload?.stream_id === "string" ? payload.stream_id.trim() : "");
    console.error("[MessageRouter] Relay error:", JSON.stringify({
      code,
      message,
      refId,
      projectId,
      streamId,
    }));
  }

  private handleFileSync(env: Envelope): void {
    const payload = env.payload as Record<string, unknown> | undefined;
    if (!payload) {
      return;
    }
    const kind = typeof payload?.kind === "string" ? payload.kind : "";
    if (kind !== MessageRouter.DOWNLOAD_REQUEST_KIND) {
      console.log("[MessageRouter] Ignoring file.sync payload:", JSON.stringify(payload ?? {}));
      return;
    }

    void this.handleDownloadRequest(env, payload);
  }

  private handleFileUpload(env: Envelope): void {
    const payload = env.payload as any;
    const fileId = env.id;
    const fileName = payload?.file_name;
    const projectId = env.project_id;

    if (!fileId || !fileName || !projectId) {
      console.error("[MessageRouter] file.upload missing required fields");
      return;
    }

    console.log(`[MessageRouter] File upload started: ${fileName} (${fileId})`);
    this.fileBuffers.set(fileId, {
      fileName: String(fileName),
      projectId,
      mimeType: typeof payload?.mime_type === "string" ? payload.mime_type : undefined,
      chunks: new Map(),
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
      const filePath = getUniqueAttachmentPath(buffer.projectId, buffer.fileName);
      fs.writeFileSync(filePath, completeFile);
      const attachment = createRunAttachmentFromPath(filePath, {
        name: buffer.fileName,
        mimeType: buffer.mimeType,
      });

      console.log(`[MessageRouter] File saved: ${attachment.path}`);

      // Send confirmation back
      this.relayClient.send({
        id: uuidv4(),
        event: Events.FILE_DONE,
        project_id: env.project_id,
        stream_id: fileId,
        ts: Date.now(),
        payload: {
          file_id: fileId,
          file_name: attachment.name,
          file_path: attachment.path,
          file_size: attachment.size,
          mime_type: attachment.mimeType,
          kind: attachment.kind,
          preview_data_url: attachment.previewDataUrl,
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

  private async handleDownloadRequest(
    env: Envelope,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const projectId = env.project_id;
    const transferId = typeof payload.transfer_id === "string" ? payload.transfer_id.trim() : "";
    const attachmentId = typeof payload.attachment_id === "string" ? payload.attachment_id.trim() : "";
    const messageId = typeof payload.message_id === "string" ? payload.message_id.trim() : "";
    const requestedPath = typeof payload.file_path === "string" ? payload.file_path.trim() : "";
    const requestedName = typeof payload.file_name === "string" ? payload.file_name.trim() : "";
    const requestedMimeType = typeof payload.mime_type === "string" ? payload.mime_type.trim() : "";

    if (!projectId || !transferId || !requestedPath) {
      console.error("[MessageRouter] download_request missing required fields");
      this.sendDownloadError(projectId ?? "", transferId, "Attachment download request is incomplete.");
      return;
    }

    try {
      const resolvedPath = path.resolve(requestedPath);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Attachment not found: ${resolvedPath}`);
      }

      const stats = fs.statSync(resolvedPath);
      if (!stats.isFile()) {
        throw new Error(`Attachment is not a file: ${resolvedPath}`);
      }

      const fileName = requestedName || path.basename(resolvedPath);
      const mimeType = requestedMimeType || createRunAttachmentFromPath(resolvedPath).mimeType || "application/octet-stream";
      const totalChunks = Math.max(1, Math.ceil(stats.size / MessageRouter.DOWNLOAD_CHUNK_SIZE));

      this.relayClient.send({
        id: uuidv4(),
        event: Events.FILE_UPLOAD,
        project_id: projectId,
        stream_id: transferId,
        ts: Date.now(),
        payload: {
          transfer_kind: MessageRouter.DOWNLOAD_TRANSFER_KIND,
          file_id: transferId,
          file_name: fileName,
          file_size: stats.size,
          mime_type: mimeType,
          total_chunks: totalChunks,
          attachment_id: attachmentId,
          message_id: messageId,
        },
      });

      await new Promise<void>((resolve, reject) => {
        const stream = fs.createReadStream(resolvedPath, {
          highWaterMark: MessageRouter.DOWNLOAD_CHUNK_SIZE,
        });
        let seq = 0;

        stream.on("data", (chunk) => {
          const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          this.relayClient.send({
            id: uuidv4(),
            event: Events.FILE_CHUNK,
            project_id: projectId,
            stream_id: transferId,
            seq,
            ts: Date.now(),
            payload: {
              transfer_kind: MessageRouter.DOWNLOAD_TRANSFER_KIND,
              file_id: transferId,
              chunk: chunkBuffer.toString("base64"),
              seq,
              total: totalChunks,
              attachment_id: attachmentId,
              message_id: messageId,
            },
          });
          seq += 1;
        });

        stream.on("end", () => resolve());
        stream.on("error", (error) => reject(error));
      });

      this.relayClient.send({
        id: uuidv4(),
        event: Events.FILE_DONE,
        project_id: projectId,
        stream_id: transferId,
        ts: Date.now(),
        payload: {
          transfer_kind: MessageRouter.DOWNLOAD_TRANSFER_KIND,
          file_id: transferId,
          file_name: fileName,
          mime_type: mimeType,
          attachment_id: attachmentId,
          message_id: messageId,
        },
      });
    } catch (error) {
      console.error("[MessageRouter] Error handling download request:", error);
      this.sendDownloadError(
        projectId,
        transferId,
        error instanceof Error ? error.message : String(error),
        attachmentId,
        messageId,
      );
    }
  }

  private sendDownloadError(
    projectId: string,
    transferId: string,
    message: string,
    attachmentId = "",
    messageId = "",
  ): void {
    if (!projectId || !transferId) {
      return;
    }

    this.relayClient.send({
      id: uuidv4(),
      event: Events.FILE_ERROR,
      project_id: projectId,
      stream_id: transferId,
      ts: Date.now(),
      payload: {
        transfer_kind: MessageRouter.DOWNLOAD_TRANSFER_KIND,
        error: message,
        attachment_id: attachmentId,
        message_id: messageId,
      },
    });
  }

  private normalizeIncomingAttachments(rawAttachments: unknown): RunAttachment[] {
    if (!Array.isArray(rawAttachments)) {
      return [];
    }

    return rawAttachments
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => {
        const rawPath = typeof item.path === "string" ? item.path.trim() : "";
        if (!rawPath || !fs.existsSync(rawPath) || !fs.statSync(rawPath).isFile()) {
          return null;
        }

        return createRunAttachmentFromPath(rawPath, {
          id: typeof item.id === "string" ? item.id : undefined,
          name: typeof item.name === "string" ? item.name : undefined,
          size: typeof item.size === "number" ? item.size : undefined,
          kind: item.kind === "image" ? "image" : undefined,
          mimeType: typeof item.mimeType === "string"
            ? item.mimeType
            : (typeof item.mime_type === "string" ? item.mime_type : undefined),
        });
      })
      .filter((item): item is RunAttachment => item !== null);
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
