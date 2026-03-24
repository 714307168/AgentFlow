import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('claudeAgent', {
  onProjectSessionSnapshot: (callback: (snapshot: unknown) => void) => {
    ipcRenderer.on('project-session-snapshot', (_event, snapshot: unknown) => callback(snapshot));
  },
  getProjects: () => ipcRenderer.invoke('get-projects'),
  onProjectsChanged: (callback: (projects: unknown[]) => void) => {
    ipcRenderer.on('projects-changed', (_event, projects: unknown[]) => callback(projects));
  },
  getProjectSession: (projectId: string) => ipcRenderer.invoke('get-project-session', projectId),
  getProjectHistoryPage: (data: {
    projectId: string;
    kind: 'messages' | 'activities' | 'cli';
    conversationId?: string | null;
    beforeId?: string | null;
    limit?: number;
  }) => ipcRenderer.invoke('get-project-history-page', data),
  listProjectConversations: (projectId: string) => ipcRenderer.invoke('list-project-conversations', projectId),
  createProjectConversation: (projectId: string) => ipcRenderer.invoke('create-project-conversation', projectId),
  activateProjectConversation: (data: { projectId: string; conversationId: string }) => ipcRenderer.invoke('activate-project-conversation', data),
  clearHistoryCache: (projectId?: string | null) => ipcRenderer.invoke('clear-history-cache', projectId),
  sendProjectPrompt: (data: { projectId: string; prompt: string; attachments?: unknown[] }) => ipcRenderer.invoke('send-project-prompt', data),
  pickProjectAttachments: (data: { projectId: string; kind: 'image' | 'file' }) => ipcRenderer.invoke('pick-project-attachments', data),
  saveClipboardProjectImage: (data: { projectId: string }) => ipcRenderer.invoke('save-clipboard-project-image', data),
  getAttachmentImageData: (data: { path?: string | null }) => ipcRenderer.invoke('get-attachment-image-data', data),
  stopProjectRun: (projectId: string) => ipcRenderer.invoke('stop-project-run', projectId),
  removeQueuedProjectPrompt: (data: { projectId: string; runId: string }) => ipcRenderer.invoke('remove-queued-project-prompt', data),
  addProject: (data: { name: string; path: string; groupName?: string | null; cliProvider?: string; cliModel?: string | null; projectPrompt?: string | null }) => ipcRenderer.invoke('add-project', data),
  updateProject: (data: { projectId: string; updates: Record<string, string | null> }) => ipcRenderer.invoke('update-project', data),
  deleteProject: (projectId: string) => ipcRenderer.invoke('delete-project', projectId),
  openProjectWindow: (projectId: string) => {
    ipcRenderer.send('open-project-window', projectId);
  },
  getConfig: () => ipcRenderer.invoke('get-config'),
  listAccessGrants: () => ipcRenderer.invoke('list-access-grants'),
  grantAccessToUser: (data: { controllerUsername: string; note?: string | null }) => ipcRenderer.invoke('grant-access-to-user', data),
  revokeAccessGrant: (data: { controllerUserId: number; targetAgentId?: string | null }) => ipcRenderer.invoke('revoke-access-grant', data),
  saveConfig: (config: Record<string, string>) => ipcRenderer.invoke('save-config', config),
  login: (data: { username: string; password: string; agentId: string }) => ipcRenderer.invoke('login', data),
  onProjectId: (callback: (id: string) => void) => {
    ipcRenderer.on('project-id', (_event, id: string) => callback(id));
  },
  getE2EStatus: () => ipcRenderer.invoke('get-e2e-status'),
  setE2EEnabled: (enabled: boolean) => ipcRenderer.invoke('set-e2e-enabled', enabled),
  reconnectRelay: () => ipcRenderer.invoke('reconnect-relay'),
  getLang: () => ipcRenderer.invoke('get-lang'),
  setLang: (lang: string) => ipcRenderer.invoke('set-lang', lang),
  getI18nMessages: () => ipcRenderer.invoke('get-i18n-messages'),
  onLangChanged: (callback: (payload: { lang: string; messages: Record<string, string> }) => void) => {
    ipcRenderer.on('lang-changed', (_event, payload) => callback(payload));
  },
  getAppSettings: () => ipcRenderer.invoke('get-app-settings'),
  setAppSettings: (settings: Record<string, boolean | number>) => ipcRenderer.invoke('set-app-settings', settings),
  getUpdateState: () => ipcRenderer.invoke('get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadAvailableUpdate: () => ipcRenderer.invoke('download-available-update'),
  installDownloadedUpdate: () => ipcRenderer.invoke('install-downloaded-update'),
  onUpdateStateChanged: (callback: (state: unknown) => void) => {
    ipcRenderer.on('update-state-changed', (_event, state: unknown) => callback(state));
  },
  getConnectionStatus: () => ipcRenderer.invoke('get-connection-status'),
  openProject: (projectId: string) => ipcRenderer.invoke('open-project', projectId),
  openSettingsWindow: (pane?: string) => ipcRenderer.send('open-settings-window', pane),
  onSettingsPaneChanged: (callback: (pane: string) => void) => {
    ipcRenderer.on('settings-pane-changed', (_event, pane: string) => callback(pane));
  },
  setActiveProject: (projectId: string | null) => ipcRenderer.send('set-active-project', projectId),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
});
