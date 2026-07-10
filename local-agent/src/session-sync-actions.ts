export const SessionSyncActions = {
  NEW_CONVERSATION: "new_conversation",
  SWITCH_CONVERSATION: "switch_conversation",
  REMOVE_QUEUE: "remove_queue",
  UPDATE_PROJECT_CONFIG: "update_project_config",
  FETCH_ITEM_DETAIL: "fetch_item_detail",
  FETCH_MODEL_OPTIONS: "fetch_model_options",
} as const;

export type SessionSyncAction = typeof SessionSyncActions[keyof typeof SessionSyncActions];
