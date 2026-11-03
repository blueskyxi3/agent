import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const agentRoot = fileURLToPath(new URL("../../..", import.meta.url));

export type AgentConfig = ReturnType<typeof loadConfig>;

function booleanValue(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return value === "true" || value === "1";
}

export function loadConfig(env = process.env) {
  if (env.AIHUB_PLUGIN_CONFIG) {
    const config = JSON.parse(readFileSync(env.AIHUB_PLUGIN_CONFIG, "utf8")) as {
      plugin?: { id?: string };
      server?: { address?: string };
      host?: { base_url?: string; secret?: string };
      database?: { driver?: string; sqlite_path?: string };
    };
    if (config.plugin?.id !== "agent" || config.database?.driver !== "sqlite") throw new Error("智能助手容器配置必须为 agent 和独立 SQLite");
    const address = config.server?.address ?? "0.0.0.0:3100";
    const separator = address.lastIndexOf(":");
    const sqlitePath = config.database.sqlite_path ?? "/data/plugin/agent.sqlite";
    env = { ...env, AGENT_HOST: address.slice(0, separator), AGENT_PORT: address.slice(separator + 1),
      AGENT_HOST_SECRET: config.host?.secret ?? "", AIHUB_INTERNAL_URL: config.host?.base_url ?? "",
      AGENT_SQLITE_PATH: sqlitePath, AGENT_DATA_DIR: path.dirname(sqlitePath) };
  }
  const port = Number(env.AGENT_PORT ?? 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("AGENT_PORT 无效");
  const requestTimeoutMs = Number(env.AGENT_REQUEST_TIMEOUT_MS ?? 240_000);
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 5_000 || requestTimeoutMs > 300_000) throw new Error("AGENT_REQUEST_TIMEOUT_MS 必须在 5000 到 300000 之间");
  const dataDir = path.resolve(env.AGENT_DATA_DIR ?? path.join(agentRoot, "data"));
  return {
    pluginVersion: env.AGENT_PLUGIN_VERSION ?? "1.1.1",
    host: env.AGENT_HOST ?? "0.0.0.0",
    port,
    aiHubUrl: (env.AIHUB_INTERNAL_URL ?? "http://127.0.0.1:3000").replace(/\/$/, ""),
    hostSecret: env.AGENT_HOST_SECRET ?? "",
    dataDir,
    sqlitePath: path.resolve(env.AGENT_SQLITE_PATH ?? path.join(dataDir, "agent.sqlite")),
    assetsDir: path.resolve(env.AGENT_ASSETS_DIR ?? path.join(agentRoot, "apps/web/dist")),
    imageInput: booleanValue(env.AGENT_MODEL_IMAGE_INPUT, true),
    contextWindow: Number(env.AGENT_MODEL_CONTEXT_WINDOW ?? 128_000),
    maxTokens: Number(env.AGENT_MODEL_MAX_TOKENS ?? 8_192),
    requestTimeoutMs,
    allowedOrigins: (env.AGENT_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  };
}
