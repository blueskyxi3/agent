import type { AgentEvent, Artifact, ContextUsage } from "@ai-hub-agent/contracts";
import { agentEventSchema } from "@ai-hub-agent/contracts";
import type { ChatModelAdapter, ThreadAssistantMessagePart } from "@assistant-ui/react";

export type PendingImage = { data: string; mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; preview: string };
export type FailedTurnDetails = {
  requestId?: string;
  characterCount: number;
  firstTokenMs?: number;
  totalMs: number;
};
export type AgentChatAdapter = ChatModelAdapter & {
  getThreadId: () => string | undefined;
  startNewThread: () => void;
  useThread: (threadId: string) => void;
};

function lastUserText(messages: Parameters<ChatModelAdapter["run"]>[0]["messages"]) {
  const message = [...messages].reverse().find((entry) => entry.role === "user");
  return message?.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "";
}

function protocolLocale(locale: string) {
  if (/^zh[-_]HK/i.test(locale)) return "zh_HK";
  if (/^zh/i.test(locale)) return "zh_CN";
  if (/^ja/i.test(locale)) return "ja_JP";
  return "en_US";
}

async function* readEvents(response: Response): AsyncGenerator<AgentEvent> {
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `请求失败 (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      if (data) yield agentEventSchema.parse(JSON.parse(data));
    }
    if (done) break;
  }
}

export function createChatAdapter(apiBasePath: string, imageSource: () => PendingImage[], onImagesConsumed: () => void, onThreadChange: (threadId: string) => void, onUsageChanged: () => void, localeSource: () => string, onContextUsage: (usage: ContextUsage) => void): AgentChatAdapter {
  let threadId: string | undefined;
  return {
    getThreadId: () => threadId,
    startNewThread: () => { threadId = undefined; },
    useThread: (nextThreadId) => { threadId = nextThreadId; onThreadChange(nextThreadId); },
    async *run({ messages, abortSignal }) {
      const startedAt = performance.now();
      const message = lastUserText(messages).trim();
      const images = imageSource();
      const response = await fetch(`${apiBasePath}/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({
          threadId,
          message,
          images: images.map(({ data, mimeType }) => ({ data, mimeType })),
          locale: protocolLocale(localeSource()),
          page: {
            path: window.location.pathname,
            query: Object.fromEntries([...new URLSearchParams(window.location.search)].slice(0, 50)),
          },
        }),
        signal: abortSignal,
      });
      onImagesConsumed();
      let reasoning = "";
      let firstTokenMs: number | undefined;
      const parts: ThreadAssistantMessagePart[] = [];
      let textIndex = -1;
      let reasoningIndex = -1;
      const toolIndexes = new Map<string, number>();
      const replacePart = (index: number, part: ThreadAssistantMessagePart) => { parts[index] = part; };
      for await (const event of readEvents(response)) {
        if (event.type === "turn.started") {
          threadId = event.threadId;
          onThreadChange(event.threadId);
        }
        if (event.type === "message.text.delta") {
          firstTokenMs ??= performance.now() - startedAt;
          if (textIndex < 0) {
            textIndex = parts.length;
            parts.push({ type: "text", text: event.delta });
          } else {
            const current = parts[textIndex];
            if (current?.type === "text") replacePart(textIndex, { type: "text", text: current.text + event.delta });
          }
        }
        if (event.type === "message.reasoning.delta") {
          firstTokenMs ??= performance.now() - startedAt;
          reasoning += event.delta;
          const part = { type: "reasoning" as const, text: reasoning };
          if (reasoningIndex < 0) {
            reasoningIndex = parts.length;
            parts.push(part);
          } else replacePart(reasoningIndex, part);
        }
        if (event.type === "tool.started") {
          textIndex = -1;
          reasoningIndex = -1;
          reasoning = "";
          toolIndexes.set(event.toolCallId, parts.length);
          parts.push({ type: "tool-call", toolCallId: event.toolCallId, toolName: event.toolName, args: event.args as never, argsText: JSON.stringify(event.args) });
        }
        if (event.type === "tool.completed" || event.type === "tool.failed") {
          const index = toolIndexes.get(event.toolCallId);
          if (index !== undefined) {
            const current = parts[index];
            if (current?.type === "tool-call") replacePart(index, { ...current, result: event.type === "tool.completed" ? event.result ?? { success: true } : event.message, isError: event.type === "tool.failed" });
          }
        }
        if (event.type === "artifact.created") {
          textIndex = -1;
          parts.push({ type: "data", name: `artifact.${event.artifact.kind}`, data: event.artifact });
        }
        if (event.type === "turn.completed") {
          if (event.metrics.contextUsage) onContextUsage(event.metrics.contextUsage);
          parts.push({ type: "data", name: "turn.metrics", data: event.metrics });
        }
        if (event.type === "turn.failed") {
          const requestId = event.requestId ? `\n\n请求 ID：${event.requestId}` : "";
          parts.push({ type: "text", text: `⚠️ ${event.message}${requestId}` });
          parts.push({
            type: "data",
            name: "turn.failure",
            data: {
              ...(event.requestId ? { requestId: event.requestId } : {}),
              characterCount: parts.filter((part) => part.type === "text").reduce((count, part) => count + [...part.text].length, 0),
              ...(firstTokenMs === undefined ? {} : { firstTokenMs }),
              totalMs: performance.now() - startedAt,
            } satisfies FailedTurnDetails,
          });
          yield { content: [...parts], status: { type: "incomplete", reason: "error", error: { message: event.message, requestId: event.requestId ?? null } } };
          onUsageChanged();
          return;
        }
        yield { content: [...parts] };
      }
      onUsageChanged();
    },
  };
}

export function isArtifact(value: unknown): value is Artifact {
  return typeof value === "object" && value !== null && "kind" in value && "version" in value;
}
