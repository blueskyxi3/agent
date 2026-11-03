import test from "node:test";
import assert from "node:assert/strict";
import { artifactSchema } from "@ai-hub-agent/contracts";
import {
  aggregateRows,
  businessTools,
  capabilityNavigationArtifact,
  workflowNavigationArtifact,
} from "./business-tools.js";

test("aggregates finite numeric fields including decimal amounts", () => {
  assert.deepEqual(aggregateRows([{ model: "b", quota: 2 }, { model: "a", quota: 3 }, { model: "b", quota: 4 }], "model", "quota"), [["a", 3], ["b", 6]]);
  assert.equal(aggregateRows([{ model: "a", amount: 0.1 }, { model: "a", amount: 0.2 }], "model", "amount")[0]?.[1], 0.3);
  assert.throws(() => aggregateRows([{ model: "a", amount: Number.NaN }], "model", "amount"));
  assert.throws(() => aggregateRows([{ model: "a", amount: Number.POSITIVE_INFINITY }], "model", "amount"));
  assert.throws(() => aggregateRows([{ model: "a", quota: Number.MAX_SAFE_INTEGER }, { model: "a", quota: 1 }], "model", "quota"));
  assert.throws(() => aggregateRows([{ model: "a" }], "model", "quota"));
});

test("aggregates decimal amount strings without coercing invalid values", () => {
  assert.deepEqual(aggregateRows([
    { model: "a", amount: "0.09277988" },
    { model: "a", amount: "0.37424733" },
    { model: "a", amount: "0.01893929" },
    { model: "a", amount: "0.00870499" },
    { model: "b", amount: "4.65869600" },
    { model: "c", amount: "0.1" },
    { model: "c", amount: 0.2 },
    { model: "d", amount: " -1.2e-3 " },
  ], "model", "amount"), [["a", 0.49467149], ["b", 4.658696], ["c", 0.3], ["d", -0.0012]]);
  for (const amount of ["", " ", "NaN", "Infinity", "1e309", "9007199254740992", "12RMB", "¥1", "1,000", "0x10", "1%", true, false, null, [], {}]) {
    assert.throws(() => aggregateRows([{ model: "a", amount }], "model", "amount"), /有限数字/);
  }
});

test("charts stored analytics results using canonical or response-relative paths", async () => {
  const executionId = "2e489e79-8023-485c-a717-a9240642a7e8";
  const requests: string[] = [];
  const client = {
    request: async (path: string) => {
      requests.push(path);
      return {
        status: "completed",
        result: JSON.stringify({
          response: { success: true, data: { channel_statistics: [
            { channel: "deepseek", amount: "0.09277988" },
            { channel: "deepseek", amount: "0.37424733" },
            { channel: "seedance", amount: "4.65869600" },
          ] } },
          generated_at: "2026-10-21T08:00:00Z",
        }),
      };
    },
  };
  const tool = businessTools(client as any, () => "cookie").find((item) => item.name === "chart_execution") as any;
  const params = { execution_id: executionId, group: "channel", value: "amount", title: "全站模型消费占比", unit: "RMB", chart_type: "donut" };
  for (const rows_path of ["response.data.channel_statistics", "data.channel_statistics"]) {
    const result = await tool.execute("chart-1", { ...params, rows_path });
    const artifact = artifactSchema.parse(result.details.artifact);
    assert.equal(artifact.kind, "chart");
    if (artifact.kind !== "chart") throw new Error("expected chart");
    assert.equal(artifact.chartType, "donut");
    assert.deepEqual(artifact.labels, ["deepseek", "seedance"]);
    assert.deepEqual(artifact.values, [0.46702721, 4.658696]);
    assert.equal(artifact.sourceId, executionId);
    assert.equal(artifact.generatedAt, "2026-10-21T08:00:00Z");
  }
  for (const rows_path of ["response.data.missing", "response..data", "response.__proto__", "response.data.constructor", "response.data.toString"]) {
    await assert.rejects(tool.execute("chart-invalid", { ...params, rows_path }), /数据路径无效/);
  }
  await assert.rejects(tool.execute("chart-object", { ...params, rows_path: "response.data" }), /数组/);
  assert.ok(requests.every((path) => path.endsWith(`/executions/${executionId}`)));
});

