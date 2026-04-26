import { createClient, type Client } from "@libsql/client";

let _client: Client | null = null;
let _bootstrapped = false;

export function db(): Client {
  if (_client) return _client;
  const url = process.env.LIBSQL_URL || "file:./jarvis.db";
  _client = createClient({
    url,
    authToken: process.env.LIBSQL_AUTH_TOKEN,
  });
  return _client;
}

export async function ensureSchema() {
  if (_bootstrapped) return;
  const c = db();
  await c.batch(
    [
      `CREATE TABLE IF NOT EXISTS sessions (
        id           TEXT PRIMARY KEY,
        title        TEXT,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS messages (
        id           TEXT PRIMARY KEY,
        session_id   TEXT NOT NULL,
        role         TEXT NOT NULL,
        text         TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS tool_calls (
        id           TEXT PRIMARY KEY,
        session_id   TEXT NOT NULL,
        name         TEXT NOT NULL,
        args         TEXT,
        result       TEXT,
        error        TEXT,
        status       TEXT NOT NULL,
        started_at   INTEGER NOT NULL,
        ended_at     INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id, started_at)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC)`,
    ],
    "write"
  );

  // Idempotent additive migrations. SQLite's ADD COLUMN is cheap and
  // doesn't lock; wrap in try/catch since "duplicate column" throws.
  await addColumnIfMissing(c, "sessions", "persona_id", "TEXT");

  _bootstrapped = true;
}

async function addColumnIfMissing(
  c: Client,
  table: string,
  column: string,
  type: string
) {
  try {
    await c.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (e: any) {
    if (!String(e?.message || "").toLowerCase().includes("duplicate column")) {
      throw e;
    }
  }
}
