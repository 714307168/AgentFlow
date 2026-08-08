export type ClientType = "agent" | "device";

export interface Envelope {
  id: string;
  event: string;
  agent_id?: string;
  workgroup_id?: string;
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
  WORKGROUP_LIST_REQUEST: "workgroup.list.request",
  WORKGROUP_LIST: "workgroup.list",
  WORKGROUP_COMMAND: "workgroup.command",
  WORKGROUP_COMMAND_RESULT: "workgroup.command.result",
  WORKGROUP_COLLABORATION_LIST_REQUEST: "workgroup.collaboration.list.request",
  WORKGROUP_COLLABORATION_LIST: "workgroup.collaboration.list",
  WORKGROUP_COLLABORATION_SESSION_REQUEST: "workgroup.collaboration.session.request",
  WORKGROUP_COLLABORATION_SESSION: "workgroup.collaboration.session",
  WORKGROUP_COLLABORATION_MESSAGE_SEND: "workgroup.collaboration.message.send",
  WORKGROUP_COLLABORATION_MESSAGE_ACCEPTED: "workgroup.collaboration.message.accepted",
  WORKGROUP_COLLABORATION_MESSAGE_RESULT: "workgroup.collaboration.message.result",
  WORKGROUP_COLLABORATION_SNAPSHOT: "workgroup.collaboration.snapshot",
  MESSAGE_SEND:  "message.send",
  MESSAGE_ACCEPTED: "message.accepted",
  MESSAGE_CHUNK: "message.chunk",
  MESSAGE_DONE:  "message.done",
  MESSAGE_ERROR: "message.error",
  AGENT_STATUS:  "agent.status",
  AGENT_WAKEUP:  "agent.wakeup",
  NODE_PROFILE_REQUEST: "node.profile.request",
  NODE_PROFILE: "node.profile",
  NODE_DIAGNOSTICS_REQUEST: "node.diagnostics.request",
  NODE_DIAGNOSTICS: "node.diagnostics",
  NODE_COMMAND_REQUEST: "node.command.request",
  NODE_COMMAND_RESULT: "node.command.result",
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
