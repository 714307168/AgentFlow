export const SessionSyncActions = {
  NEW_CONVERSATION: "new_conversation",
  SWITCH_CONVERSATION: "switch_conversation",
  REMOVE_QUEUE: "remove_queue",
} as const;

export type SessionSyncAction = typeof SessionSyncActions[keyof typeof SessionSyncActions];
