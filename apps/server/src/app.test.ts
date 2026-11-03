import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildApp,
  publicAgentError,
  resolveAssistantThinkingSettings,
  resolveRequestTimeoutMs,
} from "./app.js";
import { loadConfig } from "./config.js";

test("uses the system assistant timeout with a safe fallback", () => {
  assert.equal(
    resolveRequestTimeoutMs({ agent_assistant_timeout_seconds: 120 }, 60_000),
    120_000,
  );
  assert.equal(
    resolveRequestTimeoutMs({ agent_assistant_timeout_seconds: "300" }, 60_000),
    300_000,
  );
  assert.equal(
    resolveRequestTimeoutMs({ agent_assistant_timeout_seconds: 301 }, 240_000),
    240_000,
  );
  assert.equal(resolveRequestTimeoutMs({}, 240_000), 240_000);
});

test("always disables assistant reasoning for legacy preferences", () => {
  assert.deepEqual(
    resolveAssistantThinkingSettings({
      thinking_level: "xhigh",
      reasoning: true,
    }),
    {
      thinkingLevel: "off",
      reasoning: false,
    },
  );
});

test("reports the actual assistant failure category without assuming user balance is empty", () => {
  assert.equal(publicAgentError(new Error("403 {\"message\":\"该渠道已被禁用\"}")), "该渠道已被禁用");
  assert.match(publicAgentError(new Error("403 {\"message\":\"令牌额度已用尽\"}")), /API Key 额度/);
  assert.match(publicAgentError(new Error("402 insufficient_user_quota")), /用户余额不足/);
  assert.match(publicAgentError(new Error("Provider returned an error stop reason")), /请求 ID/);
});
import { ThreadStore } from "./thread-store.js";

function pluginHeaders(secret: string, method: string, uri: string) {
  const payload = Buffer.from(
    JSON.stringify({
      user_id: 7, plugin_id: "agent", method, uri,
      expires_at: Math.floor(Date.now() / 1000) + 30,
    }),
  ).toString("base64url");
  return {
    "x-aihub-identity": `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`,
    "x-aihub-host-authorization": "aihub-delegation.test",
  };
}

