export type ClientType = "agent" | "device";

export interface Envelope {
  id: string;
  event: string;
  project_id?: string;
  stream_id?: string;
  seq?: number;
  payload?: unknown;
  ts: number;
}

export interface LoginRequest {
  username: string;
  password: string;
  client_type: string;
  client_id: string;
}

export interface LoginResponse {
  token: string;
  expires_at: string;
  user: {
    id: number;
    username: string;
  };
}

export const Events = {
  AUTH_LOGIN:    "auth.login",
  AUTH_RESUME:   "auth.resume",
  AUTH_REFRESH:  "auth.refresh",
  AUTH_OK:       "auth.ok",
  AUTH_ERROR:    "auth.error",
  PROJECT_BIND:  "project.bind",
  PROJECT_BOUND: "project.bound",
  PROJECT_LIST_REQUEST: "project.list.request",
  PROJECT_LIST:  "project.list",
  PROJECT_LISTED:"project.listed",
  SESSION_SYNC_REQUEST: "session.sync.request",
  SESSION_SYNC:  "session.sync",
  MESSAGE_SEND:  "message.send",
  MESSAGE_CHUNK: "message.chunk",
  MESSAGE_DONE:  "message.done",
  MESSAGE_ERROR: "message.error",
  AGENT_STATUS:  "agent.status",
  AGENT_WAKEUP:  "agent.wakeup",
  TASK_STOP:     "task.stop",
  FILE_SYNC:     "file.sync",
  FILE_UPLOAD:   "file.upload",
  FILE_CHUNK:    "file.chunk",
  FILE_DONE:     "file.done",
  FILE_ERROR:    "file.error",
  E2E_OFFER:     "e2e.offer",
  E2E_ANSWER:    "e2e.answer",
  PING:          "ping",
  PONG:          "pong",
  ERROR:         "error",
} as const;

export type EventType = typeof Events[keyof typeof Events];
