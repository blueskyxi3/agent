import { defineTool } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { Artifact } from "@ai-hub-agent/contracts";
import { AiHubClient } from "./aihub-client.js";
import type { ChartType } from "./chart-intent.js";

const root = "/api/user/self/assistant";
function output(value: unknown, artifact?: Artifact) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: { ...(artifact ? { artifact } : {}), trace: { response: value } },
  };
}

type PageContext = { path: string; query: Record<string, string> } | undefined;

export function capabilityNavigationArtifact(
  result: any,
): Artifact | undefined {
  const navigation = result?.navigation;
  return navigation?.href
    ? {
        kind: "link",
        version: 1,
        title: result.name || "查看系统页面",
        description: result.description,
        label: navigation.label || "打开页面",
        href: navigation.href,
      }
    : undefined;
}

export function workflowNavigationArtifact(result: any, query = ""): Artifact | undefined {
  const workflow = result?.workflows?.find(
    (item: any) => item.navigation?.href,
  );
  const wantsCreation = /创建|新增|建立|create|add/i.test(query);
  const guide = wantsCreation && workflow?.id === "manage-api-keys" && workflow.navigation.href === "/panel/token"
    ? "token.create" as const
    : wantsCreation && workflow?.id === "manage-channels" && workflow.navigation.href === "/panel/channel"
      ? "channel.create" as const
      : undefined;
  return workflow
    ? {
        kind: "link",
        version: 1,
        title: workflow.title,
        description: workflow.description,
        label: guide === "token.create" ? "引导创建 API Key" : guide === "channel.create" ? "引导创建渠道" : workflow.navigation.label || "打开页面",
        href: workflow.navigation.href,
        ...(guide ? { guide } : {}),
      }
    : undefined;
}

