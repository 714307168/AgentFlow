import WebSocket from "ws";
import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { Envelope, Events } from "./types";
import E2ECrypto, { EncryptedPayload } from "./crypto";

class RelayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectDelay: number = 1000;
  private maxDelay: number = 30000;
  private lastSeq: number = 0;
  private agentId: string;
  private token: string;
  private serverUrl: string;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private intentionalDisconnect: boolean = false;
  private e2e: E2ECrypto;
  private e2eEnabled: boolean;

  constructor(serverUrl: string, agentId: string, token: string, e2eEnabled: boolean = false) {
    super();
    this.serverUrl = serverUrl;
    this.agentId = agentId;
    this.token = token;
    this.e2eEnabled = e2eEnabled;
    this.e2e = new E2ECrypto();
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

  connect(): void {
    this.intentionalDisconnect = false;
    this.ws = new WebSocket(this.serverUrl);
    this.ws.on("open", () => this.onOpen());
    this.ws.on("message", (data: WebSocket.RawData) => this.onMessage(data.toString()));
    this.ws.on("close", () => this.onClose());
    this.ws.on("error", (err: Error) => this.onError(err));
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(env: Envelope): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[RelayClient] Cannot send - not connected");
      return;
    }
    this.ws.send(JSON.stringify(env));
  }

  private onOpen(): void {
    console.log("[RelayClient] Connected to relay server");
    this.resetBackoff();
    const event = this.lastSeq > 0 ? Events.AUTH_RESUME : Events.AUTH_LOGIN;
    const payload: Record<string, unknown> = {
      agent_id: this.agentId,
      token: this.token,
      type: "agent",
    };
    if (event === Events.AUTH_RESUME) {
      payload.last_seq = this.lastSeq;
    }
    const env: Envelope = {
      id: uuidv4(),
      event,
      ts: Date.now(),
      payload,
    };
    this.send(env);
    this.emit("connected");
  }

  private onMessage(data: string): void {
    try {
      const env: Envelope = JSON.parse(data);
      if (env.seq !== undefined && env.seq > this.lastSeq) {
        this.lastSeq = env.seq;
      }
      if (env.event === Events.PING) {
        this.send({ id: uuidv4(), event: Events.PONG, ts: Date.now() });
        return;
      }
      // Handle E2E key exchange
      if (env.event === Events.E2E_OFFER) {
        const payload = env.payload as { public_key?: string } | undefined;
        const deviceId = (env.payload as any)?.device_id;
        if (payload?.public_key && deviceId) {
          this.e2e.deriveSharedSecret(deviceId, payload.public_key);
          // Send our public key back
          this.send({
            id: uuidv4(),
            event: Events.E2E_ANSWER,
            project_id: env.project_id,
            ts: Date.now(),
            payload: { public_key: this.e2e.getPublicKey(), agent_id: this.agentId },
          });
        }
        return;
      }
      if (env.event === Events.E2E_ANSWER) {
        const payload = env.payload as { public_key?: string; device_id?: string } | undefined;
        if (payload?.public_key && payload?.device_id) {
          this.e2e.deriveSharedSecret(payload.device_id, payload.public_key);
        }
        return;
      }
      // Decrypt E2E payload if needed
      if (this.e2eEnabled && env.payload && (env.payload as any)?.encrypted) {
        const senderId = (env.payload as any)?.sender_id;
        if (senderId && this.e2e.hasKey(senderId)) {
          const decrypted = this.e2e.decrypt(senderId, env.payload as unknown as EncryptedPayload);
          if (decrypted) {
            env.payload = JSON.parse(decrypted);
          }
        }
      }
      this.emit("message", env);
    } catch (err) {
      console.error("[RelayClient] Failed to parse message:", err);
    }
  }

  private onClose(): void {
    console.log("[RelayClient] Connection closed");
    this.ws = null;
    this.emit("disconnected");
    if (!this.intentionalDisconnect) {
      this.scheduleReconnect();
    }
  }

  private onError(err: Error): void {
    console.error("[RelayClient] WebSocket error:", err.message);
    this.emit("error", err);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    console.log('[RelayClient] Reconnecting in ' + this.reconnectDelay + 'ms...');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
  }

  private resetBackoff(): void {
    this.reconnectDelay = 1000;
  }
}

export default RelayClient;
