import { mkdir } from "node:fs/promises";

import compress from "@fastify/compress";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  agentEventSchema,
  artifactSchema,
  chatRequestSchema,
  deleteThreadsRequestSchema,
  type AgentEvent,
  type Artifact,
} from "@ai-hub-agent/contracts";

import { ActionStore } from "./action-store.js";
import { AiHubClient, AiHubRequestError, type CurrentUser } from "./aihub-client.js";
import { usageArtifact } from "./artifacts.js";
import { loadConfig, type AgentConfig } from "./config.js";
import { PiService, type RuntimeSettings } from "./pi-service.js";
import { verifyPluginIdentity } from "./plugin-identity.js";
import { ThreadStore, type StoredPart } from "./thread-store.js";

type RequestWithUser = FastifyRequest & {
  agentUser?: CurrentUser;
  agentCookie?: string;
  agentSettings?: RuntimeSettings;
};

function sendEvent(reply: FastifyReply, event: AgentEvent) {
  reply.raw.write(
    `event: ${event.type}\ndata: ${JSON.stringify(agentEventSchema.parse(event))}\n\n`,
  );
}

export function publicAgentError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("模型输出了无效的工具调用文本")) return message;
  if (message.includes("对当前用户不可用")) return message;
  if (message.includes("没有完成响应")) return message;
  if (/abort/i.test(message)) return "模型请求已取消";
  if (/令牌.*(额度|用尽|过期)|token.*(quota|expired|exhausted)/i.test(message))
    return "助手使用的 API Key 额度已用尽或已过期，请在个人设置中更换 API Key";
  if (/insufficient_user_quota|用户额度不足|余额不足|402/i.test(message))
    return "当前用户余额不足，请检查账户余额";
  if (/429|rate.limit|速率|RPM|TPM/i.test(message))
    return "模型调用触发速率限制，请稍后重试";
  if (/401|unauthorized|token|鉴权|认证/i.test(message))
    return "模型调用鉴权失败，请检查当前用户令牌和权限";
  if (/该渠道已被禁用|所选模型不属于该渠道|当前令牌无权访问该渠道|模型不支持所选能力|请先在个人设置中配置|当前用户组没有可用的文本模型渠道/.test(message))
    return message.match(/该渠道已被禁用|所选模型不属于该渠道|当前令牌无权访问该渠道|模型不支持所选能力|请先在个人设置中配置[^"\\\n]*|当前用户组没有可用的文本模型渠道/)![0];
  if (/model|模型|channel|渠道|not found/i.test(message))
    return "助手模型或渠道不可用，请检查个人设置中的助手模型与渠道";
  return "模型请求失败，请根据请求 ID 查看服务端错误日志";
}

export function resolveRequestTimeoutMs(
  status: Record<string, unknown>,
  fallbackMs: number,
) {
  const timeoutSeconds = Number(status.agent_assistant_timeout_seconds);
  return Number.isInteger(timeoutSeconds) &&
    timeoutSeconds >= 5 &&
    timeoutSeconds <= 300
    ? timeoutSeconds * 1_000
    : fallbackMs;
}

export function resolveAssistantThinkingSettings(_preferences: {
  thinking_level?: unknown;
  reasoning?: unknown;
}) {
  return { thinkingLevel: "off", reasoning: false } as const;
}

function requestOriginAllowed(request: FastifyRequest, config: AgentConfig) {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (config.allowedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

export async function buildApp(config = loadConfig()) {
  const app = Fastify({ logger: true, bodyLimit: 28 * 1024 * 1024 });
  const client = new AiHubClient(config.aiHubUrl);
  const threads = new ThreadStore(
    config.sqlitePath,
    `${config.dataDir}/threads`,
  );
  const actions = new ActionStore();
  const pi = new PiService(config, client, actions);
  const activeThreads = new Set<string>();
  const titleGenerationThreads = new Set<string>();
  app.addHook("onClose", async () => {
    await pi.close();
    threads.close();
  });
  await mkdir(config.dataDir, { recursive: true });

  await app.register(multipart, {
    limits: { files: 4, fileSize: 8 * 1024 * 1024 },
  });
  await app.register(compress);
  await app.register(fastifyStatic, {
    root: config.assetsDir,
    prefix: "/assets/",
    decorateReply: false,
  });

  app.get("/internal/manifest", async (request, reply) => {
    if (request.headers["x-aihub-plugin-secret"] !== config.hostSecret || config.hostSecret.length < 32)
      return reply.code(403).send({ success: false });
    return { id: "agent", name: "智能助手", version: config.pluginVersion, sdk_version: 2,
      extensions: ["site.global.layer"], entry: "/assets/plugin.js", backend: "agent" };
  });

  app.get("/api/v1/health", async () => ({
    success: true,
    data: { service: "ai-hub-agent", version: config.pluginVersion, contextWindow: config.contextWindow },
  }));

  app.addHook("preHandler", async (rawRequest, reply) => {
    if (
      !rawRequest.url.startsWith("/api/v1/") ||
      rawRequest.url === "/api/v1/health"
    )
      return;
    const request = rawRequest as RequestWithUser;
    const identity = verifyPluginIdentity(rawRequest, config.hostSecret);
    const delegation = request.headers["x-aihub-host-authorization"];
    if (!identity || typeof delegation !== "string" || !delegation.startsWith("aihub-delegation."))
      return reply
        .code(403)
        .send({ success: false, message: "插件请求身份无效" });
    try {
      const bootstrap = await client.getBootstrap(delegation, {});
      if (bootstrap.user.id !== identity.user_id) return reply.code(403).send({ success: false, message: "用户身份不匹配" });
      request.agentUser = bootstrap.user;
      request.agentCookie = delegation;
      const thinking = resolveAssistantThinkingSettings(bootstrap.preferences);
      const assistantName =
        typeof bootstrap.assistant.name === "string"
          ? bootstrap.assistant.name
              .trim()
              .replace(/\s+/g, " ")
              .slice(0, 32) || "小T"
          : "小T";
      const requestTimeoutMs = resolveRequestTimeoutMs(
        { agent_assistant_timeout_seconds: bootstrap.assistant.timeout_seconds },
        config.requestTimeoutMs,
      );
      request.agentSettings = {
        protocolVersion: bootstrap.versions.protocol_version,
        model: bootstrap.preferences.text_model,
        assistantName,
        thinkingLevel: thinking.thinkingLevel,
        reasoning: thinking.reasoning,
        requestTimeoutMs,
      };
    } catch (error) {
      if (error instanceof AiHubRequestError && (error.status === 403 || error.status === 404)) {
        return reply.code(error.status).send({ success: false, message: error.message });
      }
      return reply
        .code(401)
        .send({ success: false, message: "登录已失效，请重新登录" });
    }
  });

  app.post("/api/v1/chat", async (rawRequest, reply) => {
    const request = rawRequest as RequestWithUser;
    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({
          success: false,
          message: parsed.error.issues[0]?.message ?? "请求参数无效",
        });
    const user = request.agentUser!;
    const thread = await threads.getOrCreate(user.id, parsed.data.threadId);
    const activeKey = `${user.id}:${thread.id}`;
    if (activeThreads.has(activeKey))
      return reply
        .code(409)
        .send({ success: false, message: "此会话正在执行，请等待完成" });
    activeThreads.add(activeKey);
    try {
      await threads.append(thread, {
        role: "user",
        text: parsed.data.message,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      activeThreads.delete(activeKey);
      throw error;
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    let completed = false;
    reply.raw.once("close", () => {
      if (!completed) pi.abort(user.id, thread.id);
    });
    let assistantText = "";
    const assistantArtifacts: Artifact[] = [];
    const assistantParts: StoredPart[] = [];
    const toolIndexes = new Map<string, number>();
    sendEvent(reply, { version: 1, type: "turn.started", threadId: thread.id });
    try {
      const metrics = await client.context.run({}, () =>
        pi.run(
          user,
          request.agentCookie!,
          parsed.data,
          thread.id,
          request.agentSettings!,
          (event) => {
            if (event.type === "message.text.delta") {
              assistantText += event.delta;
              const last = assistantParts.at(-1);
              if (last?.type === "text") last.text += event.delta;
              else assistantParts.push({ type: "text", text: event.delta });
            }
            if (event.type === "tool.started") {
              toolIndexes.set(event.toolCallId, assistantParts.length);
              assistantParts.push({ type: "tool", toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
            }
            if (event.type === "tool.completed" || event.type === "tool.failed") {
              const index = toolIndexes.get(event.toolCallId);
              const part = index === undefined ? undefined : assistantParts[index];
              if (part?.type === "tool") {
                part.result = event.type === "tool.completed" ? event.result ?? { success: true } : event.message;
                part.isError = event.type === "tool.failed";
              }
            }
            if (event.type === "artifact.created")
              assistantArtifacts.push(event.artifact);
            if (event.type === "artifact.created")
              assistantParts.push({ type: "artifact", artifact: event.artifact });
            if (
              event.type === "artifact.created" &&
              event.artifact.kind === "suggestions"
            )
              return;
            sendEvent(reply, event);
          },
        ),
      );
      if (assistantText || assistantArtifacts.length) {
        await threads.append(thread, {
          role: "assistant",
          text: assistantText,
          createdAt: new Date().toISOString(),
          ...(assistantArtifacts.length
            ? { artifacts: assistantArtifacts }
            : {}),
          parts: assistantParts,
        });
      }
      const suggestions = assistantArtifacts.find(
        (artifact) => artifact.kind === "suggestions",
      );
      if (suggestions)
        sendEvent(reply, {
          version: 1,
          type: "artifact.created",
          artifact: suggestions,
        });
      sendEvent(reply, {
        version: 1,
        type: "turn.completed",
        metrics: { ...metrics, characterCount: [...assistantText].length },
      });
      if (
        !thread.title &&
        assistantText &&
        !titleGenerationThreads.has(activeKey)
      ) {
        const firstMessage = thread.messages.find(
          (message) => message.role === "user",
        )?.text;
        if (firstMessage) {
          titleGenerationThreads.add(activeKey);
          void client.context
            .run({}, () =>
              client.generateThreadTitle(
                request.agentCookie!,
                parsed.data.message,
                assistantText,
              ),
            )
            .then((title) => threads.setTitle(thread, title, firstMessage))
            .catch((error) =>
              request.log.warn(
                { err: error, requestId: request.id },
                "agent thread title generation failed",
              ),
            )
            .finally(() => titleGenerationThreads.delete(activeKey));
        }
      }
    } catch (error) {
      request.log.error(
        { err: error, requestId: request.id },
        "agent turn failed",
      );
      sendEvent(reply, {
        version: 1,
        type: "turn.failed",
        message: publicAgentError(error),
        requestId: request.id,
      });
    } finally {
      completed = true;
      activeThreads.delete(activeKey);
      reply.raw.end();
    }
  });

  app.get<{ Querystring: { locale?: string } }>(
    "/api/v1/role-guide",
    async (rawRequest) => {
      const request = rawRequest as RequestWithUser;
      const locale = ["zh_CN", "zh_HK", "en_US", "ja_JP"].includes(
        rawRequest.query.locale ?? "",
      )
        ? rawRequest.query.locale!
        : "zh_CN";
      return {
        success: true,
        data: await client.getRoleGuide(request.agentCookie!, locale),
      };
    },
  );

  app.get("/api/v1/threads", async (rawRequest) => {
    const request = rawRequest as RequestWithUser;
    return { success: true, data: await threads.list(request.agentUser!.id) };
  });

  app.post("/api/v1/threads/batch-delete", async (rawRequest, reply) => {
    const request = rawRequest as RequestWithUser;
    const parsed = deleteThreadsRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({
          success: false,
          message: parsed.error.issues[0]?.message ?? "请求参数无效",
        });
    const threadIds = [...new Set(parsed.data.threadIds)];
    const userId = request.agentUser!.id;
    if (
      threadIds.some((threadId) => activeThreads.has(`${userId}:${threadId}`))
    ) {
      return reply
        .code(409)
        .send({ success: false, message: "请先停止正在生成回复的对话" });
    }
    const deleted = await threads.deleteMany(userId, threadIds);
    const cleanup = await Promise.allSettled(
      threadIds.map((threadId) => pi.reset(userId, threadId)),
    );
    cleanup.forEach((result, index) => {
      if (result.status === "rejected")
        request.log.warn(
          { err: result.reason, threadId: threadIds[index] },
          "agent thread context cleanup failed",
        );
    });
    return { success: true, data: { deleted } };
  });

  app.get<{ Params: { threadId: string } }>(
    "/api/v1/threads/:threadId",
    async (rawRequest) => {
      const request = rawRequest as RequestWithUser;
      const thread = await threads.getOrCreate(
        request.agentUser!.id,
        rawRequest.params.threadId,
      );
      return {
        success: true,
        data: {
          ...thread,
          contextUsage: await pi.getContextUsage(request.agentUser!.id, thread.id),
        },
      };
    },
  );

  app.get<{ Params: { threadId: string; workflowId: string } }>(
    "/api/v1/threads/:threadId/page-workflows/:workflowId",
    async (rawRequest, reply) => {
      const request = rawRequest as RequestWithUser;
      const found = await threads.pageWorkflow(request.agentUser!.id, rawRequest.params.threadId, rawRequest.params.workflowId);
      if (!found) return reply.code(404).send({ success: false, message: "工作流不存在" });
      return { success: true, data: found.artifact };
    },
  );

  app.patch<{ Params: { threadId: string; workflowId: string }; Body: { step?: string; name?: string; recordId?: number } }>(
    "/api/v1/threads/:threadId/page-workflows/:workflowId",
    async (rawRequest, reply) => {
      const request = rawRequest as RequestWithUser;
      const { step, name, recordId } = rawRequest.body ?? {};
      if (!step || !["naming", "review", "submitting", "completed", "failed", "cancelled"].includes(step) ||
          (name !== undefined && (typeof name !== "string" || !name.trim() || name.length > 64)) ||
          (recordId !== undefined && (!Number.isSafeInteger(recordId) || recordId < 1)) ||
          (step === "completed" && !recordId) || (step === "review" && !name))
        return reply.code(400).send({ success: false, message: "工作流状态无效" });
      try {
        const artifact = await threads.updatePageWorkflow(request.agentUser!.id, rawRequest.params.threadId, rawRequest.params.workflowId, {
          step: step as "naming" | "review" | "submitting" | "completed" | "failed" | "cancelled",
          ...(name ? { name: name.trim() } : {}), ...(recordId ? { recordId } : {}),
        });
        if (!artifact) return reply.code(404).send({ success: false, message: "工作流不存在" });
        return { success: true, data: artifact };
      } catch (error) {
        return reply.code(409).send({ success: false, message: error instanceof Error ? error.message : "工作流状态已变化" });
      }
    },
  );

  app.delete<{ Params: { threadId: string } }>(
    "/api/v1/threads/:threadId",
    async (rawRequest, reply) => {
      const request = rawRequest as RequestWithUser;
      const parsed = deleteThreadsRequestSchema.safeParse({
        threadIds: [rawRequest.params.threadId],
      });
      if (!parsed.success)
        return reply
          .code(400)
          .send({ success: false, message: "无效的会话 ID" });
      const threadId = parsed.data.threadIds[0]!;
      const userId = request.agentUser!.id;
      if (activeThreads.has(`${userId}:${threadId}`)) {
        return reply
          .code(409)
          .send({ success: false, message: "请先停止正在生成回复的对话" });
      }
      const deleted = await threads.delete(userId, threadId);
      if (!deleted)
        return reply
          .code(404)
          .send({ success: false, message: "会话不存在或无权访问" });
      try {
        await pi.reset(userId, threadId);
      } catch (error) {
        request.log.warn(
          { err: error, threadId },
          "agent thread context cleanup failed",
        );
      }
      return { success: true, data: { deleted: 1 } };
    },
  );

  app.post<{ Params: { threadId: string } }>(
    "/api/v1/threads/:threadId/clear",
    async (rawRequest) => {
      const request = rawRequest as RequestWithUser;
      if (
        activeThreads.has(
          `${request.agentUser!.id}:${rawRequest.params.threadId}`,
        )
      )
        throw new Error("请先停止当前对话");
      await pi.reset(request.agentUser!.id, rawRequest.params.threadId);
      await threads.clear(request.agentUser!.id, rawRequest.params.threadId);
      return { success: true };
    },
  );

  app.post<{ Params: { threadId: string } }>(
    "/api/v1/threads/:threadId/abort",
    async (rawRequest) => {
      const request = rawRequest as RequestWithUser;
      pi.abort(request.agentUser!.id, rawRequest.params.threadId);
      return { success: true };
    },
  );

  app.get("/api/v1/models", async (rawRequest) => {
    const request = rawRequest as RequestWithUser;
    return {
      success: true,
      data: await client.request(
        "/api/user/self/assistant/model-options",
        request.agentCookie!,
      ),
    };
  });

  app.post<{ Params: { actionId: string } }>(
    "/api/v1/actions/:actionId/execute",
    async (rawRequest, reply) => {
      const request = rawRequest as RequestWithUser;
      const action = actions.consume(
        rawRequest.params.actionId,
        request.agentUser!.id,
      );
      if (!action)
        return reply
          .code(404)
          .send({ success: false, message: "操作不存在、已执行或已过期" });
      if (action.type === "refresh_usage") {
        const artifact = artifactSchema.parse(
          usageArtifact(await client.getUsage(request.agentCookie!)),
        );
        return { success: true, artifact };
      }
      return reply.code(400).send({ success: false, message: "不支持的操作" });
    },
  );

  return app;
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain || process.env.AGENT_START_SERVER === "1") {
  const config = loadConfig();
  const app = await buildApp(config);
  await app.listen({ host: config.host, port: config.port });
}