export function businessTools(
  client: AiHubClient,
  cookie: () => string,
  pageContext: () => PageContext = () => undefined,
  turnGeneration?: () => number,
  now: () => number = Date.now,
  requestedChartType: () => ChartType | undefined = () => undefined,
  claimNavigation: (artifact: Artifact | undefined) => Artifact | undefined = (artifact) => artifact,
) {
  let preparedTurn: number | undefined;
  let preparedResult: any;
  let pageWorkflowTurn: number | undefined;
  const queryValue = Type.Union([Type.String(), Type.Number(), Type.Boolean()]);
  return [
    defineTool({
      name: "start_api_key_page_workflow",
      label: "协助创建 API Key",
      description: "仅在用户明确要求代为创建当前用户的 API Key 时调用。检查权限并在当前浏览器的 API Key 页面打开创建表单，随后由聊天卡片收集名称和最终确认。仅询问操作方法时不要调用。",
      parameters: Type.Object({}),
      execute: async () => {
        const currentTurn = turnGeneration?.();
        if (currentTurn !== undefined && pageWorkflowTurn === currentTurn)
          return output({ status: "awaiting_browser", reused: true });
        const capability = await client.request<any>(`${root}/capabilities/post.api.token`, cookie());
        if (capability.operation_id !== "post.api.token" || capability.execution_mode !== "confirm" || capability.required_access !== "manage")
          throw new Error("当前用户不能使用 API Key 创建工作流");
        const artifact: Artifact = {
          kind: "page_workflow", version: 1, workflowId: randomUUID(), expiresAt: Date.now() + 10 * 60_000, operationId: "post.api.token",
          step: "start", allowedActions: ["open", "cancel"],
        };
        const claimed = claimNavigation(artifact);
        if (!claimed) return output({ status: "navigation_already_provided" });
        pageWorkflowTurn = currentTurn;
        return output({ status: "awaiting_browser", workflow_id: artifact.workflowId }, claimed);
      },
    }),
    defineTool({
      name: "search_capabilities",
      label: "搜索系统能力",
      description:
        "按中文名称、别名或模块搜索当前用户实际可用的能力。结果已按角色和页面读写权限过滤。",
      parameters: Type.Object({
        q: Type.Optional(Type.String()),
        domain: Type.Optional(Type.String()),
        effect: Type.Optional(
          Type.Union([
            Type.Literal("read"),
            Type.Literal("write"),
            Type.Literal("interactive"),
          ]),
        ),
        cursor: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      }),
      execute: async (_id, params) => {
        const query = new URLSearchParams();
        if (params.q) query.set("q", params.q);
        if (params.domain) query.set("domain", params.domain);
        if (params.effect) query.set("effect", params.effect);
        if (params.cursor) query.set("cursor", params.cursor);
        if (params.limit) query.set("limit", String(params.limit));
        return output(
          await client.request(`${root}/capabilities?${query}`, cookie()),
        );
      },
    }),
    defineTool({
      name: "describe_capability",
      label: "读取接口参数",
      description:
        "读取接口参数 Schema、权限、调用方式、操作说明和受控页面入口。仅咨询如何操作时不要执行接口。",
      parameters: Type.Object({ operation_id: Type.String() }),
      execute: async (_id, { operation_id }) => {
        const result = await client.request<any>(
          `${root}/capabilities/${encodeURIComponent(operation_id)}`,
          cookie(),
        );
        return output(result, claimNavigation(capabilityNavigationArtifact(result)));
      },
    }),
    defineTool({
      name: "execute_capability",
      label: "调用系统接口",
      description:
        "仅使用本轮已搜索并读取详情的 operation_id。查询最近 N 分钟且接口支持 start_timestamp/end_timestamp 时传 recent_minutes；查询最近 N 天且接口支持 start_time/end_time 日期时传 recent_days，系统按服务端本地日期计算包含今天的 N 个自然日。两者不能同时使用，不要猜测日期或时间戳。排序参数应使用字段名，降序格式如 -created_at，不能传 desc。参数不足时会生成参数表单，不要猜测必填值。查询返回真实数据；普通修改生成确认卡片；高风险操作只返回页面入口。不要传入任何敏感值。",
      parameters: Type.Object({
        operation_id: Type.String(),
        recent_minutes: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: 525_600,
            description:
              "查询最近 N 分钟时使用；系统将覆盖 query 中的 start_timestamp 和 end_timestamp。仅用于包含这两个时间参数的查询接口。",
          }),
        ),
        recent_days: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: 366,
            description:
              "用于 start_time/end_time 为 YYYY-MM-DD 的期间统计接口，覆盖这两个参数；包含今天在内的最近 N 个自然日，与用户统计页面口径一致。",
          }),
        ),
        path: Type.Optional(Type.Record(Type.String(), Type.String())),
        query: Type.Optional(
          Type.Record(
            Type.String(),
            Type.Union([queryValue, Type.Array(queryValue, { maxItems: 50 })]),
          ),
        ),
        body: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      }),
      execute: async (
        _id,
        { operation_id, recent_minutes, recent_days, path, query, body },
      ) => {
        const currentTurn = turnGeneration?.();
        if (
          currentTurn !== undefined &&
          preparedTurn === currentTurn &&
          preparedResult
        ) {
          return output({
            ...preparedResult,
            reused: true,
            message: "本轮已有待用户处理的操作，请等待用户在卡片中完成。",
          });
        }
        const page = pageContext();
        const resolvedQuery = { ...(query ?? {}) };
        if (recent_minutes !== undefined && recent_days !== undefined)
          throw new Error("recent_minutes 和 recent_days 不能同时使用");
        if (recent_minutes !== undefined) {
          const endTimestamp = Math.floor(now() / 1000);
          resolvedQuery.start_timestamp = endTimestamp - recent_minutes * 60;
          resolvedQuery.end_timestamp = endTimestamp;
        }
        if (recent_days !== undefined) {
          // Match Go's GetLocalTimezone fallback, including hosts running in UTC.
          const today = new Intl.DateTimeFormat("en-CA", {
            timeZone: process.env.TZ || "Asia/Shanghai",
            year: "numeric", month: "2-digit", day: "2-digit",
          }).format(now());
          const start = new Date(`${today}T00:00:00Z`);
          start.setUTCDate(start.getUTCDate() - recent_days + 1);
          resolvedQuery.end_time = today;
          resolvedQuery.start_time = start.toISOString().slice(0, 10);
        }
        const result = await client.request<any>(
          `${root}/executions`,
          cookie(),
          {
            operation_id,
            parameters: {
              path: path ?? {},
              query: resolvedQuery,
              body: body ?? {},
            },
            ...(page
              ? { context: { page_path: page.path, page_query: page.query } }
              : {}),
          },
        );
        if (
          currentTurn !== undefined &&
          (result.status === "awaiting_parameters" ||
            result.status === "pending" ||
            result.status === "pending_confirmation")
        ) {
          preparedTurn = currentTurn;
          preparedResult = result;
        }
        if (result.status === "awaiting_parameters" && result.form) {
          if (result.reused)
            return output({
              status: "awaiting_parameters",
              form_id: result.form.id,
              reused: true,
            });
          const artifact: Artifact = {
            kind: "parameter_form",
            version: 1,
            formId: result.form.id,
            operationId: result.form.operation_id,
            title: result.form.title,
            description: result.form.description,
            effect: result.form.effect,
            risk: result.form.risk,
            parameters: result.form.parameters,
            fields: result.form.fields,
            error: result.form.error,
            ...(result.form.mode ? { mode: result.form.mode } : {}),
            ...(result.form.help_page
              ? {
                  helpPage: result.form.help_page,
                  helpLabel: result.form.help_label,
                }
              : {}),
            ...(result.form.page ? { page: result.form.page } : {}),
            ...(result.form.page_label
              ? { pageLabel: result.form.page_label }
              : {}),
          };
          return output(
            { status: "awaiting_parameters", form_id: result.form.id },
            artifact,
          );
        }
        if (
          (result.status === "pending" ||
            result.status === "pending_confirmation") &&
          result.execution
        ) {
          if (result.reused)
            return output({
              status: "pending_confirmation",
              execution_id: result.execution.id,
              reused: true,
            });
          const artifact: Artifact = {
            kind: "execution",
            version: 1,
            title: "确认系统操作",
            executionId: result.execution.id,
            parameters: result.execution.parameters,
            secretFields: result.secret_fields ?? [],
            requiredSecretFields: result.required_secret_fields ?? [],
            ...(result.page ? { page: result.page } : {}),
          };
          return output(
            {
              status: "pending_confirmation",
              execution_id: result.execution.id,
            },
            artifact,
          );
        }
        if (result.page)
          return output(result, claimNavigation({
            kind: "link",
            version: 1,
            title: "查看系统页面",
            label: "打开页面",
            href: result.page,
          }));
        return output(result);
      },
    }),
    defineTool({
      name: "get_execution",
      label: "查询执行结果",
      description:
        "仅查询 execute_capability 返回的 execution_id。超时后先查状态，不能重复创建；消费汇总的 source_id 不是 execution_id，不得用于本工具。",
      parameters: Type.Object({ execution_id: Type.String() }),
      execute: async (_id, { execution_id }) =>
        output(
          await client.request(
            `${root}/executions/${encodeURIComponent(execution_id)}`,
            cookie(),
          ),
        ),
    }),
    defineTool({
      name: "list_workflows",
      label: "读取业务操作流程",
      description:
        "用户询问如何使用、在哪里设置或怎么创建时，先按问题读取操作流程并提供页面按钮，不要执行业务操作。",
      parameters: Type.Object({
        q: Type.Optional(Type.String()),
        domain: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      }),
      execute: async (_id, { q, domain, limit }) => {
        const query = new URLSearchParams();
        if (q) query.set("q", q);
        if (domain) query.set("domain", domain);
        if (limit) query.set("limit", String(limit));
        const result = await client.request<any>(
          `${root}/workflows${query.size ? `?${query}` : ""}`,
          cookie(),
        );
        if (q && (!domain || domain === "setting") && /页面权限|頁面權限|page permissions?/i.test(q) && !result.workflows?.length) {
          const user = await client.getCurrentUser(cookie());
          if (user.page_access?.page_permission) {
            result.workflows = [{
              id: "manage-page-permissions",
              title: "配置页面权限",
              description: "在系统设置的页面权限页，按角色配置控制台页面的访问范围。",
              steps: [
                { title: "打开页面权限", instruction: "进入系统设置，选择页面权限标签。" },
                { title: "调整角色权限", instruction: "按超级管理员、管理员、普通用户列勾选可访问的页面。" },
                { title: "保存并核对", instruction: "超级管理员点击保存后，用对应角色账号核对可见页面。只有超级管理员可修改。" },
              ],
              navigation: { label: "打开页面权限", href: "/panel/setting#permissions" },
            }];
          }
        }
        return output(result, claimNavigation(workflowNavigationArtifact(result, q)));
      },
    }),
    defineTool({
      name: "generate_image",
      label: "生成图片",
      description:
        "根据用户明确的图片生成请求，使用个人图像模型生成图片；调用会计费。",
      parameters: Type.Object({
        prompt: Type.String(),
        reference_images: Type.Optional(
          Type.Array(Type.String(), { maxItems: 4 }),
        ),
      }),
      execute: async (_id, { prompt, reference_images }) => {
        const response = await client.raw(
          `${root}/images/generations`,
          cookie(),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              prompt,
              reference_images: reference_images ?? [],
              count: 1,
            }),
          },
        );
        const result = (await response.json()) as any;
        if (!response.ok || result.success === false || result.error)
          throw new Error(
            result.message || result.error?.message || "图片生成失败",
          );
        const urls = (result.data ?? [])
          .map(
            (item: any) =>
              item.url ||
              (item.b64_json ? `data:image/png;base64,${item.b64_json}` : ""),
          )
          .filter(Boolean);
        if (!urls.length) throw new Error("未返回图片结果");
        return output(
          { generated: urls.length },
          { kind: "image", version: 1, title: prompt.slice(0, 100), urls },
        );
      },
    }),
    defineTool({
      name: "generate_video",
      label: "生成视频",
      description:
        "用户明确请求生成视频时提交一次异步任务。不要轮询或重复提交，界面会持续展示任务状态。",
      parameters: Type.Object({ prompt: Type.String() }),
      execute: async (_id, { prompt }) => {
        const response = await client.raw(
          `${root}/video/generations`,
          cookie(),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              prompt,
              mode: "text_to_video",
              assets: [],
              duration: 5,
              ratio: "16:9",
              resolution: "720p",
            }),
          },
        );
        const result = (await response.json()) as any;
        const taskId = result.id || result.data?.id || result.task_id;
        if (!response.ok || result.success === false || !taskId)
          throw new Error(
            result.message || result.error?.message || "视频提交失败",
          );
        return output(
          { task_id: taskId },
          { kind: "video", version: 1, title: prompt.slice(0, 100), taskId },
        );
      },
    }),
    defineTool({
      name: "chart_execution",
      label: "分析接口数据",
      description:
        "仅分析 execute_capability 返回的 execution_id 对应结果。按 group 字段分组，对 value 字段求和，支持有限数字和十进制数字字符串（包括金额）。全站模型/渠道消费图表使用本工具；单用户消费图表使用 get_consumption_summary 并设置 visualize=true。rows_path 从已保存结果根节点开始，如 response.data.channel_statistics，也兼容省略 response 前缀。占比优先使用 donut。只分析已返回的数据，不得编造或改用请求数代替金额，不能传入消费汇总的 source_id。",
      parameters: Type.Object({
        execution_id: Type.String(),
        rows_path: Type.String({ description: "数组的点分路径；全站消费统计为 response.data.channel_statistics，group=channel、value=amount。" }),
        group: Type.String(),
        value: Type.String(),
        title: Type.String(),
        unit: Type.String(),
        chart_type: Type.Union([
          Type.Literal("bar"),
          Type.Literal("line"),
          Type.Literal("pie"),
          Type.Literal("donut"),
        ]),
      }),
      execute: async (_id, params) => {
        const execution = await client.request<any>(
          `${root}/executions/${encodeURIComponent(params.execution_id)}`,
          cookie(),
        );
        if (execution.status !== "completed")
          throw new Error("请先完成数据查询");
        const result = JSON.parse(execution.result);
        const keys = params.rows_path.split(".");
        const readPath = (source: unknown): unknown => {
          let current = source;
          for (const key of keys) {
            if (
              !key || ["__proto__", "prototype", "constructor"].includes(key) ||
              !current || typeof current !== "object" || !Object.hasOwn(current, key)
            ) return undefined;
            current = (current as Record<string, unknown>)[key];
          }
          return current;
        };
        const rows = readPath(result) ?? (keys[0] !== "response" ? readPath(result.response) : undefined);
        if (rows === undefined)
          throw new Error("数据路径无效，请使用指向数组的点分路径，如 response.data.channel_statistics");
        const series = aggregateRows(rows, params.group, params.value);
        const artifact: Artifact = {
          kind: "chart",
          version: 1,
          title: params.title,
          chartType: requestedChartType() ?? params.chart_type,
          unit: params.unit,
          labels: series.map(([label]) => label),
          values: series.map(([, value]) => value),
          sourceId: params.execution_id,
          complete: false,
          generatedAt: result.generated_at,
        };
        return output(
          {
            series,
            complete: false,
            note: "仅统计本次接口返回的数据，未确认是否覆盖全部分页",
          },
          artifact,
        );
      },
    }),
  ];
}

