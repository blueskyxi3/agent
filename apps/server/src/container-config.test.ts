import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "./config.js";

test("managed plugin configuration selects persistent SQLite and host credentials", () => {
  const root = mkdtempSync(path.join(tmpdir(), "aihub-agent-container-"));
  try {
    const file = path.join(root, "config.yaml");
    writeFileSync(file, JSON.stringify({ plugin: { id: "agent" }, server: { address: "0.0.0.0:3210" }, host: { base_url: "http://master:3000", secret: "managed-secret" }, database: { driver: "sqlite", sqlite_path: "/data/plugin/agent.sqlite" } }));
    const config = loadConfig({ AIHUB_PLUGIN_CONFIG: file, AGENT_PORT: "9999" });
    assert.equal(config.port, 3210);
    assert.equal(config.host, "0.0.0.0");
    assert.equal(config.aiHubUrl, "http://master:3000");
    assert.equal(config.hostSecret, "managed-secret");
    assert.equal(config.sqlitePath, "/data/plugin/agent.sqlite");
    assert.equal(config.dataDir, "/data/plugin");
    writeFileSync(file, JSON.stringify({ plugin: { id: "organization" }, database: { driver: "sqlite" } }));
    assert.throws(() => loadConfig({ AIHUB_PLUGIN_CONFIG: file }), /agent/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
