import { db, ensureSchema } from "./db";

export interface SessionRow {
  id: string;
  title: string | null;
  personaId: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface MessageRow {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: number;
}

export interface ToolCallRow {
  id: string;
  sessionId: string;
  name: string;
  args: unknown;
  result: unknown;
  error: string | null;
  status: "running" | "success" | "error";
  startedAt: number;
  endedAt: number | null;
}

function uid() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

export async function listSessions(): Promise<SessionRow[]> {
  await ensureSchema();
  const res = await db().execute(`
    SELECT s.id, s.title, s.persona_id, s.created_at, s.updated_at,
           (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS msg_count
    FROM sessions s
    ORDER BY s.updated_at DESC
    LIMIT 100
  `);
  return res.rows.map((r) => ({
    id: String(r.id),
    title: r.title == null ? null : String(r.title),
    personaId: r.persona_id == null ? null : String(r.persona_id),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    messageCount: Number(r.msg_count),
  }));
}

export async function createSession(opts: {
  title?: string;
  personaId?: string;
}): Promise<SessionRow> {
  await ensureSchema();
  const id = uid();
  const now = Date.now();
  await db().execute({
    sql: `INSERT INTO sessions (id, title, persona_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    args: [id, opts.title ?? null, opts.personaId ?? null, now, now],
  });
  return {
    id,
    title: opts.title ?? null,
    personaId: opts.personaId ?? null,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
}

export async function getSession(id: string) {
  await ensureSchema();
  const c = db();
  const sess = await c.execute({
    sql: `SELECT id, title, persona_id, created_at, updated_at FROM sessions WHERE id = ?`,
    args: [id],
  });
  if (sess.rows.length === 0) return null;
  const row = sess.rows[0];
  const messages = await listMessages(id);
  const toolCalls = await listToolCalls(id);
  return {
    id: String(row.id),
    title: row.title == null ? null : String(row.title),
    personaId: row.persona_id == null ? null : String(row.persona_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    messages,
    toolCalls,
  };
}

export async function setPersona(sessionId: string, personaId: string) {
  await ensureSchema();
  await db().execute({
    sql: `UPDATE sessions SET persona_id = ?, updated_at = ? WHERE id = ?`,
    args: [personaId, Date.now(), sessionId],
  });
}

export async function listMessages(sessionId: string): Promise<MessageRow[]> {
  const res = await db().execute({
    sql: `SELECT id, session_id, role, text, created_at FROM messages
          WHERE session_id = ? ORDER BY created_at ASC`,
    args: [sessionId],
  });
  return res.rows.map((r) => ({
    id: String(r.id),
    sessionId: String(r.session_id),
    role: String(r.role) as MessageRow["role"],
    text: String(r.text),
    createdAt: Number(r.created_at),
  }));
}

export async function listToolCalls(sessionId: string): Promise<ToolCallRow[]> {
  const res = await db().execute({
    sql: `SELECT id, session_id, name, args, result, error, status, started_at, ended_at
          FROM tool_calls WHERE session_id = ? ORDER BY started_at ASC`,
    args: [sessionId],
  });
  return res.rows.map((r) => ({
    id: String(r.id),
    sessionId: String(r.session_id),
    name: String(r.name),
    args: r.args ? JSON.parse(String(r.args)) : null,
    result: r.result ? JSON.parse(String(r.result)) : null,
    error: r.error == null ? null : String(r.error),
    status: String(r.status) as ToolCallRow["status"],
    startedAt: Number(r.started_at),
    endedAt: r.ended_at == null ? null : Number(r.ended_at),
  }));
}

export async function appendMessage(input: {
  sessionId: string;
  id?: string;
  role: "user" | "assistant" | "system";
  text: string;
}): Promise<MessageRow> {
  await ensureSchema();
  const id = input.id ?? uid();
  const now = Date.now();
  const c = db();
  // upsert because the realtime provider streams partial assistant messages
  // by repeatedly calling onTranscript with the same id
  await c.execute({
    sql: `INSERT INTO messages (id, session_id, role, text, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET text = excluded.text`,
    args: [id, input.sessionId, input.role, input.text, now],
  });
  await touchSession(input.sessionId);
  return { id, sessionId: input.sessionId, role: input.role, text: input.text, createdAt: now };
}

export async function appendToolCall(input: {
  sessionId: string;
  id: string;
  name: string;
  args: unknown;
  result?: unknown;
  error?: string;
  status: "running" | "success" | "error";
  startedAt: number;
  endedAt?: number;
}) {
  await ensureSchema();
  await db().execute({
    sql: `INSERT INTO tool_calls (id, session_id, name, args, result, error, status, started_at, ended_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            result = excluded.result,
            error = excluded.error,
            status = excluded.status,
            ended_at = excluded.ended_at`,
    args: [
      input.id,
      input.sessionId,
      input.name,
      input.args == null ? null : JSON.stringify(input.args),
      input.result === undefined ? null : JSON.stringify(input.result),
      input.error ?? null,
      input.status,
      input.startedAt,
      input.endedAt ?? null,
    ],
  });
  await touchSession(input.sessionId);
}

export async function setTitle(sessionId: string, title: string) {
  await ensureSchema();
  await db().execute({
    sql: `UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`,
    args: [title, Date.now(), sessionId],
  });
}

export async function deleteSession(id: string) {
  await ensureSchema();
  // ON DELETE CASCADE handles children
  await db().execute({ sql: `DELETE FROM sessions WHERE id = ?`, args: [id] });
}

async function touchSession(id: string) {
  await db().execute({
    sql: `UPDATE sessions SET updated_at = ? WHERE id = ?`,
    args: [Date.now(), id],
  });
}
