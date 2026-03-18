import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('claudeAgent', {
  onPtyOutput: (callback: (data: string) => void) => {
    ipcRenderer.on('pty-output', (_event, data: string) => callback(data));
  },
  writePty: (data: string) => {
    ipcRenderer.send('pty-write', data);
  },
  getProjects: () => ipcRenderer.invoke('get-projects'),
  addProject: (data: { name: string; path: string }) => ipcRenderer.invoke('add-project', data),
  deleteProject: (projectId: string) => ipcRenderer.invoke('delete-project', projectId),
  openProjectWindow: (projectId: string) => {
    ipcRenderer.send('open-project-window', projectId);
  },
  getConfig: () => ipcRenderer.invoke('get-config'),
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
  getAppSettings: () => ipcRenderer.invoke('get-app-settings'),
  setAppSettings: (settings: Record<string, boolean>) => ipcRenderer.invoke('set-app-settings', settings),
  getConnectionStatus: () => ipcRenderer.invoke('get-connection-status'),
  openProject: (projectId: string) => ipcRenderer.invoke('open-project', projectId),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
});
