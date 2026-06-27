import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { CliProvider } from "./runtime-types";

export type SkillCatalogSource = "built-in" | "local";
export type SkillCatalogTranslationMode = "none" | "model" | "fallback";

export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  source: SkillCatalogSource;
  sourceLabel: string;
  path: string | null;
  tags: string[];
  installHint: string | null;
  zhName: string | null;
  zhDescription: string | null;
}

export interface SkillCatalogSnapshot {
  items: SkillCatalogEntry[];
  scannedRoots: string[];
  translationMode: SkillCatalogTranslationMode;
  translatedAt: number | null;
  error: string | null;
}

export type SkillCatalogTranslator = (input: {
  provider: CliProvider;
  prompt: string;
}) => Promise<string>;

interface BuiltInSkillTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  installHint: string;
  zhName: string;
  zhDescription: string;
}

const MAX_LOCAL_SKILL_FILES = 80;
const MAX_SKILL_FILE_BYTES = 32 * 1024;

const BUILT_IN_SKILLS: BuiltInSkillTemplate[] = [
  {
    id: "openai-docs",
    name: "OpenAI Docs",
    description: "Use current OpenAI product and API documentation when building Codex, model, or SDK integrations.",
    tags: ["docs", "openai", "api"],
    installHint: "Use as a documentation/research skill before changing OpenAI API integrations.",
    zhName: "OpenAI 文档",
    zhDescription: "开发 Codex、模型或 SDK 集成时查阅最新 OpenAI 产品与 API 文档。",
  },
  {
    id: "browser-automation",
    name: "Browser Automation",
    description: "Automate Chromium pages, inspect DOM state, capture screenshots, and validate frontend behavior.",
    tags: ["browser", "frontend", "testing"],
    installHint: "Useful for desktop webview, admin console, and frontend regression checks.",
    zhName: "浏览器自动化",
    zhDescription: "自动操作 Chromium 页面、检查 DOM、截图并验证前端交互。",
  },
  {
    id: "docx",
    name: "Word Document Tools",
    description: "Create, inspect, and edit .docx reports, templates, tables, headings, and document assets.",
    tags: ["documents", "office", "docx"],
    installHint: "Useful when project output includes Word reports or formatted deliverables.",
    zhName: "Word 文档工具",
    zhDescription: "创建、检查和编辑 .docx 报告、模板、表格和文档素材。",
  },
  {
    id: "mysql",
    name: "MySQL Engineering",
    description: "Review schema design, indexes, transactions, migrations, query tuning, and MySQL operations.",
    tags: ["database", "mysql", "backend"],
    installHint: "Use before changing MySQL tables, queries, migrations, or production database behavior.",
    zhName: "MySQL 工程",
    zhDescription: "审查表结构、索引、事务、迁移、查询优化和 MySQL 运维。",
  },
  {
    id: "image-generation",
    name: "Image Generation",
    description: "Generate or edit bitmap assets, mockups, illustrations, textures, and transparent cutouts.",
    tags: ["assets", "image", "design"],
    installHint: "Useful for UI assets, marketing images, and project material generation.",
    zhName: "生图素材",
    zhDescription: "生成或编辑位图素材、界面样机、插画、纹理和透明背景图片。",
  },
  {
    id: "release-engineering",
    name: "Release Engineering",
    description: "Plan packaging, CI/CD, GitHub Releases, installer naming, rollout, rollback, and verification.",
    tags: ["release", "ci", "packaging"],
    installHint: "Use for desktop/mobile packaging, release notes, and GitHub Actions changes.",
    zhName: "发布工程",
    zhDescription: "规划打包、CI/CD、GitHub Releases、安装包命名、灰度和回滚。",
  },
  {
    id: "android-client",
    name: "Android Client",
    description: "Work on Android app state, sync, installability, update download policy, and Compose UI behavior.",
    tags: ["android", "mobile", "compose"],
    installHint: "Use when changing Android login, sync, updates, APK signing, or UI flows.",
    zhName: "Android 客户端",
    zhDescription: "处理 Android 应用状态、同步、安装、自动下载策略和 Compose 界面。",
  },
  {
    id: "desktop-electron",
    name: "Desktop Electron",
    description: "Work on Electron windows, Linux/Windows packaging, native modules, auto-update, tray, and settings UI.",
    tags: ["electron", "desktop", "packaging"],
    installHint: "Use for AgentFlow desktop runtime, updater, installer, and cross-platform issues.",
    zhName: "Electron 桌面端",
    zhDescription: "处理 Electron 窗口、打包、原生模块、自动更新、托盘和设置界面。",
  },
];

