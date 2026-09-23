import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// Project root: one level above server/ (ts-node) or two above dist/server/ (compiled).
export const ROOT = path.basename(path.dirname(__dirname)) === "dist" ? path.resolve(__dirname, "..", "..") : path.resolve(__dirname, "..");

const DB_PATH = process.env.DATABASE_PATH || path.join(ROOT, "db", "reviews.sqlite");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate(): void {
  db.exec(fs.readFileSync(path.join(ROOT, "db", "schema.sql"), "utf-8"));
}
