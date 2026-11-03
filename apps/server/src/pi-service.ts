import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentEvent,
  Artifact,
  ChatRequest,
  ContextUsage,
  TurnMetrics,
} from "@ai-hub-agent/contracts";

import type { AgentConfig } from "./config.js";
import { ActionStore } from "./action-store.js";
import { AiHubClient, type CurrentUser } from "./aihub-client.js";
import { businessTools } from "./business-tools.js";
import {
  requestedChartType,
  type ChartType,
} from "./chart-intent.js";
import { toolBinding } from "./tool-bindings.js";

type Emit = (event: AgentEvent) => void;
export function contextReserveTokens(contextWindow: number) {
  return Math.ceil(contextWindow * 0.15) + 1;
}
type Runtime = {
  session: Awaited<ReturnType<typeof createAgentSession>>["session"];
  modelRuntime: ModelRuntime;
  cookie: string;
  pageContext?: ChatRequest["page"];
  beginTurn: (message: string) => void;
  takeSuggestions: () => [string, string] | undefined;
  lastUsed: number;
};
export type RuntimeSettings = {
  protocolVersion: number;
  model: string;
  assistantName: string;
  thinkingLevel: string;
  reasoning: boolean;
  requestTimeoutMs: number;
};

type NumericJSON = number | string;
type ConsumptionMetric = {
  amount: NumericJSON;
  points?: NumericJSON;
  request_count: number;
};
export type ConsumptionChartType = ChartType;
export type ConsumptionChartData =
  "daily_amount" | "daily_requests" | "model_amount" | "model_requests";
type ConsumptionVisualization = {
  chartType: ConsumptionChartType;
  data: ConsumptionChartData;
};
export type ConsumptionResult = {
  source_id: string;
  currency: { code: string; symbol: string };
  summary: ConsumptionMetric;
  account: {
    remaining_amount: NumericJSON;
    remaining_points?: NumericJSON;
    lifetime_used_amount: NumericJSON;
    lifetime_used_points?: NumericJSON;
    lifetime_request_count: number;
  };
  top_models: Array<ConsumptionMetric & { model_name: string }>;
  daily: Array<ConsumptionMetric & { date: string }>;
  generated_at: string;
};

function consumptionCopy(locale: ChatRequest["locale"]) {
  if (locale === "zh_HK")
    return {
      tool: "查詢消費匯總",
      description:
        "僅查詢目前使用者或 username 指定的單一使用者，不支援全站或所有使用者統計。一次讀取帳戶可用額度、週期消費、模型排行和每日趨勢；預設使用接口返回的目前顯示幣種和金額，不主動展示、推算或換算積分。只有使用者明確要求且接口真實返回積分時才展示。需要圖表時設定 visualize=true。",
      summary: "消費匯總",
      metric: "項目",
      amount: "金額",
      points: "積分",
      requests: "請求數",
      available: "可用額度折算金額",
      periodSpend: "週期消費",
      daily: "每日消費金額",
      models: "模型消費金額",
      dailyRequests: "每日調用次數",
      modelRequests: "模型調用次數",
      requestUnit: "次",
    };
  if (locale === "ja_JP")
    return {
      tool: "利用額サマリーを取得",
      description:
        "現在のユーザーまたは username で指定した一人のユーザーのみを照会します。全ユーザーの集計には使用できません。利用可能額、期間別利用額、モデル順位、日別推移を取得します。既定では API が返す表示通貨と金額を使用し、ユーザーが明示的に要求し API が実データを返した場合を除き、ポイントの表示・推定・換算は行いません。グラフには visualize=true を指定します。",
      summary: "利用額サマリー",
      metric: "項目",
      amount: "金額",
      points: "ポイント",
      requests: "リクエスト数",
      available: "利用可能額換算",
      periodSpend: "期間利用額",
      daily: "日別利用額",
      models: "モデル別利用額",
      dailyRequests: "日別リクエスト数",
      modelRequests: "モデル別リクエスト数",
      requestUnit: "回",
    };
  if (locale === "en_US")
    return {
      tool: "Get consumption summary",
      description:
        "Read consumption for the current user or one user selected by username. This tool cannot query all users. Returns available credit, period spend, model ranking, and daily trend. Use the display currency and amounts returned by the API. Do not show, infer, or convert points unless the user explicitly asks and the API returns real point values. Set visualize=true for charts.",
      summary: "Consumption summary",
      metric: "Metric",
      amount: "Amount",
      points: "Points",
      requests: "Requests",
      available: "Available credit equivalent",
      periodSpend: "Period spend",
      daily: "Daily spend",
      models: "Spend by model",
      dailyRequests: "Daily requests",
      modelRequests: "Requests by model",
      requestUnit: "requests",
    };
  return {
    tool: "查询消费汇总",
    description:
      "仅查询当前用户或 username 指定的单个用户，不支持全站或所有用户统计。一次读取账户可用额度、周期消费、模型排行和每日趋势；默认使用接口返回的当前显示币种和金额，不主动展示、推算或换算积分。只有用户明确要求且接口真实返回积分时才展示。需要图表时设置 visualize=true。",
    summary: "消费汇总",
    metric: "项目",
    amount: "金额",
    points: "积分",
    requests: "请求数",
    available: "可用额度折算金额",
    periodSpend: "周期消费",
    daily: "每日消费金额",
    models: "模型消费金额",
    dailyRequests: "每日调用次数",
    modelRequests: "模型调用次数",
    requestUnit: "次",
  };
}

