import { migrateDatabase } from "./migrations";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";

const dir = path.dirname(config.databasePath);
if (dir && !fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

migrateDatabase(db);