export function aggregateRows(
  rows: unknown,
  group: string,
  value: string,
): Array<[string, number]> {
  if (!Array.isArray(rows) || rows.length > 10000)
    throw new Error("需要不超过 10000 行的数组");
  const sums = new Map<string, number>();
  const compensations = new Map<string, number>();
  for (const row of rows) {
    if (
      !row ||
      typeof row !== "object" ||
      !Object.hasOwn(row, group) ||
      !Object.hasOwn(row, value)
    )
      throw new Error("请选择存在的分组字段及数值字段");
    const rawValue = (row as Record<string, unknown>)[value];
    const numericValue = typeof rawValue === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(rawValue.trim())
      ? Number(rawValue.trim())
      : rawValue;
    if (
      typeof numericValue !== "number" ||
      !Number.isFinite(numericValue) ||
      Math.abs(numericValue) > Number.MAX_SAFE_INTEGER
    )
      throw new Error("数值字段必须是安全范围内的有限数字");
    const label = String((row as Record<string, unknown>)[group]);
    const adjusted = numericValue - (compensations.get(label) ?? 0);
    const previous = sums.get(label) ?? 0;
    const sum = previous + adjusted;
    if (!Number.isFinite(sum) || Math.abs(sum) > Number.MAX_SAFE_INTEGER)
      throw new Error("汇总超出安全数值范围");
    compensations.set(label, sum - previous - adjusted);
    sums.set(label, sum);
  }
  if (sums.size > 100) throw new Error("分组超过 100 个，请缩小查询范围");
  return [...sums.entries()]
    .map(
      ([label, sum]) =>
        [label, Number(sum.toPrecision(15))] as [string, number],
    )
    .sort(([a], [b]) => a.localeCompare(b));
}