export function getDefaultSkillRoots(homeDir = os.homedir()): string[] {
  const roots = [
    process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, "skills") : null,
    path.join(homeDir, ".codex", "skills"),
    path.join(homeDir, ".agents", "skills"),
    path.join(homeDir, ".cc-switch", "skills"),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

export async function buildSkillCatalogSnapshot(options: {
  roots?: string[];
  translateToZh?: boolean;
  provider?: CliProvider;
  translator?: SkillCatalogTranslator | null;
} = {}): Promise<SkillCatalogSnapshot> {
  const roots = [...new Set((options.roots ?? getDefaultSkillRoots()).map((root) => path.resolve(root)))];
  const items = mergeSkillEntries([
    ...BUILT_IN_SKILLS.map(createBuiltInEntry),
    ...collectLocalSkillEntries(roots),
  ]);

  let translationMode: SkillCatalogTranslationMode = "none";
  let translatedAt: number | null = null;
  let error: string | null = null;

  if (options.translateToZh) {
    if (options.translator && options.provider) {
      try {
        applyModelTranslations(items, await translateSkillEntries({
          items,
          provider: options.provider,
          translator: options.translator,
        }));
        translationMode = "model";
        translatedAt = Date.now();
      } catch (translationError) {
        applyFallbackTranslations(items);
        translationMode = "fallback";
        translatedAt = Date.now();
        error = formatError(translationError);
      }
    } else {
      applyFallbackTranslations(items);
      translationMode = "fallback";
      translatedAt = Date.now();
    }
  }

  return {
    items,
    scannedRoots: roots,
    translationMode,
    translatedAt,
    error,
  };
}

function createBuiltInEntry(template: BuiltInSkillTemplate): SkillCatalogEntry {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    source: "built-in",
    sourceLabel: "Built-in catalog",
    path: null,
    tags: template.tags,
    installHint: template.installHint,
    zhName: null,
    zhDescription: null,
  };
}

function collectLocalSkillEntries(roots: string[]): SkillCatalogEntry[] {
  const entries: SkillCatalogEntry[] = [];
  for (const root of roots) {
    for (const skillFile of findSkillFiles(root)) {
      const entry = readLocalSkillEntry(root, skillFile);
      if (entry) {
        entries.push(entry);
      }
      if (entries.length >= MAX_LOCAL_SKILL_FILES) {
        return entries;
      }
    }
  }
  return entries;
}

function findSkillFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const results: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length > 0 && results.length < MAX_LOCAL_SKILL_FILES) {
    const current = queue.shift()!;
    let dirEntries: fs.Dirent[];
    try {
      dirEntries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirEntry of dirEntries) {
      const fullPath = path.join(current.dir, dirEntry.name);
      if (dirEntry.isFile() && dirEntry.name.toLowerCase() === "skill.md") {
        results.push(fullPath);
        continue;
      }
      if (dirEntry.isDirectory() && current.depth < 4 && !dirEntry.name.startsWith(".")) {
        queue.push({ dir: fullPath, depth: current.depth + 1 });
      }
    }
  }
  return results;
}

