import { app } from "electron";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

const DATABASE_FILE_NAME = "agentflow-state.sqlite";

let database: Database.Database | null = null;

export function getDesktopDatabase(): Database.Database {
  if (database) {
    return database;
  }

  const userDataPath = app.getPath("userData");
  fs.mkdirSync(userDataPath, { recursive: true });
  database = new Database(path.join(userDataPath, DATABASE_FILE_NAME));
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  initializeSchema(database);
  return database;
}

export function getSqliteMigrationFlag(key: string): string | null {
  const row = getDesktopDatabase()
    .prepare("SELECT value FROM storage_meta WHERE key = ?")
    .get(key) as { value?: string } | undefined;
  return typeof row?.value === "string" ? row.value : null;
}

export function setSqliteMigrationFlag(key: string, value: string): void {
  getDesktopDatabase()
    .prepare(
      "INSERT INTO storage_meta (key, value) VALUES (?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

function initializeSchema(db: Database.Database): void {
  db.exec([
    "CREATE TABLE IF NOT EXISTS storage_meta (",
    "key TEXT PRIMARY KEY,",
    "value TEXT NOT NULL",
    ");",
    "CREATE TABLE IF NOT EXISTS runtime_project_states (",
    "project_id TEXT PRIMARY KEY,",
    "payload TEXT NOT NULL,",
    "updated_at INTEGER NOT NULL",
    ");",
    "CREATE TABLE IF NOT EXISTS workgroup_collaboration_sessions (",
    "workgroup_id TEXT PRIMARY KEY,",
    "created_at INTEGER NOT NULL,",
    "updated_at INTEGER NOT NULL",
    ");",
    "CREATE TABLE IF NOT EXISTS workgroup_collaboration_messages (",
    "id TEXT PRIMARY KEY,",
    "workgroup_id TEXT NOT NULL,",
    "sender_type TEXT NOT NULL,",
    "sender_name TEXT NOT NULL,",
    "member_id TEXT,",
    "member_role TEXT,",
    "project_id TEXT,",
    "project_kind TEXT,",
    "dispatch_run_id TEXT,",
    "trigger_message_id TEXT,",
    "content TEXT NOT NULL,",
    "status TEXT NOT NULL,",
    "created_at INTEGER NOT NULL,",
    "updated_at INTEGER NOT NULL,",
    "FOREIGN KEY(workgroup_id) REFERENCES workgroup_collaboration_sessions(workgroup_id) ON DELETE CASCADE",
    ");",
    "CREATE INDEX IF NOT EXISTS idx_workgroup_messages_group_time ",
    "ON workgroup_collaboration_messages(workgroup_id, created_at, updated_at, id);",
  ].join("\n"));
}
