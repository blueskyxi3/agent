import assert from "node:assert/strict";
import test from "node:test";

import {
  agentEventSchema,
  artifactSchema,
  chatRequestSchema,
  deleteThreadsRequestSchema,
} from "./index.js";

test("accepts supported artifacts", () => {
  assert.equal(
    artifactSchema.parse({
      kind: "link",
      version: 1,
      title: "控制台",
      label: "打开",
      href: "/console",
    }).kind,
    "link",
  );
});

test("only accepts registered API Key page workflows", () => {
  const workflow = { kind: "page_workflow", version: 1, workflowId: "123e4567-e89b-42d3-a456-426614174000", expiresAt: Date.now() + 60_000, operationId: "post.api.token", step: "start", allowedActions: ["open", "fill", "read", "submit", "cancel"] };
  assert.equal(artifactSchema.parse(workflow).kind, "page_workflow");
  assert.equal(artifactSchema.safeParse({ ...workflow, operationId: "post.api.channel" }).success, false);
  assert.equal(artifactSchema.safeParse({ ...workflow, allowedActions: ["click_anything"] }).success, false);
});

test("accepts exactly two distinct suggested questions", () => {
  assert.equal(
    artifactSchema.parse({
      kind: "suggestions",
      version: 1,
      questions: ["查看最近七天消费？", "按模型生成消费图表？"],
    }).kind,
    "suggestions",
  );
  assert.equal(
    artifactSchema.safeParse({
      kind: "suggestions",
      version: 1,
      questions: ["只有一个问题？"],
    }).success,
    false,
  );
  assert.equal(
    artifactSchema.safeParse({
      kind: "suggestions",
      version: 1,
      questions: ["重复问题？", "重复问题？"],
    }).success,
    false,
  );
});

test("accepts donut charts and rejects unknown chart types", () => {
  const chart = {
    kind: "chart",
    version: 1,
    title: "模型消费占比",
    chartType: "donut",
    unit: "¥",
    labels: ["gpt-a", "gpt-b"],
    values: [12.25, 49.610191],
    sourceId: "5f30cf4c-7443-4d4f-9f5d-c82cdb98b271",
    complete: true,
    generatedAt: "2026-09-14T00:00:00Z",
  };
  assert.equal(artifactSchema.parse(chart).kind, "chart");
  assert.equal(
    artifactSchema.safeParse({ ...chart, chartType: "radar" }).success,
    false,
  );
});

test("validates parameter forms and rejects sensitive prefilled values", () => {
  const form = {
    kind: "parameter_form",
    version: 1,
    formId: "123e4567-e89b-42d3-a456-426614174000",
    operationId: "get.api.analytics.user_self_usage",
    title: "查询用量",
    effect: "read",
    risk: "low",
    parameters: { path: {}, query: {}, body: {} },
    fields: [
      {
        location: "query",
        path: "query.start_time",
        name: "start_time",
        label: "开始时间",
        input: "text",
        required: true,
      },
    ],
  };
  assert.equal(artifactSchema.parse(form).kind, "parameter_form");
  assert.equal(
    artifactSchema.safeParse({
      ...form,
      fields: [{ ...form.fields[0], path: "../secret" }],
    }).success,
    false,
  );
  assert.equal(
    artifactSchema.safeParse({
      ...form,
      fields: [{ ...form.fields[0], sensitive: true, value: "secret" }],
    }).success,
    false,
  );
  const guided = artifactSchema.parse({
    ...form,
    mode: "guided_confirm",
    fields: [
      {
        location: "body",
        path: "body.models",
        name: "models",
        label: "模型",
        input: "multiselect",
        required: true,
        browser_only: true,
        options_source: "channel.provider_models",
        depends_on: ["body.type"],
        options: [{ label: "GPT-4o", value: "gpt-4o" }],
      },
    ],
  });
  assert.equal(guided.kind, "parameter_form");
  if (guided.kind === "parameter_form")
    assert.equal(guided.mode, "guided_confirm");
  assert.equal(
    artifactSchema.safeParse({
      ...form,
      page: "https://attacker.example/form",
    }).success,
    false,
  );
});

test("rejects arbitrary action commands", () => {
  assert.equal(
    artifactSchema.safeParse({
      kind: "action",
      version: 1,
      title: "run",
      label: "run",
      command: "rm -rf /",
    }).success,
    false,
  );
});

test("validates chat and stream events", () => {
  assert.equal(chatRequestSchema.parse({ message: "hello" }).images.length, 0);
  assert.equal(
    chatRequestSchema.parse({
      message: "hello",
      page: { path: "/panel/log", query: { user: "admin" } },
    }).page?.path,
    "/panel/log",
  );
  assert.equal(
    agentEventSchema.parse({
      version: 1,
      type: "turn.completed",
      metrics: {
        characterCount: 2,
        totalMs: 12,
        inputTokens: 3,
        outputTokens: 4,
        contextUsage: { tokens: null, contextWindow: 128_000, percent: null },
      },
    }).type,
    "turn.completed",
  );
});

test("limits batch conversation deletion requests", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  assert.deepEqual(
    deleteThreadsRequestSchema.parse({ threadIds: [id] }).threadIds,
    [id],
  );
  assert.equal(
    deleteThreadsRequestSchema.safeParse({ threadIds: [] }).success,
    false,
  );
  assert.equal(
    deleteThreadsRequestSchema.safeParse({
      threadIds: Array.from({ length: 101 }, () => id),
    }).success,
    false,
  );
  assert.equal(
    deleteThreadsRequestSchema.safeParse({ threadIds: ["../other-user"] })
      .success,
    false,
  );
});
