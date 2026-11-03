import assert from "node:assert/strict";
import test from "node:test";

import { artifactSchema } from "@ai-hub-agent/contracts";

import {
  buildConsumptionArtifacts,
  createAssistantTextGate,
  contextReserveTokens,
  selectFollowupSuggestions,
  type ConsumptionResult,
} from "./pi-service.js";
import { requestedChartType } from "./chart-intent.js";

const consumptionResult: ConsumptionResult = {
  source_id: "5f30cf4c-7443-4d4f-9f5d-c82cdb98b271",
  currency: { code: "CNY", symbol: "¥" },
  account: {
    remaining_amount: "124.38261000",
    lifetime_used_amount: "162.87000000",
    lifetime_request_count: 695,
  },
  summary: { amount: "61.86019100", request_count: 145 },
  top_models: [
    { model_name: "gpt-5.6-sol", amount: "56.16000000", request_count: 111 },
    { model_name: "gpt-5.6-terra", amount: "5.70019100", request_count: 34 },
  ],
  daily: [
    { date: "2026-09-12", amount: "12.25000000", request_count: 30 },
    { date: "2026-09-13", amount: "49.61019100", request_count: 115 },
  ],
  generated_at: "2026-09-13T09:34:00+08:00",
};

test("sets automatic compaction at 85 percent of the configured context window", () => {
  const window = 128_000;
  const threshold = window - contextReserveTokens(window);
  assert.equal(threshold, 108_799);
  assert.equal(108_799 > threshold, false);
  assert.equal(108_800 > threshold, true);
});

test("streams ordinary assistant text without changing it", () => {
  const chunks: string[] = [];
  const gate = createAssistantTextGate((text) => chunks.push(text));
  assert.equal(gate.push("消费统计：" + "正常回答".repeat(30)), true);
  assert.equal(gate.push("\n| 模型 | 消费 |\n| --- | --- |"), true);
  gate.flush();
  assert.equal(chunks.join(""), "消费统计：" + "正常回答".repeat(30) + "\n| 模型 | 消费 |\n| --- | --- |");
});

test("blocks fake tool calls split across streaming chunks", () => {
  const chunks: string[] = [];
  const gate = createAssistantTextGate((text) => chunks.push(text));
  assert.equal(gate.push("我来查询。\n<inv"), true);
  assert.equal(gate.push('oke name="execute_capability">'), false);
  assert.equal(chunks.join(""), "");
});

test("blocks raw tool results and leaked thinking tags", () => {
  for (const text of ['\nresult[{"items":[]}]', "让我查询。 </think>"]) {
    const chunks: string[] = [];
    const gate = createAssistantTextGate((part) => chunks.push(part));
    assert.equal(gate.push(text), false);
    assert.equal(chunks.join(""), "");
  }
});

test("recognizes an explicitly requested pie or donut chart", () => {
  assert.equal(requestedChartType("请按模型消费画一个饼图"), "pie");
  assert.equal(requestedChartType("改成环状图展示"), "donut");
  assert.equal(requestedChartType("Use a doughnut chart"), "donut");
  assert.equal(requestedChartType("先看折线图，最后改成柱状图"), "bar");
  assert.equal(requestedChartType("展示最近消费趋势"), undefined);
});

test("builds exactly one requested consumption chart from decimal JSON strings", () => {
  const artifacts = buildConsumptionArtifacts(consumptionResult, "zh_CN", {
    chartType: "donut",
    data: "model_amount",
  });

  assert.equal(artifacts.length, 2);
  for (const artifact of artifacts)
    assert.doesNotThrow(() => artifactSchema.parse(artifact));
  assert.deepEqual(
    artifacts[1]?.kind === "chart" ? artifacts[1].values : [],
    [56.16, 5.700191],
  );
  assert.equal(
    artifacts[1]?.kind === "chart" ? artifacts[1].chartType : "",
    "donut",
  );
});

test("uses request counts and preserves an explicitly requested pie chart", () => {
  const artifacts = buildConsumptionArtifacts(consumptionResult, "zh_CN", {
    chartType: "pie",
    data: "model_requests",
  });

  assert.equal(artifacts.length, 2);
  const chart = artifacts[1];
  assert.equal(chart?.kind === "chart" ? chart.chartType : "", "pie");
  assert.equal(chart?.kind === "chart" ? chart.title : "", "模型调用次数");
  assert.equal(chart?.kind === "chart" ? chart.unit : "", "次");
  assert.deepEqual(chart?.kind === "chart" ? chart.values : [], [111, 34]);
});

test("omits the retired points column when the API does not return points", () => {
  const [table] = buildConsumptionArtifacts(consumptionResult, "zh_CN");

  assert.equal(table?.kind, "table");
  if (table?.kind !== "table") return;
  assert.deepEqual(
    table.columns.map((column) => column.key),
    ["metric", "amount", "requests"],
  );
  assert.equal(
    table.rows.some((row) => Object.values(row).includes("NaN")),
    false,
  );
});

test("selects exactly two distinct role-safe follow-up questions", () => {
  assert.deepEqual(
    selectFollowupSuggestions(
      "Where can I create an API key?",
      [
        "Where can I create an API key?",
        "Show my recent logs",
        "Show my recent logs",
      ],
      "en_US",
    ),
    ["Show my recent logs", "What else can I do here?"],
  );
});