test("builds controlled navigation artifacts from manuals and capability details", () => {
  assert.deepEqual(workflowNavigationArtifact({ workflows: [{ title: "创建渠道", description: "操作说明", navigation: { label: "打开渠道管理", href: "/panel/channel" } }] }), {
    kind: "link", version: 1, title: "创建渠道", description: "操作说明", label: "打开渠道管理", href: "/panel/channel",
  });
  assert.deepEqual(capabilityNavigationArtifact({ name: "创建 API Key", description: "操作说明", navigation: { label: "打开 API Key 管理", href: "/panel/token" } }), {
    kind: "link", version: 1, title: "创建 API Key", description: "操作说明", label: "打开 API Key 管理", href: "/panel/token",
  });
  assert.equal(workflowNavigationArtifact({ workflows: [{ title: "不可访问", navigation: {} }] }), undefined);
  assert.equal(workflowNavigationArtifact({ workflows: [{ id: "manage-api-keys", title: "API Key", navigation: { href: "/panel/token" } }] }, "如何管理 API Key")?.kind, "link");
  assert.equal((workflowNavigationArtifact({ workflows: [{ id: "manage-api-keys", title: "API Key", navigation: { href: "/panel/token" } }] }, "创建 API Key") as any)?.guide, "token.create");
  assert.equal((workflowNavigationArtifact({ workflows: [{ id: "manage-channels", title: "渠道", navigation: { href: "/panel/channel" } }] }, "创建渠道") as any)?.guide, "channel.create");
});

test("claims only one navigation artifact during a turn", async () => {
  let turn = 1;
  let claimedTurn = 0;
  const claim = (artifact: any) => {
    if (!artifact || claimedTurn === turn) return undefined;
    claimedTurn = turn;
    return artifact;
  };
  const tools = businessTools({ request: async (path: string) => path.includes("workflows")
    ? { workflows: [{ id: "manage-channels", title: "创建渠道", navigation: { href: "/panel/channel" } }] }
    : path.endsWith("post.api.token")
      ? { operation_id: "post.api.token", execution_mode: "confirm", required_access: "manage" }
      : { name: "渠道", navigation: { href: "/panel/channel" } } } as any,
  () => "cookie", () => undefined, () => turn, Date.now, () => undefined, claim);
  const workflow = tools.find((item) => item.name === "list_workflows") as any;
  const capability = tools.find((item) => item.name === "describe_capability") as any;
  assert.equal((await workflow.execute("one", { q: "创建渠道" })).details.artifact.guide, "channel.create");
  assert.equal((await capability.execute("two", { operation_id: "post.api.channel" })).details.artifact, undefined);
  const pageWorkflow = tools.find((item) => item.name === "start_api_key_page_workflow") as any;
  assert.equal((await pageWorkflow.execute("blocked", {})).details.artifact, undefined);
  turn = 2;
  assert.equal((await capability.execute("three", { operation_id: "post.api.channel" })).details.artifact.kind, "link");
});

test("guides authorized users to page permissions when no published manual matches", async () => {
  const client = {
    request: async () => ({ workflows: [] }),
    getCurrentUser: async () => ({ page_access: { page_permission: "manage" } }),
  };
  const tool = businessTools(client as any, () => "cookie").find((item) => item.name === "list_workflows") as any;
  const result = await tool.execute("call-1", { q: "如何配置页面权限？" });
  assert.equal(result.details.artifact.href, "/panel/setting#permissions");
  assert.match(result.content[0].text, /超级管理员点击保存/);

  const denied = businessTools({ ...client, getCurrentUser: async () => ({ page_access: {} }) } as any, () => "cookie").find((item) => item.name === "list_workflows") as any;
  const deniedResult = await denied.execute("call-2", { q: "页面权限" });
  assert.equal(deniedResult.details.artifact, undefined);
});

test("starts API Key page workflow only after capability authorization", async () => {
  const tool = businessTools({ request: async () => ({ operation_id: "post.api.token", execution_mode: "confirm", required_access: "manage" }) } as any, () => "cookie").find((item) => item.name === "start_api_key_page_workflow") as any;
  const result = await tool.execute("call-1", {});
  assert.equal(result.details.artifact.kind, "page_workflow");
  assert.equal(result.details.artifact.operationId, "post.api.token");
  assert.ok(result.details.artifact.expiresAt > Date.now());
  const denied = businessTools({ request: async () => ({ operation_id: "post.api.token", execution_mode: "navigate", required_access: "manage" }) } as any, () => "cookie").find((item) => item.name === "start_api_key_page_workflow") as any;
  await assert.rejects(denied.execute("call-2", {}), /不能使用/);
});