function defaultFollowups(locale: ChatRequest["locale"]): [string, string] {
  if (locale === "zh_HK")
    return ["還有哪些功能適合我？", "可以給我一個常用操作示例嗎？"];
  if (locale === "ja_JP")
    return ["ほかに利用できる機能は？", "よく使う操作例を教えてください"];
  if (locale === "en_US")
    return ["What else can I do here?", "Show me an example of a common task"];
  return ["还有哪些功能适合我？", "可以给我一个常用操作示例吗？"];
}

export function selectFollowupSuggestions(
  message: string,
  candidates: string[],
  locale: ChatRequest["locale"],
): [string, string] {
  const original = message.trim();
  const normalized = [...candidates, ...defaultFollowups(locale)]
    .map((question) => question.trim())
    .filter(
      (question, index, all) =>
        question.length > 0 &&
        question.length <= 160 &&
        question !== original &&
        all.indexOf(question) === index,
    );
  return [normalized[0]!, normalized[1]!];
}

const sensitiveTraceKey =
  /^(authorization|cookie|password|passwd|secret|token|key|api[_-]?key|access[_-]?token|refresh[_-]?token|credential|certificate)$/i;

function finiteNumber(value: NumericJSON, field: string) {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result))
    throw new Error(`消费汇总返回了无效的 ${field}`);
  return result;
}

export function buildConsumptionArtifacts(
  result: ConsumptionResult,
  locale: ChatRequest["locale"],
  visualization?: ConsumptionVisualization,
): Artifact[] {
  const copy = consumptionCopy(locale);
  const number = new Intl.NumberFormat(locale.replaceAll("_", "-"), {
    maximumFractionDigits: 6,
  });
  const hasPoints =
    result.account.remaining_points !== undefined ||
    result.summary.points !== undefined;
  const columns = [
    { key: "metric", label: copy.metric },
    { key: "amount", label: copy.amount },
    ...(hasPoints ? [{ key: "points", label: copy.points }] : []),
    { key: "requests", label: copy.requests },
  ];
  const rows = [
    {
      metric: copy.available,
      amount: `${result.currency.symbol}${number.format(finiteNumber(result.account.remaining_amount, "remaining_amount"))}`,
      ...(hasPoints
        ? {
            points:
              result.account.remaining_points === undefined
                ? "-"
                : number.format(
                    finiteNumber(
                      result.account.remaining_points,
                      "remaining_points",
                    ),
                  ),
          }
        : {}),
      requests: "-",
    },
    {
      metric: copy.periodSpend,
      amount: `${result.currency.symbol}${number.format(finiteNumber(result.summary.amount, "summary.amount"))}`,
      ...(hasPoints
        ? {
            points:
              result.summary.points === undefined
                ? "-"
                : number.format(
                    finiteNumber(result.summary.points, "summary.points"),
                  ),
          }
        : {}),
      requests: number.format(result.summary.request_count),
    },
  ];
  const artifacts: Artifact[] = [
    { kind: "table", version: 1, title: copy.summary, columns, rows },
  ];
  if (visualization) {
    const byDay = visualization.data.startsWith("daily_");
    const byRequests = visualization.data.endsWith("_requests");
    const source = byDay ? result.daily : result.top_models;
    artifacts.push({
      kind: "chart",
      version: 1,
      title: byRequests
        ? byDay
          ? copy.dailyRequests
          : copy.modelRequests
        : byDay
          ? copy.daily
          : copy.models,
      chartType: visualization.chartType,
      unit: byRequests ? copy.requestUnit : result.currency.symbol,
      labels: source.map((item) =>
        "date" in item ? item.date : item.model_name,
      ),
      values: source.map((item) =>
        byRequests
          ? item.request_count
          : finiteNumber(
              item.amount,
              byDay ? "daily.amount" : "top_models.amount",
            ),
      ),
      sourceId: result.source_id,
      complete: true,
      generatedAt: result.generated_at,
    });
  }
  return artifacts;
}

function redactToolTrace(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);
  if (Array.isArray(value))
    return value.map((item) => redactToolTrace(item, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sensitiveTraceKey.test(key) ? "[REDACTED]" : redactToolTrace(item, seen),
    ]),
  );
}