test("serves health and protects agent APIs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-hub-agent-app-test-"));
  const assetsDir = path.join(root, "assets");
  const bundle = "export const assistant = true;\n".repeat(2_000);
  await mkdir(assetsDir);
  await writeFile(path.join(assetsDir, "assistant-embed.js"), bundle);
  const app = await buildApp(
    loadConfig({
      AGENT_DATA_DIR: path.join(root, "data"),
      AGENT_ASSETS_DIR: assetsDir,
    } as NodeJS.ProcessEnv),
  );
  try {
    const health = await app.inject({
      method: "GET",
      url: "/api/v1/health",
    });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().data.service, "ai-hub-agent");
    assert.equal(health.json().data.contextWindow, 128_000);

    const assistantBundle = await app.inject({
      method: "GET",
      url: "/assets/assistant-embed.js",
      headers: { "accept-encoding": "gzip" },
    });
    assert.equal(assistantBundle.statusCode, 200);
    assert.equal(assistantBundle.headers["content-encoding"], "gzip");
    assert.match(assistantBundle.headers.vary ?? "", /accept-encoding/i);
    assert.ok(assistantBundle.rawPayload.length < Buffer.byteLength(bundle));

    const protectedResponse = await app.inject({
      method: "POST",
      url: "/api/v1/actions/00000000-0000-0000-0000-000000000000/execute",
    });
    assert.equal(protectedResponse.statusCode, 403);

    const unsignedResponse = await app.inject({
      method: "POST",
      url: "/api/v1/actions/00000000-0000-0000-0000-000000000000/execute",
      headers: { cookie: "session=test" },
    });
    assert.equal(unsignedResponse.statusCode, 403);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("reports the package version in the protected manifest and health endpoint", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-hub-agent-version-test-"));
  const secret = "version-test-secret".padEnd(32, "-");
  const app = await buildApp(loadConfig({
    AGENT_DATA_DIR: root,
    AGENT_PLUGIN_VERSION: "1.0.1",
    AGENT_HOST_SECRET: secret,
  }));
  try {
    const denied = await app.inject({ method: "GET", url: "/internal/manifest" });
    assert.equal(denied.statusCode, 403);
    const manifest = await app.inject({
      method: "GET", url: "/internal/manifest", headers: { "x-aihub-plugin-secret": secret },
    });
    assert.equal(manifest.statusCode, 200);
    assert.equal(manifest.json().version, "1.0.1");
    const health = await app.inject({ method: "GET", url: "/api/v1/health" });
    assert.equal(health.json().data.version, "1.0.1");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a forged plugin identity before calling AI Hub", async () => {
  const app = await buildApp(
    loadConfig({
      AGENT_DATA_DIR: "/tmp/ai-hub-agent-context-test",
      AGENT_HOST_SECRET: "s".repeat(32),
    } as NodeJS.ProcessEnv),
  );
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/threads",
      headers: {
        "x-aihub-identity": "forged.0",
        "x-aihub-host-authorization": "aihub-delegation.test",
      },
    });
    assert.equal(response.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("deletes single and batch conversation history through protected APIs", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "ai-hub-agent-delete-api-"),
  );
  const databasePath = path.join(root, "agent.sqlite");
  const secret = "delete-test-secret".padEnd(32, "-");
  const seed = new ThreadStore(databasePath);
  const first = await seed.getOrCreate(7);
  const second = await seed.getOrCreate(7);
  const anotherUser = await seed.getOrCreate(8);
  seed.close();

  const originalFetch = globalThis.fetch;
  const requestedPaths: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    requestedPaths.push(url.pathname);
    if (url.pathname === "/api/user/self/assistant/bootstrap") {
      const forwarded = new Headers(init?.headers);
      assert.equal(forwarded.get("authorization"), "Bearer aihub-delegation.test");
      assert.equal(forwarded.get("x-aihub-plugin-id"), "agent");
    }
    const data =
      url.pathname === "/api/user/self/assistant/bootstrap"
        ? {
            user: { id: 7, username: "tester", role: 1 },
            assistant: { name: "小T", timeout_seconds: 240 },
            preferences: { text_model: "test-model", thinking_level: "off", reasoning: false },
            versions: { protocol_version: 1, catalog_version: "catalog", content_version: "content" },
          }
        : url.pathname === "/api/user/self/assistant/role-guide"
            ? {
                role: "common",
                version: "v1",
                title: "User guide",
                summary: "Summary",
                capabilities: [],
                starter_questions: ["Question one", "Question two"],
              }
            : {
                enabled: true,
                token_id: 1,
                text_model: "test-model",
                rename_model: "",
                thinking_level: "off",
                reasoning: false,
                voice_input: false,
                voice_output: false,
              };
    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const app = await buildApp(
    loadConfig({
      AGENT_DATA_DIR: root,
      AGENT_SQLITE_PATH: databasePath,
      AGENT_HOST_SECRET: secret,
      AIHUB_INTERNAL_URL: "http://ai-hub.test",
    } as NodeJS.ProcessEnv),
  );
  const headers = (method: string, uri: string) => pluginHeaders(secret, method, uri);
  try {
    const guide = await app.inject({
      method: "GET",
      url: "/api/v1/role-guide?locale=en_US",
      headers: headers("GET", "/api/v1/role-guide?locale=en_US"),
    });
    assert.equal(guide.statusCode, 200);
    assert.deepEqual(guide.json().data.starter_questions, [
      "Question one",
      "Question two",
    ]);

    const existing = await app.inject({
      method: "GET",
      url: `/api/v1/threads/${second.id}`,
      headers: headers("GET", `/api/v1/threads/${second.id}`),
    });
    assert.deepEqual(existing.json().data.contextUsage, { tokens: null, contextWindow: 128_000, percent: null });
    const contextDirectory = path.join(root, "contexts", "7");
    await mkdir(contextDirectory, { recursive: true });
    await writeFile(path.join(contextDirectory, `${second.id}.json`), JSON.stringify({
      version: 2,
      messages: [],
      contextUsage: { tokens: 42, contextWindow: 128_000, percent: 42 / 128_000 * 100 },
    }));
    const restored = await app.inject({ method: "GET", url: `/api/v1/threads/${second.id}`, headers: headers("GET", `/api/v1/threads/${second.id}`) });
    assert.equal(restored.json().data.contextUsage.tokens, 42);

    const single = await app.inject({
      method: "DELETE",
      url: `/api/v1/threads/${first.id}`,
      headers: headers("DELETE", `/api/v1/threads/${first.id}`),
    });
    assert.equal(single.statusCode, 200);
    assert.equal(single.json().data.deleted, 1);

    const missing = await app.inject({
      method: "DELETE",
      url: `/api/v1/threads/${first.id}`,
      headers: headers("DELETE", `/api/v1/threads/${first.id}`),
    });
    assert.equal(missing.statusCode, 404);

    const batch = await app.inject({
      method: "POST",
      url: "/api/v1/threads/batch-delete",
      headers: { ...headers("POST", "/api/v1/threads/batch-delete"), "content-type": "application/json" },
      payload: { threadIds: [second.id, anotherUser.id] },
    });
    assert.equal(batch.statusCode, 200);
    assert.equal(batch.json().data.deleted, 1);
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/threads",
      headers: headers("GET", "/api/v1/threads"),
    });
    assert.deepEqual(list.json().data, []);
    assert.equal(requestedPaths.filter((path) => path === "/api/user/self/assistant/bootstrap").length, 7);
    assert.equal(requestedPaths.filter((path) => path === "/api/user/self").length, 0);
    assert.equal(requestedPaths.filter((path) => path === "/api/status").length, 0);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
  }

  const verify = new ThreadStore(databasePath);
  try {
    assert.equal(
      (await verify.getOrCreate(8, anotherUser.id)).id,
      anotherUser.id,
    );
  } finally {
    verify.close();
    await rm(root, { recursive: true, force: true });
  }
});
