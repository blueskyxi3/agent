import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { Artifact } from "@ai-hub-agent/contracts";

import {
  normalizeThreadTitle,
  ThreadStore,
  type StoredThread,
} from "./thread-store.js";

test("persists one API Key page workflow and blocks repeat submission", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-hub-page-workflow-"));
  const store = new ThreadStore(path.join(root, "agent.sqlite"));
  try {
    const thread = await store.getOrCreate(7);
    const artifact: Artifact = { kind: "page_workflow", version: 1, workflowId: randomUUID(), expiresAt: Date.now() + 60_000, operationId: "post.api.token", step: "start", allowedActions: ["open", "fill", "read", "submit", "cancel"] };
    await store.append(thread, { role: "assistant", text: "", createdAt: new Date().toISOString(), artifacts: [artifact], parts: [{ type: "artifact", artifact }] });
    await assert.rejects(store.pageWorkflow(8, thread.id, artifact.workflowId), /无权访问/);
    await store.updatePageWorkflow(7, thread.id, artifact.workflowId, { step: "naming" });
    await store.updatePageWorkflow(7, thread.id, artifact.workflowId, { step: "review", name: "my-api-key" });
    await store.updatePageWorkflow(7, thread.id, artifact.workflowId, { step: "submitting" });
    await assert.rejects(store.updatePageWorkflow(7, thread.id, artifact.workflowId, { step: "submitting" }), /状态已变化/);
    await store.updatePageWorkflow(7, thread.id, artifact.workflowId, { step: "completed", recordId: 42 });
    const saved = await store.pageWorkflow(7, thread.id, artifact.workflowId);
    assert.equal(saved?.artifact.step, "completed");
    assert.equal(saved?.artifact.recordId, 42);
    assert.equal(saved?.message.parts?.[0]?.type === "artifact" && saved.message.parts[0].artifact.kind === "page_workflow" && saved.message.parts[0].artifact.step, "completed");
    await assert.rejects(store.updatePageWorkflow(7, thread.id, artifact.workflowId, { step: "submitting" }), /状态已变化/);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("lists, restores, and clears a user's conversations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-hub-agent-threads-"));
  const databasePath = path.join(root, "agent.sqlite");
  let store = new ThreadStore(databasePath);
  try {
    const thread = await store.getOrCreate(7);
    const link: Artifact = {
      kind: "link",
      version: 1,
      title: "前往 AI Hub",
      label: "打开页面",
      href: "/panel/token",
    };
    const suggestions: Artifact = {
      kind: "suggestions",
      version: 1,
      questions: ["查看最近日志", "分析本周消费"],
    };
    await store.append(thread, {
      role: "user",
      text: "打开仪表盘",
      createdAt: new Date().toISOString(),
    });
    await store.append(thread, {
      role: "assistant",
      text: "好的",
      createdAt: new Date().toISOString(),
      artifacts: [link, suggestions],
      parts: [
        { type: "text", text: "我先查询。" },
        { type: "tool", toolCallId: "tool-1", toolName: "execute_capability", args: { operation_id: "get.api.analytics.period" }, result: { success: true } },
        { type: "text", text: "好的" },
        { type: "artifact", artifact: link },
        { type: "artifact", artifact: suggestions },
      ],
    });

    const list = await store.list(7);
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, thread.id);
    assert.equal(list[0]?.title, "打开仪表盘");
    assert.equal(list[0]?.messageCount, 2);
    assert.deepEqual(
      (await store.getOrCreate(7, thread.id)).messages[1]?.artifacts,
      [link, suggestions],
    );
    assert.deepEqual((await store.getOrCreate(7, thread.id)).messages[1]?.parts?.map((part) => part.type), ["text", "tool", "text", "artifact", "artifact"]);
    await assert.rejects(store.getOrCreate(8, thread.id), /不存在或无权访问/);

    await store.setTitle(thread, "《查看账号仪表盘。》");
    assert.equal((await store.list(7))[0]?.title, "查看账号仪表盘");

    store.close();
    store = new ThreadStore(databasePath);
    assert.equal((await store.getOrCreate(7, thread.id)).messages.length, 2);
    assert.equal((await store.getOrCreate(7, thread.id)).messages[1]?.parts?.[1]?.type, "tool");

    await store.clear(7, thread.id);
    assert.deepEqual((await store.getOrCreate(7, thread.id)).messages, []);
    await store.setTitle(thread, "不应恢复的旧标题", "打开仪表盘");
    assert.equal((await store.list(7))[0]?.title, "新会话");
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("migrates legacy JSON conversations only once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-hub-agent-migration-"));
  const legacyRoot = path.join(root, "threads");
  const userDirectory = path.join(legacyRoot, "7");
  const id = randomUUID();
  const now = new Date().toISOString();
  await mkdir(userDirectory, { recursive: true });
  await writeFile(
    path.join(userDirectory, `${id}.json`),
    JSON.stringify({
      id,
      userId: 7,
      title: "旧会话",
      createdAt: now,
      updatedAt: now,
      messages: [{ role: "user", text: "旧消息", createdAt: now }],
    } satisfies StoredThread),
  );

  const databasePath = path.join(root, "agent.sqlite");
  let store = new ThreadStore(databasePath, legacyRoot);
  try {
    assert.equal((await store.getOrCreate(7, id)).messages[0]?.text, "旧消息");
    store.close();
    store = new ThreadStore(databasePath, legacyRoot);
    assert.equal((await store.list(7))[0]?.messageCount, 1);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("adds ordered parts to an existing database without changing old messages", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-hub-agent-parts-migration-"));
  const databasePath = path.join(root, "agent.sqlite");
  const id = randomUUID();
  const now = new Date().toISOString();
  const old = new DatabaseSync(databasePath);
  old.exec("CREATE TABLE threads (user_id INTEGER, id TEXT, title TEXT, created_at TEXT, updated_at TEXT); CREATE TABLE messages (user_id INTEGER, thread_id TEXT, position INTEGER, role TEXT, text TEXT, created_at TEXT, artifacts TEXT)");
  old.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?)").run(7, id, null, now, now);
  old.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)").run(7, id, 0, "assistant", "旧回复", now, null);
  old.close();
  const store = new ThreadStore(databasePath);
  try {
    const thread = await store.getOrCreate(7, id);
    assert.equal(thread.messages[0]?.text, "旧回复");
    assert.equal(thread.messages[0]?.parts, undefined);
    await store.append(thread, { role: "assistant", text: "新回复", createdAt: now, parts: [{ type: "text", text: "新回复" }] });
    assert.deepEqual((await store.getOrCreate(7, id)).messages[1]?.parts, [{ type: "text", text: "新回复" }]);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("deletes one or many conversations within the owning user", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-hub-agent-delete-"));
  const store = new ThreadStore(path.join(root, "agent.sqlite"));
  try {
    const first = await store.getOrCreate(7);
    const second = await store.getOrCreate(7);
    const third = await store.getOrCreate(7);
    const anotherUser = await store.getOrCreate(8);
    await store.append(first, {
      role: "user",
      text: "第一条",
      createdAt: new Date().toISOString(),
    });
    await store.append(second, {
      role: "user",
      text: "第二条",
      createdAt: new Date().toISOString(),
    });

    assert.equal(await store.delete(7, first.id), true);
    await assert.rejects(store.getOrCreate(7, first.id), /不存在或无权访问/);
    assert.equal((await store.list(7)).length, 2);

    assert.equal(
      await store.deleteMany(7, [
        second.id,
        third.id,
        second.id,
        anotherUser.id,
      ]),
      2,
    );
    assert.deepEqual(await store.list(7), []);
    assert.equal(
      (await store.getOrCreate(8, anotherUser.id)).id,
      anotherUser.id,
    );
    assert.equal(await store.delete(7, anotherUser.id), false);
    await assert.rejects(store.deleteMany(7, []), /1 至 100/);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("normalizes generated conversation titles", () => {
  assert.equal(
    normalizeThreadTitle("  “查询 API Key 用量。”  "),
    "查询 API Key 用量",
  );
  assert.equal(
    normalizeThreadTitle("标题：额度使用情况\n这是解释"),
    "额度使用情况",
  );
  assert.equal([...normalizeThreadTitle("一".repeat(50))].length, 36);
});
