import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "./config.js";

test("loads safe defaults", () => {
  const config = loadConfig({} as NodeJS.ProcessEnv);
  assert.equal(config.pluginVersion, "1.0.0");
  assert.equal(config.port, 3100);
  assert.equal(config.aiHubUrl, "http://127.0.0.1:3000");
  assert.equal(config.hostSecret, "");
  assert.equal(config.sqlitePath, path.join(config.dataDir, "agent.sqlite"));
  assert.equal(config.imageInput, true);
  assert.equal(config.requestTimeoutMs, 240_000);
});

test("uses the plugin version supplied by the package launcher", () => {
  assert.equal(loadConfig({ AGENT_PLUGIN_VERSION: "1.0.1" }).pluginVersion, "1.0.1");
});

test("allows a custom SQLite database path", () => {
  const config = loadConfig({ AGENT_DATA_DIR: "/tmp/agent-data", AGENT_SQLITE_PATH: "/tmp/history/custom.sqlite" } as NodeJS.ProcessEnv);
  assert.equal(config.sqlitePath, "/tmp/history/custom.sqlite");
});

test("rejects an invalid port", () => {
  assert.throws(() => loadConfig({ AGENT_PORT: "0" } as NodeJS.ProcessEnv));
});