function readLocalSkillEntry(root: string, skillFile: string): SkillCatalogEntry | null {
  try {
    const stats = fs.statSync(skillFile);
    if (!stats.isFile() || stats.size > MAX_SKILL_FILE_BYTES) {
      return null;
    }
    const content = fs.readFileSync(skillFile, "utf8");
    const relativeDir = path.relative(root, path.dirname(skillFile)) || path.basename(path.dirname(skillFile));
    const name = parseSkillName(content) || path.basename(path.dirname(skillFile));
    const description = parseSkillDescription(content) || "Local skill discovered from SKILL.md.";
    const id = "local:" + normalizeSkillId(relativeDir || name);
    return {
      id,
      name,
      description,
      source: "local",
      sourceLabel: path.basename(root) || root,
      path: skillFile,
      tags: ["local"],
      installHint: "Installed locally under " + path.dirname(skillFile),
      zhName: null,
      zhDescription: null,
    };
  } catch {
    return null;
  }
}

function parseSkillName(content: string): string | null {
  const title = /^#\s+(.+)$/mu.exec(content)?.[1]?.trim();
  return title ? limitText(title, 80) : null;
}

function parseSkillDescription(content: string): string | null {
  const description = /^description:\s*(.+)$/imu.exec(content)?.[1]?.trim()
    || /^##\s+Description\s*\n+([\s\S]+?)(?:\n##\s+|$)/imu.exec(content)?.[1]?.trim()
    || content.split(/\r?\n/u).find((line) => line.trim() && !line.trim().startsWith("#"))?.trim();
  return description ? limitText(description.replace(/\s+/gu, " "), 240) : null;
}

function mergeSkillEntries(entries: SkillCatalogEntry[]): SkillCatalogEntry[] {
  const seen = new Set<string>();
  const merged: SkillCatalogEntry[] = [];
  for (const entry of entries) {
    const key = entry.id.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(entry);
  }
  return merged.sort((left, right) => {
    if (left.source !== right.source) {
      return left.source === "built-in" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

async function translateSkillEntries(options: {
  items: SkillCatalogEntry[];
  provider: CliProvider;
  translator: SkillCatalogTranslator;
}): Promise<Array<{ id: string; zhName: string; zhDescription: string }>> {
  const payload = options.items.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
  }));
  const prompt = [
    "Translate the following skill catalog entries into concise Simplified Chinese.",
    "Return only valid JSON. The JSON must be an array of objects with id, zhName, and zhDescription.",
    "Keep zhName short. Keep zhDescription under 80 Chinese characters. Do not add markdown.",
    "",
    JSON.stringify(payload),
  ].join("\n");
  const raw = await options.translator({
    provider: options.provider,
    prompt,
  });
  return parseTranslationJson(raw);
}

function parseTranslationJson(raw: string): Array<{ id: string; zhName: string; zhDescription: string }> {
  const jsonText = extractJsonArray(raw);
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) {
    throw new Error("Translation response is not a JSON array.");
  }
  return parsed
    .map((item) => ({
      id: String(item?.id ?? "").trim(),
      zhName: limitText(String(item?.zhName ?? "").trim(), 80),
      zhDescription: limitText(String(item?.zhDescription ?? "").trim(), 160),
    }))
    .filter((item) => item.id && item.zhName && item.zhDescription);
}

function extractJsonArray(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return trimmed;
  }
  const match = /(\[[\s\S]*\])/u.exec(trimmed);
  if (!match) {
    throw new Error("Translation response does not contain a JSON array.");
  }
  return match[1];
}

function applyModelTranslations(
  items: SkillCatalogEntry[],
  translations: Array<{ id: string; zhName: string; zhDescription: string }>,
): void {
  const byId = new Map(translations.map((item) => [item.id, item]));
  for (const item of items) {
    const translation = byId.get(item.id);
    if (translation) {
      item.zhName = translation.zhName;
      item.zhDescription = translation.zhDescription;
    }
  }
  applyFallbackTranslations(items);
}

function applyFallbackTranslations(items: SkillCatalogEntry[]): void {
  const builtInById = new Map(BUILT_IN_SKILLS.map((item) => [item.id, item]));
  for (const item of items) {
    const fallback = builtInById.get(item.id);
    if (!item.zhName && fallback) {
      item.zhName = fallback.zhName;
    }
    if (!item.zhDescription && fallback) {
      item.zhDescription = fallback.zhDescription;
    }
  }
}

function normalizeSkillId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    || "skill";
}

function limitText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength - 1) + "…" : value;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
