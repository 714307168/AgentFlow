import Store from "electron-store";

export type Lang = "en" | "zh";

interface I18nSchema {
  language: Lang;
}

const i18nStore = new Store<I18nSchema>({
  name: "i18n",
  defaults: { language: "en" },
});

const messages: Record<Lang, Record<string, string>> = {
  en: {
    "app.name": "Claude Code Agent",
    "tray.noProjects": "No projects configured",
    "tray.settings": "Settings",
    "tray.showMain": "Show Main Window",
    "tray.quit": "Quit",
    "tray.connected": "Claude Code Agent (connected)",
    "tray.disconnected": "Claude Code Agent (disconnected)",
    "settings.title": "Agent Settings",
    "settings.serverConnection": "Server Connection",
    "settings.relayServerUrl": "Relay Server URL",
    "settings.agentId": "Agent ID",
    "settings.agentIdPlaceholder": "Enter your agent ID",
    "settings.token": "Authentication Token",
    "settings.tokenPlaceholder": "JWT token",
    "settings.e2e": "End-to-End Encryption",
    "settings.e2eEnable": "Enable E2E Encryption",
    "settings.publicKey": "Public Key",
    "settings.language": "Language",
    "settings.languageLabel": "Interface Language",
    "settings.launch": "Launch",
    "settings.autoStart": "Start on Boot",
    "settings.silentLaunch": "Silent Launch (minimize to tray)",
    "settings.save": "Save & Reconnect",
    "settings.cancel": "Cancel",
    "settings.reconnect": "Reconnect",
    "settings.saved.short": "Saved",
    "settings.saved": "Reconnecting...",
    "settings.saveFailed": "Failed: ",
  },
  zh: {
    "app.name": "Claude Code 代理",
    "tray.noProjects": "暂无项目",
    "tray.settings": "设置",
    "tray.showMain": "显示主窗口",
    "tray.quit": "退出",
    "tray.connected": "Claude Code 代理（已连接）",
    "tray.disconnected": "Claude Code 代理（已断开）",
    "settings.title": "代理设置",
    "settings.serverConnection": "服务器连接",
    "settings.relayServerUrl": "中继服务器地址",
    "settings.agentId": "代理 ID",
    "settings.agentIdPlaceholder": "输入代理 ID",
    "settings.token": "认证令牌",
    "settings.tokenPlaceholder": "JWT 令牌",
    "settings.e2e": "端到端加密",
    "settings.e2eEnable": "启用端到端加密",
    "settings.publicKey": "公钥",
    "settings.language": "语言",
    "settings.languageLabel": "界面语言",
    "settings.launch": "启动",
    "settings.autoStart": "开机自启",
    "settings.silentLaunch": "静默启动（最小化到托盘）",
    "settings.save": "保存并重连",
    "settings.cancel": "取消",
    "settings.reconnect": "重新连接",
    "settings.saved.short": "已保存",
    "settings.saved": "正在重连...",
    "settings.saveFailed": "失败：",
  },
};

let currentLang: Lang = i18nStore.get("language", "en") as Lang;

export function t(key: string): string {
  return messages[currentLang]?.[key] ?? messages.en[key] ?? key;
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  currentLang = lang;
  i18nStore.set("language", lang);
}

export function getAllMessages(lang?: Lang): Record<string, string> {
  return messages[lang ?? currentLang];
}
