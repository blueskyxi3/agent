import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Artifact } from "@ai-hub-agent/contracts";

export type StoredPart =
  | { type: "text"; text: string }
  | { type: "tool"; toolCallId: string; toolName: string; args: unknown; result?: unknown; isError?: boolean }
  | { type: "artifact"; artifact: Artifact };
export type StoredMessage = { role: "user" | "assistant"; text: string; createdAt: string; artifacts?: Artifact[] | undefined; parts?: StoredPart[] | undefined };
export type StoredThread = { id: string; userId: number; title?: string | undefined; createdAt: string; updatedAt: string; messages: StoredMessage[] };

export function normalizeThreadTitle(value: string) {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
  const title = firstLine
    .replace(/^#+\s*/, "")
    .replace(/^(?:标题|title)\s*[:：]\s*/i, "")
    .replace(/^[\s"'“”‘’《》]+|[\s"'“”‘’《》。！？!?]+$/g, "")
    .replace(/\s+/g, " ");
  return [...title].slice(0, 36).join("");
}

type ThreadRow = { id: string; user_id: number; title: string | null; created_at: string; updated_at: string };
type MessageRow = { role: "user" | "assistant"; text: string; created_at: string; artifacts: string | null; parts: string | null };
type ThreadSummaryRow = { id: string; title: string | null; first_user_message: string | null; updated_at: string; message_count: number };

export class ThreadStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string, legacyRoot?: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        user_id INTEGER NOT NULL,
        id TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS messages (
        user_id INTEGER NOT NULL,
        thread_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        artifacts TEXT,
        parts TEXT,
        PRIMARY KEY (user_id, thread_id, position),
        FOREIGN KEY (user_id, thread_id) REFERENCES threads(user_id, id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_threads_user_updated ON threads(user_id, updated_at DESC);
    `);
    const columns = this.database.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "parts"))
      this.database.exec("ALTER TABLE messages ADD COLUMN parts TEXT");
    if (legacyRoot) this.migrateLegacyFiles(legacyRoot);
  }

  async getOrCreate(userId: number, id?: string) {
    if (id) {
      this.validateThreadId(id);
      const thread = this.readThread(userId, id);
      if (!thread) throw new Error("会话不存在或无权访问");
      return thread;
    }
    const now = new Date().toISOString();
    const thread: StoredThread = { id: randomUUID(), userId, createdAt: now, updatedAt: now, messages: [] };
    this.database.prepare("INSERT INTO threads (user_id, id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(userId, thread.id, null, now, now);
    return thread;
  }

  async append(thread: StoredThread, message: StoredMessage) {
    const updatedAt = new Date().toISOString();
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO messages (user_id, thread_id, position, role, text, created_at, artifacts, parts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(thread.userId, thread.id, thread.messages.length, message.role, message.text, message.createdAt,
        message.artifacts ? JSON.stringify(message.artifacts) : null, message.parts ? JSON.stringify(message.parts) : null);
      this.database.prepare("UPDATE threads SET updated_at = ? WHERE user_id = ? AND id = ?")
        .run(updatedAt, thread.userId, thread.id);
    });
    thread.messages.push(message);
    thread.updatedAt = updatedAt;
  }

  async pageWorkflow(userId: number, threadId: string, workflowId: string) {
    const thread = await this.getOrCreate(userId, threadId);
    for (let position = thread.messages.length - 1; position >= 0; position--) {
      const message = thread.messages[position]!;
      const artifact = message.artifacts?.find((item) => item.kind === "page_workflow" && item.workflowId === workflowId);
      if (artifact?.kind === "page_workflow") return { thread, message, position, artifact };
    }
    return undefined;
  }

  async updatePageWorkflow(userId: number, threadId: string, workflowId: string, update: { step: "naming" | "review" | "submitting" | "completed" | "failed" | "cancelled"; name?: string; recordId?: number }) {
    const found = await this.pageWorkflow(userId, threadId, workflowId);
    if (!found) return undefined;
    const { thread, message, position, artifact } = found;
    if (Date.now() > artifact.expiresAt) throw new Error("工作流已过期，请重新发起");
    const allowed: Record<string, string[]> = {
      start: ["naming", "failed", "cancelled"],
      naming: ["review", "failed", "cancelled"],
      review: ["review", "submitting", "failed", "cancelled"],
      submitting: ["completed", "failed"],
    };
    if (!allowed[artifact.step]?.includes(update.step)) throw new Error("工作流状态已变化，请刷新后查看");
    const next = {
      ...artifact, step: update.step,
      allowedActions: (update.step === "naming" ? ["fill", "cancel"] : update.step === "review" ? ["read", "submit", "cancel"] : []) as Array<"open" | "fill" | "read" | "submit" | "cancel">,
      ...(update.name ? { name: update.name } : {}),
      ...(update.step === "completed" && update.recordId ? { recordId: update.recordId } : {}),
    };
    message.artifacts = message.artifacts?.map((item) => item === artifact ? next : item);
    message.parts = message.parts?.map((part) => part.type === "artifact" && part.artifact.kind === "page_workflow" && part.artifact.workflowId === workflowId ? { ...part, artifact: next } : part);
    this.database.prepare("UPDATE messages SET artifacts = ?, parts = ? WHERE user_id = ? AND thread_id = ? AND position = ?")
      .run(JSON.stringify(message.artifacts), JSON.stringify(message.parts), userId, threadId, position);
    return next;
  }

  async setTitle(thread: StoredThread, value: string, expectedFirstMessage?: string) {
    const title = normalizeThreadTitle(value);
    if (!title) return;
    const updatedAt = new Date().toISOString();
    const result = expectedFirstMessage === undefined
      ? this.database.prepare("UPDATE threads SET title = ?, updated_at = ? WHERE user_id = ? AND id = ? AND title IS NULL")
        .run(title, updatedAt, thread.userId, thread.id)
      : this.database.prepare(`
          UPDATE threads SET title = ?, updated_at = ?
          WHERE user_id = ? AND id = ? AND title IS NULL AND ? = (
            SELECT text FROM messages
            WHERE user_id = ? AND thread_id = ? AND role = 'user'
            ORDER BY position LIMIT 1
          )
        `).run(title, updatedAt, thread.userId, thread.id, expectedFirstMessage, thread.userId, thread.id);
    if (result.changes === 0) return;
    thread.title = title;
    thread.updatedAt = updatedAt;
  }

  async list(userId: number) {
    const rows = this.database.prepare(`
      SELECT t.id, t.title, t.updated_at,
        COUNT(m.position) AS message_count,
        (SELECT text FROM messages
          WHERE user_id = t.user_id AND thread_id = t.id AND role = 'user'
          ORDER BY position LIMIT 1) AS first_user_message
      FROM threads t
      LEFT JOIN messages m ON m.user_id = t.user_id AND m.thread_id = t.id
      WHERE t.user_id = ?
      GROUP BY t.user_id, t.id
      ORDER BY t.updated_at DESC
      LIMIT 100
    `).all(userId) as unknown as ThreadSummaryRow[];
    return rows.map((row) => {
      const firstMessage = row.first_user_message?.trim() ?? "";
      const fallback = firstMessage ? `${firstMessage.slice(0, 36)}${firstMessage.length > 36 ? "…" : ""}` : "新会话";
      return { id: row.id, title: row.title || fallback, updatedAt: row.updated_at, messageCount: Number(row.message_count) };
    });
  }

  async clear(userId: number, id: string) {
    const thread = await this.getOrCreate(userId, id);
    const updatedAt = new Date().toISOString();
    this.transaction(() => {
      this.database.prepare("DELETE FROM messages WHERE user_id = ? AND thread_id = ?").run(userId, id);
      this.database.prepare("UPDATE threads SET title = NULL, updated_at = ? WHERE user_id = ? AND id = ?").run(updatedAt, userId, id);
    });
    thread.messages = [];
    thread.title = undefined;
    thread.updatedAt = updatedAt;
    return thread;
  }

  async delete(userId: number, id: string) {
    this.validateThreadId(id);
    const result = this.database.prepare("DELETE FROM threads WHERE user_id = ? AND id = ?").run(userId, id);
    return result.changes === 1;
  }

  async deleteMany(userId: number, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0 || uniqueIds.length > 100) throw new Error("每次只能删除 1 至 100 个会话");
    uniqueIds.forEach((id) => this.validateThreadId(id));
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const result = this.database.prepare(`DELETE FROM threads WHERE user_id = ? AND id IN (${placeholders})`)
      .run(userId, ...uniqueIds);
    return Number(result.changes);
  }

  close() {
    this.database.close();
  }

  private validateThreadId(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error("无效的会话 ID");
    }
  }

  private readThread(userId: number, id: string) {
    const row = this.database.prepare(`
      SELECT id, user_id, title, created_at, updated_at FROM threads WHERE user_id = ? AND id = ?
    `).get(userId, id) as ThreadRow | undefined;
    if (!row) return undefined;
    const messages = this.database.prepare(`
      SELECT role, text, created_at, artifacts, parts FROM messages
      WHERE user_id = ? AND thread_id = ? ORDER BY position
    `).all(userId, id) as unknown as MessageRow[];
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: messages.map((message) => ({
        role: message.role,
        text: message.text,
        createdAt: message.created_at,
        artifacts: message.artifacts ? JSON.parse(message.artifacts) as Artifact[] : undefined,
        parts: message.parts ? JSON.parse(message.parts) as StoredPart[] : undefined,
      })),
    } satisfies StoredThread;
  }

  private migrateLegacyFiles(root: string) {
    if (!existsSync(root)) return;
    for (const userDirectory of readdirSync(root, { withFileTypes: true })) {
      const userId = Number(userDirectory.name);
      if (!userDirectory.isDirectory() || !Number.isInteger(userId) || userId < 1) continue;
      const directory = path.join(root, userDirectory.name);
      for (const name of readdirSync(directory)) {
        if (!/^[0-9a-f-]{36}\.json$/i.test(name)) continue;
        try {
          const thread = JSON.parse(readFileSync(path.join(directory, name), "utf8")) as StoredThread;
          this.validateThreadId(thread.id);
          if (thread.userId !== userId || !Array.isArray(thread.messages) || this.readThread(userId, thread.id)) continue;
          this.transaction(() => {
            this.database.prepare("INSERT INTO threads (user_id, id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
              .run(userId, thread.id, thread.title ?? null, thread.createdAt, thread.updatedAt);
            const insert = this.database.prepare(`
              INSERT INTO messages (user_id, thread_id, position, role, text, created_at, artifacts)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            thread.messages.forEach((message, position) => insert.run(userId, thread.id, position, message.role, message.text,
              message.createdAt, message.artifacts ? JSON.stringify(message.artifacts) : null));
          });
        } catch {
          // A malformed legacy file must not prevent the Agent from starting.
        }
      }
    }
  }

  private transaction<T>(operation: () => T) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