// Keep a short tail so protocol-looking text split across stream chunks is never sent to the UI.
export function createAssistantTextGate(emit: (text: string) => void) {
  let pending = "";
  const protocolText = /<\s*(?:invoke|parameter)\s+name\s*=|<\s*\/\s*(?:invoke|parameter|think)\s*>|(?:^|\n)\s*result\s*[\[{]/i;
  return {
    push(delta: string) {
      pending += delta;
      if (protocolText.test(pending)) return false;
      if (pending.length > 80) {
        emit(pending.slice(0, -80));
        pending = pending.slice(-80);
      }
      return true;
    },
    flush() {
      if (pending) emit(pending);
      pending = "";
    },
  };
}

const systemPrompt = (
  assistantName: string,
  role: string,
) => `你是 AI Hub 的智能客服助手 ${assistantName}。当前用户角色是 ${role}。回答应准确、简洁，并优先使用工具获取当前用户的数据。
通用业务能力只能调用搜索结果中当前用户可用的 operation ID，执行前必须读取能力详情；搜索时优先使用当前页面名称或准确的 operation ID，结果标记 truncated 或有 next_cursor 时必须继续翻页或缩小搜索范围，不能据第一页没有匹配就断言能力不存在；消费和媒体等专用工具可直接调用。写操作只准备一次并等待用户在卡片确认；execute_capability 返回 pending_confirmation 或 awaiting_parameters 后立即停止调用工具，不能再次执行、查询或重新准备同一操作。navigate 操作只能引导用户前往控制台。
只读查询在参数齐全时直接调用并回答，不要询问用户是否确认查询；缺少必填条件时才让用户在参数表单中补充。确认卡片只用于写操作。
查询“最近”或“过去 N 分钟”的数据时，如果目标接口支持 start_timestamp 和 end_timestamp，必须向 execute_capability 传 recent_minutes，让系统按当前时间计算；禁止自行计算或猜测 Unix 时间戳。需要倒序时传 order: "-created_at"，不能传 order: "desc"。
用户询问“如何使用、在哪里设置、怎么创建”等操作方法时，必须先调用 list_workflows；手册不足时再调用 search_capabilities 和 describe_capability。操作咨询只说明步骤并提供页面入口，不调用 execute_capability。只有用户明确要求代为查询或操作时才进入执行流程。
询问“如何配置页面权限”时，以 q="页面权限" 调用 list_workflows。页面权限是控制台配置，不要求通用能力搜索一定返回接口；根据流程结果说明系统设置中的页面权限标签、按角色勾选页面并保存。无权访问时明确告知，不声称页面不存在。
用户询问“你能做什么、可以帮我什么、管理员能做什么”等助手能力问题时，必须先调用 get_role_guide，并且只介绍工具返回的当前角色和页面权限范围内的能力。
用户明确要求代为执行且能力支持 guided_confirm 时，立即调用 execute_capability 生成浏览器表单；不要在正文中逐项询问，也不要索取 API Key、密码或凭据。表单已提供字段和按钮时只简短提示用户在卡片中完成。
用户明确要求代为创建当前用户的 API Key 时，调用 start_api_key_page_workflow 一次，然后等待浏览器中的工作流卡片收集名称、填写页面并取得用户最终确认。不要同时调用 execute_capability，也不要在正文索取名称。若用户只是询问如何创建，仍使用操作手册说明，不启动工作流。
用户要求指导创建渠道时，以 q="创建渠道" 调用 list_workflows，使用页面引导卡片；供应商凭据只能由用户在页面表单输入。不要通过 execute_capability 收集渠道密钥。
当前用户或指定单个用户的余额、消费、额度和模型消费分布问题优先使用 get_consumption_summary。用户询问全站消费最高的用户且未指定时间范围时，搜索并读取 get.api.user 的能力详情，再以 order=-used_quota、size=5 查询；used_amount 是响应字段，排序字段是 used_quota。用户指定最近 N 天、某月或起止日期的全站用户消费排行时，使用用户统计页面的真实查询流程：搜索并读取 get.api.user 与 get.api.analytics.multi_user_stats；用 get.api.user 的 page=1、size=100、order=-id 开始分页，按返回的 total_count 继续获取全部用户，将实际 username 用逗号连接后传入 multi_user_stats 的 usernames。最近 N 天使用 recent_days=N 自动生成 start_time/end_time；明确日期则传 YYYY-MM-DD。用户较多时分批查询并合并所有用户结果，按 response.data 中的 amount 数值降序取前 N 名，同时展示 currency、request_count 和真实日期范围；未指定数量默认前 5 名。不能仅凭累计 used_quota 的前几名推断期间排行，也不能遗漏未翻页的用户后声称是全站排行。multi_user_stats 与用户统计页面一样按自然日汇总，不要把 group_type=user 传给 get.api.analytics.period。用户明确要求全站按模型或渠道的消费统计时，搜索并读取 get.api.analytics.period 的能力详情，以接口支持的 group_type 执行且不传 user_id 和 user_ids；查询“最近 N 天”时传 recent_minutes=N*1440。无权访问时明确告知，不能改用个人数据冒充全站。全站回答只能使用对应接口返回的数据，不加入个人余额或个人累计消费。用户询问当前账号是否有专属模型折扣时，搜索并读取 get.api.user-model-prices.self 的能力详情，以 query.discounts_only="true" 查询；discounts 为空表示 user_model_discounts 中当前用户没有专属规则，群组价格调整应另行查询完整模型价格。指定其他用户时使用 get.api.user-model-prices.users.id，并传同样的查询参数及用户 ID。用户明确要求单用户消费图表，或在单用户消费查询后同意生成图表时，沿用上一轮的 period、username 等条件再次调用 get_consumption_summary，并设置 visualize=true、唯一的 chart_type 和 chart_data。饼图使用 pie，环状图使用 donut；调用次数使用 *_requests，金额使用 *_amount。用户未指定样式时，按日期趋势使用 line，分类占比使用 donut。每轮最多生成一个图表，不得为了同一请求重复调用图表工具。消费结果的 source_id 不是 execution_id，不能传给 get_execution 或 chart_execution；chart_execution 仅接受 execute_capability 返回的 execution_id。全站按模型或渠道的消费图表必须使用 chart_execution 分析 get.api.analytics.period 的真实执行结果，rows_path="response.data.channel_statistics"、group="channel"、value="amount"；金额字符串可直接聚合，无需手工换算或改用请求数。已有对应执行结果时直接复用 execution_id。图表由工具生成可视化卡片，不要用字符条形图或代码块模拟，也不要向用户输出内部尝试和反复权衡过程。
不要请求、接收或泄露 Token、Key、Cookie、密码、证书或供应商凭据。超时或结果不明确时查询原 execution，不要重复提交。
链接、表格和操作按钮由工具结果生成。工具已生成页面入口时，正文不要再输出同一页面的 Markdown 链接。
每轮最多提供一个页面入口。list_workflows 或 describe_capability 已返回页面入口时，不再调用 open_console_page。
涉及风险、计费或权限时应明确说明。默认使用用户当前语言回答。
每次完成正文后必须调用 suggest_followups，提供两个与本轮最相关、当前用户有权继续询问且互不重复的问题。问题使用用户当前语言，不要在正文中重复列出它们。`;

export class PiService {
  private readonly runtimes = new Map<string, Runtime>();
  private readonly activeRuntimeKeys = new Map<string, string>();
  private readonly cleanupTimer = setInterval(() => {
    for (const [key, runtime] of this.runtimes) {
      if (
        !runtime.session.isStreaming &&
        Date.now() - runtime.lastUsed > 30 * 60_000
      ) {
        runtime.session.dispose();
        this.runtimes.delete(key);
        for (const [thread, active] of this.activeRuntimeKeys)
          if (active === key) this.activeRuntimeKeys.delete(thread);
      }
    }
  }, 60_000).unref();

  close() {
    clearInterval(this.cleanupTimer);
    for (const runtime of this.runtimes.values()) {
      void runtime.session.abort();
      runtime.session.dispose();
    }
    this.runtimes.clear();
  }
  private contextFile(userID: number, threadID: string) {
    if (!/^[0-9a-f-]{36}$/i.test(threadID)) throw new Error("无效会话 ID");
    return path.join(
      this.config.dataDir,
      "contexts",
      String(userID),
      `${threadID}.json`,
    );
  }

  constructor(
    private readonly config: AgentConfig,
    private readonly client: AiHubClient,
    private readonly actions: ActionStore,
  ) {}

  private tools(
    user: CurrentUser,
    runtimeCookie: () => string,
    runtimePageContext: () => ChatRequest["page"],
    locale: ChatRequest["locale"],
    turnGeneration: () => number,
    turnChartType: () => ChartType | undefined,
    setSuggestions: (questions: [string, string]) => void,
  ) {
    let navigationTurn: number | undefined;
    const claimNavigation = (artifact: Artifact | undefined): Artifact | undefined => {
      if (!artifact || (artifact.kind !== "link" && artifact.kind !== "page_workflow")) return artifact;
      const turn = turnGeneration();
      if (navigationTurn === turn) return undefined;
      navigationTurn = turn;
      return artifact;
    };
    const getConsumptionSummary = defineTool({
      name: "get_consumption_summary",
      label: consumptionCopy(locale).tool,
      description: consumptionCopy(locale).description,
      parameters: Type.Object({
        period: Type.Optional(
          Type.Union([
            Type.Literal("today"),
            Type.Literal("yesterday"),
            Type.Literal("last_7_days"),
            Type.Literal("last_30_days"),
            Type.Literal("current_month"),
            Type.Literal("previous_month"),
            Type.Literal("custom"),
          ]),
        ),
        start_date: Type.Optional(
          Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        ),
        end_date: Type.Optional(
          Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        ),
        username: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
        top_limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
        visualize: Type.Optional(Type.Boolean()),
        chart_type: Type.Optional(
          Type.Union(
            [
              Type.Literal("bar"),
              Type.Literal("line"),
              Type.Literal("pie"),
              Type.Literal("donut"),
            ],
            {
              description:
                "只生成这一种图表。饼图用 pie，环状图或圆环图用 donut。",
            },
          ),
        ),
        chart_data: Type.Optional(
          Type.Union(
            [
              Type.Literal("daily_amount"),
              Type.Literal("daily_requests"),
              Type.Literal("model_amount"),
              Type.Literal("model_requests"),
            ],
            {
              description:
                "图表唯一的数据维度；调用次数必须选 *_requests，消费金额选 *_amount。",
            },
          ),
        ),
      }),
      execute: async (_id, params) => {
        const query = new URLSearchParams({
          period: params.period ?? "current_month",
          top_limit: String(params.top_limit ?? 10),
        });
        if (params.start_date) query.set("start_date", params.start_date);
        if (params.end_date) query.set("end_date", params.end_date);
        if (params.username) query.set("username", params.username);
        const result = await this.client.request<ConsumptionResult>(
          `${toolBinding("get_consumption_summary").endpoint}?${query}`,
          runtimeCookie(),
        );
        const chartData = params.chart_data ?? "daily_amount";
        const chartType =
          turnChartType() ??
          params.chart_type ??
          (chartData.startsWith("daily_") ? "line" : "donut");
        const artifacts = buildConsumptionArtifacts(
          result,
          locale,
          params.visualize ? { chartType, data: chartData } : undefined,
        );
        const { source_id: _sourceID, ...modelResult } = result;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ...modelResult,
                visualization: {
                  tool: "get_consumption_summary",
                  parameters: {
                    ...params,
                    visualize: true,
                    chart_type: chartType,
                    chart_data: chartData,
                  },
                },
              }),
            },
          ],
          details: { artifacts, trace: { response: result } },
        };
      },
    });
    const openPage = defineTool({
      name: "open_console_page",
      label: "生成控制台入口",
      description: "生成当前用户可访问的 AI Hub 控制台页面链接。查看系统运行配置时选择 setting，查看运营配置时选择 operation_setting，配置页面权限时选择 page_permission；不要用 dashboard 代替目标页面。",
      parameters: Type.Object({
        page: Type.Union([
          Type.Literal("dashboard"),
          Type.Literal("token"),
          Type.Literal("log"),
          Type.Literal("playground"),
          Type.Literal("setting"),
          Type.Literal("operation_setting"),
          Type.Literal("page_permission"),
        ]),
      }),
      execute: async (_id, params) => {
        if (params.page !== "playground" && !user.page_access?.[params.page]) {
          const details: { artifact?: Artifact } = {};
          return {
            content: [
              { type: "text" as const, text: "当前用户无权访问该控制台页面。" },
            ],
            details,
          };
        }
        const routes = {
          dashboard: "/panel/dashboard",
          token: "/panel/token",
          log: "/panel/log",
          playground: "/playground",
          setting: "/panel/setting#system",
          operation_setting: "/panel/setting#operation",
          page_permission: "/panel/setting#permissions",
        } as const;
        const artifact: Artifact = {
          kind: "link",
          version: 1,
          title:
            params.page === "setting"
              ? "前往系统设置"
              : params.page === "operation_setting"
                ? "前往运营设置"
                : params.page === "page_permission"
                  ? "前往页面权限"
                : "前往 AI Hub",
          description: `以 ${user.username} 的当前权限打开`,
          label: "打开页面",
          href: routes[params.page],
        };
        const claimedArtifact = claimNavigation(artifact);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(artifact) }],
          details: { ...(claimedArtifact ? { artifact: claimedArtifact } : {}) },
        };
      },
    });
    const prepareRefresh = defineTool({
      name: "prepare_refresh_usage",
      label: "准备刷新账户金额",
      description:
        "创建一个需要用户点击确认的刷新按钮；确认后按当前显示币种读取可用额度、累计消费金额和累计请求数，不以积分作为默认展示口径。",
      parameters: Type.Object({}),
      execute: async () => {
        const artifact: Artifact = {
          kind: "action",
          version: 1,
          title: "刷新账户金额",
          description:
            "点击后按当前显示币种重新读取可用额度、累计消费金额和累计请求数，不会修改数据。",
          label: "执行刷新",
          actionId: this.actions.create(user.id),
          tone: "primary",
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(artifact) }],
          details: { artifact },
        };
      },
    });
    const getRoleGuide = defineTool({
      name: "get_role_guide",
      label: "读取当前角色助手能力",
      description:
        "用户询问助手能做什么时，读取当前角色和页面权限范围内的已发布能力指南与典型问题。",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              await this.client.getRoleGuide(runtimeCookie(), locale),
            ),
          },
        ],
        details: {},
      }),
    });
    const suggestFollowups = defineTool({
      name: "suggest_followups",
      label: "生成相关问题",
      description:
        "在正文完成后调用一次，给出两个结合本轮上下文、当前角色与权限的后续问题。",
      parameters: Type.Object({
        questions: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
          minItems: 2,
          maxItems: 2,
        }),
      }),
      execute: async (_id, { questions }) => {
        const normalized = questions.map((question) => question.trim()) as [
          string,
          string,
        ];
        if (!normalized[0] || !normalized[1] || normalized[0] === normalized[1])
          throw new Error("推荐问题必须是两个不同的非空问题");
        setSuggestions(normalized);
        return {
          content: [{ type: "text" as const, text: "推荐问题已准备。" }],
          details: {},
        };
      },
    });
    return [
      getConsumptionSummary,
      openPage,
      prepareRefresh,
      getRoleGuide,
      suggestFollowups,
      ...businessTools(
        this.client,
        runtimeCookie,
        runtimePageContext,
        turnGeneration,
        Date.now,
        turnChartType,
        claimNavigation,
      ),
    ];
  }

  private async createRuntime(
    key: string,
    user: CurrentUser,
    cookie: string,
    token: string,
    settings: RuntimeSettings,
    locale: ChatRequest["locale"],
    pageContext?: ChatRequest["page"],
  ) {
    let currentCookie = cookie;
    let currentPageContext = pageContext;
    let turnGeneration = 0;
    let currentChartType: ChartType | undefined;
    let pendingSuggestions: [string, string] | undefined;
    const modelRuntime = await ModelRuntime.create();
    modelRuntime.registerProvider("aihub", {
      name: "AI Hub",
      baseUrl: `${this.config.aiHubUrl}/api/user/self/assistant/models`,
      apiKey: token,
      authHeader: false,
      streamSimple: (model, context, options) =>
        streamSimple({ ...model, api: "openai-completions" }, context, {
          ...options,
          headers: this.client.headers(currentCookie),
        }),
      api: "openai-completions",
      models: [
        {
          id: settings.model,
          name: settings.model,
          reasoning: settings.reasoning,
          input: this.config.imageInput ? ["text", "image"] : ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: this.config.contextWindow,
          maxTokens: this.config.maxTokens,
          compat: {
            supportsFinishReason: false,
            supportsStore: false,
            supportsDeveloperRole: false,
            supportsStrictMode: false,
            maxTokensField: "max_tokens",
          },
        },
      ],
    });
    await modelRuntime.setRuntimeApiKey("aihub", token);
    const model = modelRuntime.getModel("aihub", settings.model);
    if (!model) throw new Error(`未找到模型 ${settings.model}`);
    const loader = new DefaultResourceLoader({
      cwd: this.config.dataDir,
      agentDir: this.config.dataDir,
      systemPromptOverride: () =>
        systemPrompt(
          settings.assistantName,
          user.role >= 100
            ? "超级管理员"
            : user.role >= 10
              ? "管理员"
              : "普通用户",
        ),
      appendSystemPromptOverride: () => [],
    });
    await loader.reload();
    const settingsManager = SettingsManager.inMemory({
      compaction: {
        enabled: true,
        reserveTokens: contextReserveTokens(this.config.contextWindow),
        keepRecentTokens: 20_000,
      },
      retry: {
        enabled: false,
        maxRetries: 0,
        provider: {
          timeoutMs: settings.requestTimeoutMs,
          maxRetries: 1,
          maxRetryDelayMs: 2_000,
        },
      },
      httpIdleTimeoutMs: settings.requestTimeoutMs,
      enableAnalytics: false,
      enableInstallTelemetry: false,
    });
    const customTools = this.tools(
      user,
      () => currentCookie,
      () => currentPageContext,
      locale,
      () => turnGeneration,
      () => currentChartType,
      (questions) => {
        pendingSuggestions = questions;
      },
    );
    const { session } = await createAgentSession({
      cwd: this.config.dataDir,
      agentDir: this.config.dataDir,
      modelRuntime,
      model,
      thinkingLevel: settings.thinkingLevel as never,
      noTools: "builtin",
      tools: customTools.map((tool) => tool.name),
      customTools,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(this.config.dataDir),
      settingsManager,
    });
    const threadID = key.split(":")[1]!;
    try {
      const saved = JSON.parse(
        await readFile(this.contextFile(user.id, threadID), "utf8"),
      );
      if ((saved.version === 1 || saved.version === 2) && Array.isArray(saved.messages))
        session.agent.state.messages = saved.messages;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const runtime: Runtime = {
      session,
      modelRuntime,
      cookie: currentCookie,
      pageContext: currentPageContext,
      beginTurn: (message) => {
        turnGeneration += 1;
        currentChartType = requestedChartType(message);
        pendingSuggestions = undefined;
      },
      takeSuggestions: () => pendingSuggestions,
      lastUsed: Date.now(),
    };
    Object.defineProperty(runtime, "cookie", {
      get: () => currentCookie,
      set: (value: string) => {
        currentCookie = value;
      },
      enumerable: true,
    });
    Object.defineProperty(runtime, "pageContext", {
      get: () => currentPageContext,
      set: (value: ChatRequest["page"]) => {
        currentPageContext = value;
      },
      enumerable: true,
    });
    this.runtimes.set(key, runtime);
    return runtime;
  }

  async run(
    user: CurrentUser,
    cookie: string,
    request: ChatRequest,
    threadId: string,
    settings: RuntimeSettings,
    emit: Emit,
  ): Promise<Omit<TurnMetrics, "characterCount">> {
    const startedAt = performance.now();
    let firstTokenAt: number | undefined;
    let responseId: string | undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let hasReasoningUsage = false;
    let compactedUsage: ContextUsage | undefined;
    const threadKey = `${user.id}:${threadId}`;
    const key = `${threadKey}:${settings.model}:${settings.assistantName}:${settings.thinkingLevel}:${settings.reasoning}:${settings.requestTimeoutMs}:${request.locale}`;
    const token = "session-authenticated";
    if (settings.protocolVersion !== 1)
      throw new Error("助手协议版本不兼容，请升级 Agent");
    const previousKey = this.activeRuntimeKeys.get(threadKey);
    if (previousKey && previousKey !== key) {
      const previous = this.runtimes.get(previousKey);
      if (previous) {
        await previous.session.abort();
        previous.session.dispose();
        this.runtimes.delete(previousKey);
      }
    }
    const runtime =
      this.runtimes.get(key) ??
      (await this.createRuntime(
        key,
        user,
        cookie,
        token,
        settings,
        request.locale,
        request.page,
      ));
    this.activeRuntimeKeys.set(threadKey, key);
    runtime.cookie = cookie;
    runtime.pageContext = request.page;
    runtime.beginTurn(request.message);
    runtime.lastUsed = Date.now();
    await runtime.modelRuntime.setRuntimeApiKey("aihub", token);
    let terminalError: string | undefined;
    let emittedChart = false;
    const textGate = createAssistantTextGate((delta) =>
      emit({ version: 1, type: "message.text.delta", delta }),
    );
    const emitArtifact = (artifact: Artifact) => {
      if (artifact.kind === "chart") {
        if (emittedChart) return;
        emittedChart = true;
      }
      emit({ version: 1, type: "artifact.created", artifact });
    };
    const unsubscribe = runtime.session.subscribe((rawEvent) => {
      const event = rawEvent as any;
      if (event.type === "compaction_end" && !event.aborted && event.result) {
        const tokens = event.result.estimatedTokensAfter;
        compactedUsage = {
          tokens: typeof tokens === "number" ? tokens : null,
          contextWindow: this.config.contextWindow,
          percent: typeof tokens === "number" ? tokens / this.config.contextWindow * 100 : null,
        };
      }
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "text_delta"
      ) {
        firstTokenAt ??= performance.now();
        if (!textGate.push(event.assistantMessageEvent.delta) && !terminalError) {
          terminalError = "模型输出了无效的工具调用文本，请更换支持工具调用的模型后重试";
          void runtime.session.abort();
        }
      }
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "thinking_delta" &&
        settings.reasoning &&
        settings.thinkingLevel !== "off"
      ) {
        firstTokenAt ??= performance.now();
        emit({
          version: 1,
          type: "message.reasoning.delta",
          delta: event.assistantMessageEvent.delta,
        });
      }
      if (
        event.type === "tool_execution_start" &&
        event.toolName !== "suggest_followups"
      ) {
        if (!terminalError) textGate.flush();
        emit({
          version: 1,
          type: "tool.started",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: redactToolTrace(event.args),
        });
      }
      if (event.type === "tool_execution_end") {
        if (event.toolName === "suggest_followups") return;
        const artifact = event.result?.details?.artifact as
          Artifact | undefined;
        const artifacts = event.result?.details?.artifacts as
          Artifact[] | undefined;
        const traceResult =
          event.result?.details?.trace?.response ?? event.result?.details;
        emit(
          event.isError
            ? {
                version: 1,
                type: "tool.failed",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                message: "工具执行失败",
              }
            : {
                version: 1,
                type: "tool.completed",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                result: redactToolTrace(traceResult),
              },
        );
        if (artifact) emitArtifact(artifact);
        for (const item of artifacts ?? []) emitArtifact(item);
      }
      if (event.type === "message_end" && event.message?.role === "assistant") {
        responseId = event.message.responseId || responseId;
        inputTokens += Math.max(0, event.message.usage?.input || 0);
        outputTokens += Math.max(0, event.message.usage?.output || 0);
        if (typeof event.message.usage?.reasoning === "number") {
          hasReasoningUsage = true;
          reasoningTokens += Math.max(0, event.message.usage.reasoning);
        }
        if (
          event.message.stopReason === "error" ||
          event.message.stopReason === "aborted"
        ) {
          terminalError ??=
            event.message.errorMessage ||
            (event.message.stopReason === "aborted"
              ? "模型请求已取消"
              : "模型返回错误");
        }
        if (!terminalError) textGate.flush();
      }
    });
    try {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          void runtime.session.abort();
          reject(
            new Error(
              `模型在 ${Math.round(settings.requestTimeoutMs / 1000)} 秒内没有完成响应`,
            ),
          );
        }, settings.requestTimeoutMs);
      });
      try {
        await Promise.race([
          runtime.session.prompt(
            request.message,
            request.images.length
              ? {
                  images: request.images.map((image) => ({
                    type: "image" as const,
                    data: image.data,
                    mimeType: image.mimeType,
                  })),
                }
              : undefined,
          ),
          timeoutPromise,
        ]);
        if (terminalError) throw new Error(terminalError);
        textGate.flush();
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      let questions = runtime.takeSuggestions();
      if (!questions) {
        let candidates: string[] = [];
        try {
          const guide = await this.client.getRoleGuide(cookie, request.locale);
          candidates = guide.starter_questions;
        } catch {
          // A role-guide outage must not fail an otherwise successful answer.
        }
        questions = selectFollowupSuggestions(
          request.message,
          candidates,
          request.locale,
        );
      }
      const metrics: Omit<TurnMetrics, "characterCount"> = {
        totalMs: Math.max(0, Math.round(performance.now() - startedAt)),
        inputTokens,
        outputTokens,
      };
      if (responseId) metrics.responseId = responseId;
      if (firstTokenAt !== undefined)
        metrics.firstTokenMs = Math.max(
          0,
          Math.round(firstTokenAt - startedAt),
        );
      if (hasReasoningUsage) metrics.reasoningTokens = reasoningTokens;
      const sessionUsage = runtime.session.getContextUsage();
      metrics.contextUsage = sessionUsage?.tokens === null && compactedUsage
        ? compactedUsage
        : sessionUsage ?? { tokens: null, contextWindow: this.config.contextWindow, percent: null };
      const file = this.contextFile(user.id, threadId);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(
        `${file}.tmp`,
        JSON.stringify({ version: 2, messages: runtime.session.messages, contextUsage: metrics.contextUsage }),
        { mode: 0o600 },
      );
      await rename(`${file}.tmp`, file);
      emitArtifact({ kind: "suggestions", version: 1, questions });
      runtime.lastUsed = Date.now();
      return metrics;
    } catch (error) {
      runtime.session.dispose();
      this.runtimes.delete(key);
      this.activeRuntimeKeys.delete(threadKey);
      throw error;
    } finally {
      unsubscribe();
    }
  }

  abort(userId: number, threadId: string) {
    const key = this.activeRuntimeKeys.get(`${userId}:${threadId}`);
    if (key) void this.runtimes.get(key)?.session.abort();
  }

  async getContextUsage(userId: number, threadId: string): Promise<ContextUsage> {
    const key = this.activeRuntimeKeys.get(`${userId}:${threadId}`);
    const active = key ? this.runtimes.get(key) : undefined;
    const live = active?.session.getContextUsage();
    if (live?.tokens !== null && live !== undefined) return live;
    try {
      const saved = JSON.parse(await readFile(this.contextFile(userId, threadId), "utf8"));
      if (saved.version === 2 && saved.contextUsage) {
        const tokens = saved.contextUsage.tokens;
        return {
          tokens,
          contextWindow: this.config.contextWindow,
          percent: typeof tokens === "number" ? tokens / this.config.contextWindow * 100 : null,
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return live ?? { tokens: null, contextWindow: this.config.contextWindow, percent: null };
  }

  async reset(userId: number, threadId: string) {
    await rm(this.contextFile(userId, threadId), { force: true });
    const threadKey = `${userId}:${threadId}`;
    const key = this.activeRuntimeKeys.get(threadKey);
    if (!key) return;
    const runtime = this.runtimes.get(key);
    if (runtime) {
      void runtime.session.abort();
      runtime.session.dispose();
      this.runtimes.delete(key);
    }
    this.activeRuntimeKeys.delete(threadKey);
  }
}