test("prepares at most one confirmation artifact per assistant turn", async () => {
  let requests = 0;
  let turn = 1;
  const client = {
    request: async () => {
      requests += 1;
      return {
        status: "pending_confirmation",
        execution: { id: `execution-${requests}`, parameters: "{}" },
      };
    },
  };
  const tool = businessTools(
    client as any,
    () => "cookie",
    () => undefined,
    () => turn,
  ).find((item) => item.name === "execute_capability") as any;
  const parameters = {
    operation_id: "post.api.token",
    body: { name: "temporary", expired_time: 18_000 },
  };

  const first = await tool.execute("call-1", parameters);
  const repeated = await tool.execute("call-2", parameters);
  assert.equal(requests, 1);
  assert.ok(first.details.artifact);
  assert.equal(repeated.details.artifact, undefined);
  assert.equal(JSON.parse(repeated.content[0].text).reused, true);

  turn += 1;
  const nextTurn = await tool.execute("call-3", parameters);
  assert.equal(requests, 2);
  assert.ok(nextTurn.details.artifact);
});

test("resolves recent-minute queries from the server clock", async () => {
  let requestBody: any;
  const client = {
    request: async (_path: string, _cookie: string, body: unknown) => {
      requestBody = body;
      return { status: "completed" };
    },
  };
  const tool = businessTools(
    client as any,
    () => "cookie",
    () => undefined,
    undefined,
    () => 1_789_395_316_999,
  ).find((item) => item.name === "execute_capability") as any;

  await tool.execute("call-1", {
    operation_id: "get.api.log.self",
    recent_minutes: 30,
    query: {
      size: 100,
      start_timestamp: 1,
      end_timestamp: 2,
    },
  });

  assert.deepEqual(requestBody.parameters.query, {
    size: 100,
    start_timestamp: 1_789_393_516,
    end_timestamp: 1_789_395_316,
  });
});

test("prefers the chart type explicitly requested in the current turn", async () => {
  const client = {
    request: async () => ({
      status: "completed",
      result: JSON.stringify({ data: [{ model: "a", requests: 2 }] }),
    }),
  };
  const tool = businessTools(
    client as any,
    () => "cookie",
    () => undefined,
    undefined,
    Date.now,
    () => "pie",
  ).find((item) => item.name === "chart_execution") as any;

  const result = await tool.execute("call-1", {
    execution_id: "execution-1",
    rows_path: "data",
    group: "model",
    value: "requests",
    title: "模型调用次数",
    unit: "次",
    chart_type: "bar",
  });

  assert.equal(result.details.artifact.chartType, "pie");
});

test("resolves recent-day statistics from the local calendar including today", async () => {
  const requests: any[] = [];
  const client = {
    request: async (_path: string, _cookie: string, body: unknown) => {
      requests.push(body);
      return { status: "completed" };
    },
  };
  const tool = businessTools(
    client as any,
    () => "cookie",
    () => undefined,
    undefined,
    () => new Date(2026, 9, 22, 5, 30).getTime(),
  ).find((item) => item.name === "execute_capability") as any;

  await tool.execute("call-1", {
    operation_id: "get.api.analytics.multi_user_stats",
    recent_days: 30,
    query: { usernames: "alice,bob", start_time: "wrong", end_time: "wrong" },
  });
  assert.deepEqual(requests[0].parameters.query, {
    usernames: "alice,bob", start_time: "2026-09-23", end_time: "2026-10-22",
  });
  await tool.execute("call-2", {
    operation_id: "get.api.analytics.multi_user_stats",
    recent_days: 1,
    query: { usernames: "alice" },
  });
  assert.deepEqual(requests[1].parameters.query, {
    usernames: "alice", start_time: "2026-10-22", end_time: "2026-10-22",
  });
  await assert.rejects(() => tool.execute("call-3", {
    operation_id: "get.api.analytics.multi_user_stats",
    recent_days: 30, recent_minutes: 30,
  }), /不能同时使用/);
  assert.equal(requests.length, 2);
});

test("uses the host billing timezone for recent days across midnight and year boundaries", async () => {
  const originalTimezone = process.env.TZ;
  try {
    for (const [timezone, expectedStart, expectedEnd] of [
      [undefined, "2026-12-31", "2027-01-01"],
      ["Asia/Shanghai", "2026-12-31", "2027-01-01"],
      ["UTC", "2026-12-30", "2026-12-31"],
    ]) {
      if (timezone === undefined) delete process.env.TZ;
      else process.env.TZ = timezone;
      let body: any;
      const client = { request: async (_path: string, _cookie: string, params: unknown) => {
        body = params;
        return {status: "completed"};
      } };
      const tool = businessTools(client as any, () => "cookie", () => undefined,
        undefined, () => Date.parse("2026-12-31T20:00:00Z"),
      ).find((item) => item.name === "execute_capability") as any;
      await tool.execute("call", {operation_id: "get.api.analytics.multi_user_stats", recent_days: 2});
      assert.equal(body.parameters.query.start_time, expectedStart);
      assert.equal(body.parameters.query.end_time, expectedEnd);
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});
