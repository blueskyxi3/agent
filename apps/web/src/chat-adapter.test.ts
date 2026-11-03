import assert from "node:assert/strict";
import test from "node:test";

import { createChatAdapter } from "./chat-adapter";

test("keeps text on each side of a tool call in event order", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { pathname: "/panel/dashboard", search: "" } },
  });
  const events = [
    { version: 1, type: "turn.started", threadId: "11111111-1111-4111-8111-111111111111" },
    { version: 1, type: "message.text.delta", delta: "调用前" },
    { version: 1, type: "tool.started", toolCallId: "tool-1", toolName: "execute_capability", args: {} },
    { version: 1, type: "tool.completed", toolCallId: "tool-1", toolName: "execute_capability", result: { ok: true } },
    { version: 1, type: "message.text.delta", delta: "调用后" },
    { version: 1, type: "turn.completed", metrics: { characterCount: 6, totalMs: 1, inputTokens: 1, outputTokens: 1, contextUsage: { tokens: 10, contextWindow: 100, percent: 10 } } },
  ];
  globalThis.fetch = async () => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  const usage: number[] = [];
  try {
    const adapter = createChatAdapter("/agent/api", () => [], () => {}, () => {}, () => {}, () => "zh_CN", (value) => usage.push(value.tokens ?? -1));
    let final: { content: readonly { type: string; text?: string }[] } | undefined;
    const stream = adapter.run({ messages: [{ role: "user", content: [{ type: "text", text: "查询" }] }], abortSignal: new AbortController().signal } as never) as AsyncGenerator<{ content: readonly { type: string; text?: string }[] }>;
    for await (const item of stream) final = item;
    assert.deepEqual(final?.content.slice(0, 3).map((part) => part.type), ["text", "tool-call", "text"]);
    assert.equal(final?.content[0]?.type === "text" && final.content[0].text, "调用前");
    assert.equal(final?.content[2]?.type === "text" && final.content[2].text, "调用后");
    assert.deepEqual(usage, [10]);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});
