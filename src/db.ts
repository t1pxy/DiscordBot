import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DATABASE_URL || "./data/bot.db";
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

export const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  creator_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  starts_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meeting_roles (
  meeting_id INTEGER NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (meeting_id, role_id)
);
CREATE TABLE IF NOT EXISTS meeting_rsvps (
  meeting_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (meeting_id, user_id)
);
`);
