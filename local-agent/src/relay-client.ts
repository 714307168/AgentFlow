import WebSocket from "ws";
import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { ClientType, Envelope, Events } from "./types";
import E2ECrypto, { EncryptedPayload } from "./crypto";
import { buildRelayApiHeaders } from "./api-version";
import appLogger from "./app-logger";
import {
  decideRelayHealthCheckRecovery,
  type RelaySocketState,
} from "./relay-connection-recovery";

interface RelayClientOptions {
  clientType?: ClientType;
  deviceId?: string;
  resolveTargetAgentId?: (env: Envelope) => string | null;
}

interface RelayEncryptedEnvelopePayload extends EncryptedPayload {
  sender_id?: string;
  key_id?: string;
}

interface QueuedOutgoingEnvelope {
  env: Envelope;
  queuedAt: number;
}

const RECENT_CONNECTION_EVENT_LIMIT = 24;

export type RelayConnectionState =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "reconnecting";

export type RelayConnectionEventType =
  | "connect-attempt"
  | "socket-open"
  | "auth-sent"
  | "authenticated"
  | "auth-error"
  | "health-check-reconnect"
  | "socket-close"
  | "socket-error"
  | "reconnect-scheduled"
  | "manual-disconnect";

export interface RelayConnectionEvent {
  at: number;
  type: RelayConnectionEventType;
  state: RelayConnectionState;
  detail: string | null;
  closeCode: number | null;
  closeReason: string | null;
  reconnectDelayMs: number | null;
  reconnectAttemptCount: number | null;
}

export interface RelayConnectionSnapshot {
  state: RelayConnectionState;
  isConnected: boolean;
  isAuthenticated: boolean;
  lastInboundAt: number;
  lastSocketOpenAttemptAt: number;
  lastConnectedAt: number;
  lastAuthenticatedAt: number;
  lastDisconnectedAt: number;
  lastErrorAt: number;
  lastErrorMessage: string;
  lastCloseCode: number;
  lastCloseReason: string;
  lastStateChangedAt: number;
  reconnectDelayMs: number;
  reconnectAttemptCount: number;
  consecutiveFailureCount: number;
  pendingQueueSize: number;
  recentEvents: RelayConnectionEvent[];
}

class RelayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectDelay: number = 1000;
  private maxDelay: number = 30000;
  private lastSeq: number = 0;
  private lastInboundAt: number = 0;
  private lastSocketOpenAttemptAt: number = 0;
  private lastConnectedAt: number = 0;
  private lastAuthenticatedAt: number = 0;
  private lastDisconnectedAt: number = 0;
  private lastErrorAt: number = 0;
  private lastErrorMessage: string = "";
  private lastCloseCode: number = 0;
  private lastCloseReason: string = "";
  private pingTimer: NodeJS.Timeout | null = null;
  private clientType: ClientType;
  private agentId: string;
  private deviceId: string;
  private token: string;
  private serverUrl: string;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private intentionalDisconnect: boolean = false;
  private isAuthenticated: boolean = false;
  private e2e: E2ECrypto;
  private e2eEnabled: boolean;
  private readonly resolveTargetAgentId?: (env: Envelope) => string | null;
  private readonly pendingRoomKeyOffers: Set<string> = new Set();
  private readonly pendingEncryptedEnvelopes: Map<string, Envelope[]> = new Map();
  private readonly pendingOutgoingEnvelopes: QueuedOutgoingEnvelope[] = [];
  private connectionGeneration = 0;
  private connectionState: RelayConnectionState = "disconnected";
  private lastStateChangedAt = 0;
  private reconnectAttemptCount = 0;
  private consecutiveFailureCount = 0;
  private readonly recentConnectionEvents: RelayConnectionEvent[] = [];

  constructor(
    serverUrl: string,
    agentId: string,
    token: string,
    e2eEnabled: boolean = true,
    options?: RelayClientOptions,
  ) {
    super();
    this.serverUrl = serverUrl;
    this.clientType = options?.clientType ?? "agent";
    this.agentId = agentId;
    this.deviceId = options?.deviceId ?? "";
    this.token = token;
    this.e2eEnabled = e2eEnabled;
    this.e2e = new E2ECrypto();
    this.resolveTargetAgentId = options?.resolveTargetAgentId;
  }

  getE2E(): E2ECrypto {
    return this.e2e;
  }

  isE2EEnabled(): boolean {
    return this.e2eEnabled;
  }

  setE2EEnabled(enabled: boolean): void {
    this.e2eEnabled = enabled;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  updateAuth(serverUrl: string, agentId: string, token: string, deviceId?: string): void {
    this.serverUrl = serverUrl;
    this.agentId = agentId;
    if (typeof deviceId === "string") {
      this.deviceId = deviceId;
    }
    this.token = token;
  }

  resetResumeState(): void {
    this.lastSeq = 0;
  }

  getConnectionSnapshot(): RelayConnectionSnapshot {
    return {
      state: this.connectionState,
      isConnected: this.isConnected(),
      isAuthenticated: this.isAuthenticated,
      lastInboundAt: this.lastInboundAt,
      lastSocketOpenAttemptAt: this.lastSocketOpenAttemptAt,
      lastConnectedAt: this.lastConnectedAt,
      lastAuthenticatedAt: this.lastAuthenticatedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
      lastCloseCode: this.lastCloseCode,
      lastCloseReason: this.lastCloseReason,
      lastStateChangedAt: this.lastStateChangedAt,
      reconnectDelayMs: this.reconnectDelay,
      reconnectAttemptCount: this.reconnectAttemptCount,
      consecutiveFailureCount: this.consecutiveFailureCount,
      pendingQueueSize: this.pendingOutgoingEnvelopes.length,
      recentEvents: this.recentConnectionEvents.slice(),
    };
  }

  ensureHealthyConnection(reason: string = "health-check", staleTimeoutMs: number = 75_000): void {
    if (this.intentionalDisconnect) {
      return;
    }

    const decision = decideRelayHealthCheckRecovery({
      now: Date.now(),
      reason,
      staleTimeoutMs,
      connectionState: this.connectionState,
      socketState: this.getSocketState(),
      isAuthenticated: this.isAuthenticated,
      lastInboundAt: this.lastInboundAt,
      lastSocketOpenAttemptAt: this.lastSocketOpenAttemptAt,
      lastAuthenticatedAt: this.lastAuthenticatedAt,
      reconnectScheduled: this.reconnectTimer !== null,
    });
    if (decision.action === "none") {
      return;
    }
    appLogger.warn("RelayClient", "Recovering relay socket during health check.", {
      action: decision.action,
      reason,
      detail: decision.detail,
    });
    this.recordConnectionEvent("health-check-reconnect", {
      detail: decision.detail,
    });
    this.connect();
  }

  connect(): void {
    this.intentionalDisconnect = false;
    this.isAuthenticated = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connectionGeneration += 1;
    const generation = this.connectionGeneration;
    const previousSocket = this.ws;
    if (previousSocket) {
      this.disposeSocket(previousSocket);
    }
    this.stopPing();
    this.lastSocketOpenAttemptAt = Date.now();
    this.setConnectionState(this.reconnectAttemptCount > 0 ? "reconnecting" : "connecting");
    this.recordConnectionEvent("connect-attempt", {
      detail: "generation=" + String(generation) + "; queued=" + String(this.pendingOutgoingEnvelopes.length),
    });
    const socket = new WebSocket(this.serverUrl, {
      headers: buildRelayApiHeaders(),
    });
    this.ws = socket;
    socket.on("open", () => this.onOpen(generation, socket));
    socket.on("message", (data: WebSocket.RawData) => this.onMessage(generation, socket, data.toString()));
    socket.on("close", (code: number, reason: Buffer) => this.onClose(generation, socket, code, reason));
    socket.on("error", (err: Error) => this.onError(generation, socket, err));
    socket.on("ping", () => this.onSocketActivity(generation, socket));
    socket.on("pong", () => this.onSocketActivity(generation, socket));
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.isAuthenticated = false;
    this.pendingOutgoingEnvelopes.length = 0;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttemptCount = 0;
    this.recordConnectionEvent("manual-disconnect", {
      detail: this.connectionState,
    });
    if (this.ws) {
      this.connectionGeneration += 1;
      const socket = this.ws;
      this.ws = null;
      this.disposeSocket(socket);
    }
    this.setConnectionState("disconnected");
  }

  send(env: Envelope): void {
    if (this.shouldQueueUntilAuthenticated(env)) {
      this.queueOutgoingEnvelope(env);
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.queueOutgoingEnvelope(env);
      return;
    }

    const outgoing = this.prepareOutgoingEnvelope(env);
    if (!outgoing) {
      return;
    }
    try {
      this.ws.send(JSON.stringify(outgoing));
    } catch (error) {
      appLogger.warn("RelayClient", "Failed to send envelope; queueing for retry.", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.queueOutgoingEnvelope(env);
    }
  }

  private onOpen(generation: number, socket: WebSocket): void {
    if (!this.isCurrentSocket(generation, socket)) {
      socket.terminate();
      return;
    }
    appLogger.info("RelayClient", "Connected to relay server", { generation });
    this.lastInboundAt = Date.now();
    this.lastConnectedAt = this.lastInboundAt;
    this.resetBackoff();
    this.setConnectionState("authenticating");
    this.recordConnectionEvent("socket-open", {
      detail: "generation=" + String(generation),
    });
    const event = this.lastSeq > 0 ? Events.AUTH_RESUME : Events.AUTH_LOGIN;
    const payload: Record<string, unknown> = {
      token: this.token,
      type: this.clientType,
    };
    if (this.clientType === "agent") {
      payload.agent_id = this.agentId;
    } else if (this.deviceId) {
      payload.device_id = this.deviceId;
    }
    if (event === Events.AUTH_RESUME) {
      payload.last_seq = this.lastSeq;
    }
    const env: Envelope = {
      id: uuidv4(),
      event,
      ts: Date.now(),
      payload,
    };
    this.recordConnectionEvent("auth-sent", {
      detail: event === Events.AUTH_RESUME ? "resume lastSeq=" + String(this.lastSeq) : "login",
    });
    this.send(env);
    this.startPing(generation, socket);
    this.emit("connected");
  }

  private onMessage(generation: number, socket: WebSocket, data: string): void {
    if (!this.isCurrentSocket(generation, socket)) {
      return;
    }
    try {
      this.lastInboundAt = Date.now();
      const env: Envelope = JSON.parse(data);
      if (env.seq !== undefined && env.seq > this.lastSeq) {
        this.lastSeq = env.seq;
      }
      if (env.event === Events.AUTH_ERROR) {
        this.isAuthenticated = false;
        this.stopPing();
        const authErrorMessage = this.extractPayloadMessage(env.payload);
        if (authErrorMessage) {
          this.lastErrorAt = Date.now();
          this.lastErrorMessage = authErrorMessage;
        }
        this.recordConnectionEvent("auth-error", {
          detail: authErrorMessage || "auth.error",
        });
        this.emit("auth-failed", env);
        return;
      }
      if (env.event === Events.PING) {
        this.send({ id: uuidv4(), event: Events.PONG, ts: Date.now() });
        return;
      }
      if (env.event === Events.AUTH_OK && this.clientType === "device") {
        this.isAuthenticated = true;
        this.lastAuthenticatedAt = Date.now();
        this.consecutiveFailureCount = 0;
        this.reconnectAttemptCount = 0;
        this.setConnectionState("connected");
        this.recordConnectionEvent("authenticated", {
          detail: "device",
        });
        const payload = env.payload as { agent_id?: string } | undefined;
        const agentId = payload?.agent_id?.trim();
        if (agentId) {
          this.ensureRoomKey(agentId);
        }
        this.flushPendingOutgoingEnvelopes();
        this.emit("authenticated", env);
      } else if (env.event === Events.AUTH_OK) {
        this.isAuthenticated = true;
        this.lastAuthenticatedAt = Date.now();
        this.consecutiveFailureCount = 0;
        this.reconnectAttemptCount = 0;
        this.setConnectionState("connected");
        this.recordConnectionEvent("authenticated", {
          detail: "agent",
        });
        this.flushPendingOutgoingEnvelopes();
        this.emit("authenticated", env);
      }
      // Handle E2E key exchange
      if (env.event === Events.E2E_OFFER) {
        const payload = env.payload as { public_key?: string; device_id?: string; agent_id?: string } | undefined;
        const deviceId = payload?.device_id?.trim();
        if (payload?.public_key && deviceId) {
          this.e2e.deriveSharedSecret(deviceId, payload.public_key);
          const roomKey = this.e2e.getOrCreateRoomKey(this.agentId);
          const encryptedRoomKey = this.e2e.encrypt(deviceId, JSON.stringify({
            room_key: roomKey,
            agent_id: this.agentId,
          }));
          if (!encryptedRoomKey) {
            return;
          }
          this.send({
            id: uuidv4(),
            event: Events.E2E_ANSWER,
            project_id: env.project_id,
            ts: Date.now(),
            payload: {
              public_key: this.e2e.getPublicKey(),
              agent_id: this.agentId,
              device_id: deviceId,
              ciphertext: encryptedRoomKey.ciphertext,
              nonce: encryptedRoomKey.nonce,
              encrypted: true,
            },
          });
        }
        return;
      }
      if (env.event === Events.E2E_ANSWER) {
        const payload = env.payload as {
          public_key?: string;
          device_id?: string;
          agent_id?: string;
          ciphertext?: string;
          nonce?: string;
          encrypted?: boolean;
        } | undefined;
        const agentId = payload?.agent_id?.trim();
        if (payload?.public_key && agentId) {
          this.e2e.deriveSharedSecret(agentId, payload.public_key);
        }
        if (agentId && payload?.encrypted && payload.ciphertext && payload.nonce) {
          const decrypted = this.e2e.decrypt(agentId, {
            encrypted: true,
            ciphertext: payload.ciphertext,
            nonce: payload.nonce,
          });
          if (decrypted) {
            const roomPayload = JSON.parse(decrypted) as { room_key?: string; agent_id?: string };
            const roomAgentId = roomPayload.agent_id?.trim() || agentId;
            const roomKey = roomPayload.room_key?.trim();
            if (roomAgentId && roomKey) {
              this.e2e.setRoomKey(roomAgentId, roomKey);
              this.pendingRoomKeyOffers.delete(roomAgentId);
              this.flushPendingEncryptedEnvelopes(roomAgentId);
            }
          }
        }
        return;
      }
      // Decrypt E2E payload if needed
      if (this.e2eEnabled && env.payload && (env.payload as any)?.encrypted) {
        const encryptedPayload = env.payload as RelayEncryptedEnvelopePayload;
        const keyId = typeof encryptedPayload.key_id === "string" ? encryptedPayload.key_id.trim() : "";
        let decrypted: string | null = null;
        if (keyId.startsWith("agent:")) {
          const roomId = keyId.slice("agent:".length).trim();
          if (roomId) {
            decrypted = this.e2e.decryptWithRoomKey(roomId, encryptedPayload);
          }
        }
        if (!decrypted) {
          const senderId = typeof encryptedPayload.sender_id === "string" ? encryptedPayload.sender_id.trim() : "";
          if (senderId && this.e2e.hasKey(senderId)) {
            decrypted = this.e2e.decrypt(senderId, encryptedPayload);
          }
        }
        if (decrypted) {
          env.payload = JSON.parse(decrypted);
        }
      }
      if (env.event === Events.PROJECT_LISTED && this.clientType === "device") {
        const payload = env.payload as { agent_id?: string } | undefined;
        const agentId = payload?.agent_id?.trim();
        if (agentId) {
          this.ensureRoomKey(agentId);
        }
      }
      this.emit("message", env);
    } catch (err) {
      console.error("[RelayClient] Failed to parse message:", err);
    }
  }

  private onClose(generation: number, socket: WebSocket, code: number, reason: Buffer): void {
    if (!this.isCurrentSocket(generation, socket)) {
      return;
    }
    appLogger.info("RelayClient", "Connection closed", {
      code,
      reason: this.normalizeCloseReason(reason),
    });
    this.isAuthenticated = false;
    this.stopPing();
    this.ws = null;
    this.lastDisconnectedAt = Date.now();
    this.lastCloseCode = Number.isFinite(code) ? code : 0;
    this.lastCloseReason = this.normalizeCloseReason(reason);
    this.recordConnectionEvent("socket-close", {
      closeCode: this.lastCloseCode || null,
      closeReason: this.lastCloseReason || null,
      detail: "wasAuthenticated=" + String(this.lastAuthenticatedAt > this.lastSocketOpenAttemptAt),
    });
    this.consecutiveFailureCount += this.intentionalDisconnect ? 0 : 1;
    this.setConnectionState("disconnected");
    this.emit("disconnected");
    if (!this.intentionalDisconnect) {
      this.scheduleReconnect();
    }
  }

  private onError(generation: number, socket: WebSocket, err: Error): void {
    if (!this.isCurrentSocket(generation, socket)) {
      return;
    }
    console.error("[RelayClient] WebSocket error:", err.message);
    this.isAuthenticated = false;
    this.stopPing();
    this.lastErrorAt = Date.now();
    this.lastErrorMessage = err.message;
    this.recordConnectionEvent("socket-error", {
      detail: err.message,
    });
    this.emit("error", err);
  }

  private onSocketActivity(generation: number, socket: WebSocket): void {
    if (!this.isCurrentSocket(generation, socket)) {
      return;
    }
    this.lastInboundAt = Date.now();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttemptCount += 1;
    this.setConnectionState("reconnecting");
    this.recordConnectionEvent("reconnect-scheduled", {
      reconnectDelayMs: this.reconnectDelay,
      reconnectAttemptCount: this.reconnectAttemptCount,
      detail: "delay=" + String(this.reconnectDelay),
    });
    appLogger.info("RelayClient", "Reconnect scheduled", {
      delayMs: this.reconnectDelay,
      attempt: this.reconnectAttemptCount,
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
  }

  private resetBackoff(): void {
    this.reconnectDelay = 1000;
  }

  private setConnectionState(nextState: RelayConnectionState): void {
    if (this.connectionState === nextState) {
      return;
    }
    this.connectionState = nextState;
    this.lastStateChangedAt = Date.now();
    this.emit("connection-state-changed", this.getConnectionSnapshot());
  }

  private recordConnectionEvent(
    type: RelayConnectionEventType,
    options: {
      detail?: string | null;
      closeCode?: number | null;
      closeReason?: string | null;
      reconnectDelayMs?: number | null;
      reconnectAttemptCount?: number | null;
    } = {},
  ): void {
    this.recentConnectionEvents.push({
      at: Date.now(),
      type,
      state: this.connectionState,
      detail: options.detail?.trim() || null,
      closeCode: Number.isFinite(options.closeCode) ? Number(options.closeCode) : null,
      closeReason: options.closeReason?.trim() || null,
      reconnectDelayMs: Number.isFinite(options.reconnectDelayMs) ? Number(options.reconnectDelayMs) : null,
      reconnectAttemptCount: Number.isFinite(options.reconnectAttemptCount) ? Number(options.reconnectAttemptCount) : null,
    });
    if (this.recentConnectionEvents.length > RECENT_CONNECTION_EVENT_LIMIT) {
      this.recentConnectionEvents.splice(0, this.recentConnectionEvents.length - RECENT_CONNECTION_EVENT_LIMIT);
    }
  }

  private normalizeCloseReason(reason: Buffer): string {
    return reason.toString("utf8").replace(/\0/g, "").trim();
  }

  private extractPayloadMessage(payload: unknown): string {
    if (!payload || typeof payload !== "object") {
      return "";
    }
    const record = payload as Record<string, unknown>;
    return typeof record.message === "string" ? record.message.trim() : "";
  }

  private startPing(generation: number, socket: WebSocket): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.isCurrentSocket(generation, socket) || socket.readyState !== WebSocket.OPEN) {
        this.stopPing();
        return;
      }
      this.send({
        id: uuidv4(),
        event: Events.PING,
        ts: Date.now(),
      });
    }, 30_000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private isAuthEvent(event: string): boolean {
    return event === Events.AUTH_LOGIN || event === Events.AUTH_RESUME;
  }

  private shouldQueueUntilAuthenticated(env: Envelope): boolean {
    if (this.isAuthEvent(env.event)) {
      return !this.ws || this.ws.readyState !== WebSocket.OPEN;
    }
    return !this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isAuthenticated;
  }

  private queueOutgoingEnvelope(env: Envelope): void {
    if (this.isAuthEvent(env.event) && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    const now = Date.now();
    for (let index = this.pendingOutgoingEnvelopes.length - 1; index >= 0; index -= 1) {
      if (now - this.pendingOutgoingEnvelopes[index].queuedAt > 90_000) {
        this.pendingOutgoingEnvelopes.splice(index, 1);
      }
    }

    const duplicateIndex = this.pendingOutgoingEnvelopes.findIndex((queued) =>
      queued.env.id === env.id
      && queued.env.event === env.event
      && queued.env.project_id === env.project_id
      && queued.env.stream_id === env.stream_id,
    );
    const next = { env, queuedAt: now };
    if (duplicateIndex >= 0) {
      this.pendingOutgoingEnvelopes[duplicateIndex] = next;
    } else {
      if (this.pendingOutgoingEnvelopes.length >= 160) {
        this.pendingOutgoingEnvelopes.shift();
      }
      this.pendingOutgoingEnvelopes.push(next);
    }

    if (!this.intentionalDisconnect && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
      this.connect();
    }
  }

  private flushPendingOutgoingEnvelopes(): void {
    const now = Date.now();
    const queued = this.pendingOutgoingEnvelopes
      .filter((entry) => now - entry.queuedAt <= 90_000)
      .map((entry) => entry.env);
    this.pendingOutgoingEnvelopes.length = 0;
    for (const env of queued) {
      this.send(env);
    }
  }

  private prepareOutgoingEnvelope(env: Envelope): Envelope | null {
    if (!this.e2eEnabled || !env.payload || !this.shouldEncryptEvent(env)) {
      return env;
    }

    if (this.clientType === "agent") {
      const encrypted = this.e2e.encryptWithRoomKey(this.agentId, JSON.stringify(env.payload));
      if (!encrypted) {
        return env;
      }
      return {
        ...env,
        payload: {
          ...encrypted,
          sender_id: this.agentId,
          key_id: `agent:${this.agentId}`,
        },
      };
    }

    const targetAgentId = this.getTargetAgentId(env);
    if (!targetAgentId) {
      return env;
    }

    if (!this.e2e.hasRoomKey(targetAgentId)) {
      this.ensureRoomKey(targetAgentId);
      this.queuePendingEncryptedEnvelope(targetAgentId, env);
      return null;
    }

    const encrypted = this.e2e.encryptWithRoomKey(targetAgentId, JSON.stringify(env.payload));
    if (!encrypted) {
      return env;
    }
    return {
      ...env,
      payload: {
        ...encrypted,
        sender_id: this.deviceId,
        key_id: `agent:${targetAgentId}`,
      },
    };
  }

  private shouldEncryptEvent(env: Envelope): boolean {
    if (!env.payload) {
      return false;
    }
    const bypassEvents = new Set<string>([
      Events.AUTH_LOGIN,
      Events.AUTH_RESUME,
      Events.AUTH_REFRESH,
      Events.AUTH_OK,
      Events.AUTH_ERROR,
      Events.PING,
      Events.PONG,
      Events.PROJECT_BIND,
      Events.PROJECT_BOUND,
      Events.PROJECT_LIST,
      Events.PROJECT_LIST_REQUEST,
      Events.PROJECT_LISTED,
      Events.AGENT_STATUS,
      Events.E2E_OFFER,
      Events.E2E_ANSWER,
      Events.ERROR,
    ]);
    return !bypassEvents.has(env.event);
  }

  private getTargetAgentId(env: Envelope): string | null {
    const resolvedByCallback = this.resolveTargetAgentId?.(env)?.trim();
    if (resolvedByCallback) {
      return resolvedByCallback;
    }
    const envelopeAgentId = typeof env.agent_id === "string" ? env.agent_id.trim() : "";
    if (envelopeAgentId) {
      return envelopeAgentId;
    }
    const payload = env.payload as Record<string, unknown> | null;
    const payloadAgentId = typeof payload?.agent_id === "string" ? payload.agent_id.trim() : "";
    if (payloadAgentId) {
      return payloadAgentId;
    }
    return null;
  }

  private ensureRoomKey(agentId: string): void {
    const normalizedAgentId = agentId.trim();
    if (
      !this.e2eEnabled
      || this.clientType !== "device"
      || !normalizedAgentId
      || !this.deviceId
      || this.pendingRoomKeyOffers.has(normalizedAgentId)
      || this.e2e.hasRoomKey(normalizedAgentId)
    ) {
      return;
    }

    this.pendingRoomKeyOffers.add(normalizedAgentId);
    this.send({
      id: uuidv4(),
      event: Events.E2E_OFFER,
      ts: Date.now(),
      payload: {
        public_key: this.e2e.getPublicKey(),
        agent_id: normalizedAgentId,
        device_id: this.deviceId,
      },
    });
  }

  private queuePendingEncryptedEnvelope(agentId: string, env: Envelope): void {
    const queue = this.pendingEncryptedEnvelopes.get(agentId) ?? [];
    queue.push(env);
    this.pendingEncryptedEnvelopes.set(agentId, queue);
  }

  private flushPendingEncryptedEnvelopes(agentId: string): void {
    const queue = this.pendingEncryptedEnvelopes.get(agentId);
    if (!queue?.length) {
      this.pendingEncryptedEnvelopes.delete(agentId);
      return;
    }
    this.pendingEncryptedEnvelopes.delete(agentId);
    for (const env of queue) {
      this.send(env);
    }
  }

  private isCurrentSocket(generation: number, socket: WebSocket): boolean {
    return this.connectionGeneration === generation && this.ws === socket;
  }

  private getSocketState(): RelaySocketState {
    if (!this.ws) {
      return "missing";
    }
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return "connecting";
      case WebSocket.OPEN:
        return "open";
      case WebSocket.CLOSING:
        return "closing";
      case WebSocket.CLOSED:
      default:
        return "closed";
    }
  }

  private disposeSocket(socket: WebSocket): void {
    // Keep a temporary error listener while shutting down a connecting socket.
    // Otherwise the ws library can emit an unhandled error such as
    // "WebSocket was closed before the connection was established".
    const swallowSocketError = (_error: Error): void => {
      void _error;
    };
    socket.once("error", swallowSocketError);

    try {
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.terminate();
        return;
      }
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) {
        socket.close();
      }
    } catch {
      // Ignore shutdown errors for stale sockets during reconnect/disconnect.
    }
  }
}

export default RelayClient;
