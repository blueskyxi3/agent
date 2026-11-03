import { LoadingSkeleton } from "./LoadingSkeleton";
import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  AssistantRuntimeProvider,
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useLocalRuntime,
  type ThreadAssistantMessagePart,
  type DataMessagePartProps,
  type ReasoningMessagePartProps,
  type TextMessagePartProps,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import {
  ArrowSquareOut,
  ArrowsIn,
  ArrowsOut,
  ArrowUp,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  ImageSquare,
  ListBullets,
  Palette,
  PlusCircle,
  SpinnerGap,
  Stop,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Artifact, ContextUsage, TurnMetrics } from "@ai-hub-agent/contracts";

import {
  createChatAdapter,
  type FailedTurnDetails,
  type PendingImage,
} from "./chat-adapter";
import type { AssistantBackgroundId, MountOptions } from "./types";
import neuralOcean from "./assets/chat-backgrounds/neural-ocean.webp?no-inline";
import auroraMesh from "./assets/chat-backgrounds/aurora-mesh.webp?no-inline";
import cloudStream from "./assets/chat-backgrounds/cloud-stream.webp?no-inline";
import sandCircuit from "./assets/chat-backgrounds/sand-circuit.webp?no-inline";
import graphiteTopology from "./assets/chat-backgrounds/graphite-topology.webp?no-inline";
import { BusinessArtifact } from "./BusinessArtifact";
import { PageWorkflowArtifact } from "./PageWorkflowArtifact";
import { ExcelExportButton } from "./ExcelExportButton";
import { VoiceControls } from "./VoiceControls";
import { VoiceInput } from "./VoiceInput";
import { VoiceConversationInput } from "./VoiceConversationInput";
import { toolStepState } from "./tool-step";

const labels = (locale: string) =>
  locale.startsWith("zh")
    ? {
        title: "智能助手",
        placeholder: "输入你的问题...",
        reasoning: "推理过程",
        close: "关闭",
        maximize: "最大化",
        minimize: "还原",
        image: "添加图片",
        send: "发送",
        stop: "停止生成",
        tool: "正在调用工具",
        failed: "执行失败",
        remove: "移除图片",
        newThread: "新增会话",
        questionLibrary: "常用问题",
        background: "切换聊天背景",
        backgroundSaveFailed: "背景保存失败，已恢复原设置",
        solidBackground: "纯色",
        history: "历史记录",
        clear: "清空对话",
        emptyHistory: "暂无历史记录",
        historyLoadFailed: "历史记录加载失败",
        retry: "重试",
        select: "选择",
        cancelSelect: "取消",
        selectAll: "全选",
        selectedCount: /^zh[-_]HK/i.test(locale) ? "已選擇" : "已选择",
        deleteOne: "删除这条记录",
        deleteSelected: "删除所选",
        deleting: "正在删除...",
        deleteDialogTitle: /^zh[-_]HK/i.test(locale) ? "刪除對話" : "删除会话",
        deleteBatchDialogTitle: /^zh[-_]HK/i.test(locale)
          ? "刪除所選對話"
          : "删除所选会话",
        deleteDialogDescription: /^zh[-_]HK/i.test(locale)
          ? "此操作無法復原，相關訊息和生成結果也會一併刪除。"
          : "这项操作无法撤销，相关消息和生成结果将一并删除。",
        cancelDelete: /^zh[-_]HK/i.test(locale) ? "保留對話" : "保留会话",
        confirmDelete: /^zh[-_]HK/i.test(locale) ? "確認刪除" : "确认删除",
        deleteFailed: "历史记录删除失败",
        suggestionsLabel: "你可以这样问",
        suggestions: [
          "我还有多少可用额度？",
          "在哪里创建 API Key？",
          "如何在体验中心测试模型？",
        ],
      }
    : {
        title: "AI Assistant",
        placeholder: "Ask a question...",
        reasoning: "Reasoning",
        close: "Close",
        maximize: "Maximize",
        minimize: "Restore",
        image: "Add image",
        send: "Send",
        stop: "Stop",
        tool: "Using tool",
        failed: "Failed",
        remove: "Remove image",
        newThread: "New conversation",
        questionLibrary: locale.startsWith("ja")
          ? "よくある質問"
          : "Common questions",
        background: locale.startsWith("ja")
          ? "チャット背景を変更"
          : "Change chat background",
        backgroundSaveFailed: locale.startsWith("ja")
          ? "背景を保存できませんでした"
          : "Failed to save background",
        solidBackground: locale.startsWith("ja") ? "単色" : "Solid",
        history: "History",
        clear: "Clear conversation",
        emptyHistory: "No conversation history",
        historyLoadFailed: "Failed to load history",
        retry: "Retry",
        select: "Select",
        cancelSelect: "Cancel",
        selectAll: "Select all",
        selectedCount: locale.startsWith("ja") ? "選択済み" : "Selected",
        deleteOne: "Delete this conversation",
        deleteSelected: "Delete selected",
        deleting: "Deleting...",
        deleteDialogTitle: locale.startsWith("ja")
          ? "会話を削除"
          : "Delete conversation",
        deleteBatchDialogTitle: locale.startsWith("ja")
          ? "選択した会話を削除"
          : "Delete selected conversations",
        deleteDialogDescription: locale.startsWith("ja")
          ? "この操作は取り消せません。メッセージと生成結果も削除されます。"
          : "This action cannot be undone. Messages and generated results will also be removed.",
        cancelDelete: locale.startsWith("ja")
          ? "会話を残す"
          : "Keep conversation",
        confirmDelete: locale.startsWith("ja") ? "削除する" : "Delete",
        deleteFailed: "Failed to delete conversation history",
        suggestionsLabel: "Try asking",
        suggestions: [
          "How much credit do I have left?",
          "Where can I create an API key?",
          "How do I test a model in the playground?",
        ],
      };

const chatBackgrounds: Array<{
  id: AssistantBackgroundId;
  name: string;
  image?: string;
  overlay: string;
  position: string;
}> = [
  { id: "solid", name: "", overlay: "100%", position: "center" },
  {
    id: "neural-ocean",
    name: "深海神经星图",
    image: neuralOcean,
    overlay: "68%",
    position: "52% center",
  },
  {
    id: "aurora-mesh",
    name: "青紫极光网格",
    image: auroraMesh,
    overlay: "70%",
    position: "center 42%",
  },
  {
    id: "cloud-stream",
    name: "银白云端数据流",
    image: cloudStream,
    overlay: "64%",
    position: "48% center",
  },
  {
    id: "sand-circuit",
    name: "暖沙金色电路",
    image: sandCircuit,
    overlay: "66%",
    position: "center 45%",
  },
  {
    id: "graphite-topology",
    name: "石墨紫拓扑",
    image: graphiteTopology,
    overlay: "68%",
    position: "55% center",
  },
];

function toolCopy(locale: string) {
  const traditional = /^zh[-_]HK/i.test(locale);
  const chinese = locale.startsWith("zh");
  const japanese = locale.startsWith("ja");
  const common = traditional
    ? {
        request: "請求參數",
        response: "返回結果",
        running: "執行中",
        completed: "已完成",
        failed: "執行失敗",
      }
    : chinese
      ? {
          request: "请求参数",
          response: "返回结果",
          running: "执行中",
          completed: "已完成",
          failed: "执行失败",
        }
      : japanese
        ? {
            request: "リクエスト",
            response: "レスポンス",
            running: "実行中",
            completed: "完了",
            failed: "失敗",
          }
        : {
            request: "Request",
            response: "Response",
            running: "Running",
            completed: "Completed",
            failed: "Failed",
          };
  const descriptions: Record<string, [string, string]> = chinese
    ? {
        search_capabilities: [
          traditional ? "搜尋可用能力" : "搜索可用能力",
          traditional
            ? "依目前角色與頁面權限，搜尋可操作的 AI Hub API。"
            : "按当前角色与页面权限，搜索可操作的 AI Hub API。",
        ],
        describe_capability: [
          traditional ? "讀取能力詳情" : "读取能力详情",
          traditional
            ? "讀取指定操作的參數 Schema、權限、風險與執行方式。"
            : "读取指定操作的参数 Schema、权限、风险与执行方式。",
        ],
        execute_capability: [
          traditional ? "執行系統能力" : "执行系统能力",
          traditional
            ? "呼叫已審核的業務 API；缺少參數時顯示補充表單，修改操作仍需確認。"
            : "调用已审核的业务 API；缺少参数时显示补充表单，修改操作仍需确认。",
        ],
        get_execution: [
          traditional ? "查詢執行狀態" : "查询执行状态",
          traditional
            ? "依執行 ID 讀取目前狀態與已脫敏結果。"
            : "按执行 ID 读取当前状态与已脱敏结果。",
        ],
        list_workflows: [
          traditional ? "讀取安全流程" : "读取安全流程",
          traditional
            ? "讀取 API Key、渠道與統計等模組的安全操作順序。"
            : "读取 API Key、渠道和统计等模块的安全操作顺序。",
        ],
        chart_execution: [
          traditional ? "分析執行資料" : "分析执行数据",
          traditional
            ? "使用真實 API 執行結果分組彙總並產生圖表。"
            : "使用真实 API 执行结果分组汇总并生成图表。",
        ],
        generate_image: [
          traditional ? "產生圖片" : "生成图片",
          traditional
            ? "提交個人圖片模型生成請求。"
            : "提交个人图片模型生成请求。",
        ],
        generate_video: [
          traditional ? "產生影片" : "生成视频",
          traditional ? "提交非同步影片生成任務。" : "提交异步视频生成任务。",
        ],
        get_my_usage: [
          traditional ? "查詢帳戶金額" : "查询账户金额",
          traditional
            ? "讀取目前幣種下的可用額度、累計消費金額與請求次數。"
            : "读取当前币种下的可用额度、累计消费金额和请求次数。",
        ],
        get_today_consumption: [
          traditional ? "查詢今日消費" : "查询今日消费",
          traditional
            ? "依資料看板口徑讀取今日即時消費金額。"
            : "按数据看板口径读取今日实时消费金额。",
        ],
        get_consumption_summary: [
          traditional ? "查詢消費匯總" : "查询消费汇总",
          traditional
            ? "按目前顯示幣種讀取金額；除非明確要求且接口返回，否則不展示或換算積分。"
            : "按当前显示币种读取金额；除非明确要求且接口返回，否则不展示或换算积分。",
        ],
        prepare_refresh_usage: [
          traditional ? "重新整理帳戶金額" : "刷新账户金额",
          traditional
            ? "按目前顯示幣種重新讀取可用額度、累計消費和請求數。"
            : "按当前显示币种重新读取可用额度、累计消费和请求数。",
        ],
      }
    : japanese
      ? {
          search_capabilities: [
            "利用可能な機能を検索",
            "現在のロールとページ権限に基づいて AI Hub API を検索します。",
          ],
          describe_capability: [
            "機能の詳細を取得",
            "指定操作のスキーマ、権限、リスク、実行方式を取得します。",
          ],
          execute_capability: [
            "システム機能を実行",
            "不足パラメータはフォームで補完し、更新操作は最終確認を待ちます。",
          ],
          get_execution: [
            "実行状態を取得",
            "実行 ID から現在の状態と秘匿化済み結果を取得します。",
          ],
          list_workflows: [
            "安全手順を取得",
            "API キー、チャネル、分析機能の安全な操作順序を取得します。",
          ],
          chart_execution: [
            "実行結果を分析",
            "実際の API 結果を集計してグラフを生成します。",
          ],
          generate_image: [
            "画像を生成",
            "画像生成モデルへリクエストを送信します。",
          ],
          generate_video: [
            "動画を生成",
            "非同期の動画生成タスクを送信します。",
          ],
          get_my_usage: [
            "アカウント金額を取得",
            "現在の通貨で利用可能額、累計利用額、リクエスト数を取得します。",
          ],
          get_today_consumption: [
            "本日の利用額を取得",
            "ダッシュボードと同じ基準で本日の利用額を取得します。",
          ],
          get_consumption_summary: [
            "利用額サマリーを取得",
            "現在の表示通貨の金額を使用し、明示要求と実データがない限りポイントを表示・換算しません。",
          ],
          prepare_refresh_usage: [
            "アカウント金額を更新",
            "現在の表示通貨で利用可能額、累計利用額、リクエスト数を再取得します。",
          ],
        }
      : {
          search_capabilities: [
            "Search available capabilities",
            "Search AI Hub APIs allowed by the current role and page permissions.",
          ],
          describe_capability: [
            "Read capability details",
            "Read the parameter schema, permission, risk, and execution mode for an operation.",
          ],
          execute_capability: [
            "Execute a system capability",
            "Collect missing parameters in a form; writes still require final browser confirmation.",
          ],
          get_execution: [
            "Get execution status",
            "Read the current state and redacted result for an execution ID.",
          ],
          list_workflows: [
            "Read safe workflows",
            "Read safe operating steps for API keys, channels, and analytics.",
          ],
          chart_execution: [
            "Analyze execution data",
            "Aggregate a real API result and generate a chart.",
          ],
          generate_image: [
            "Generate an image",
            "Submit a request to the configured image model.",
          ],
          generate_video: [
            "Generate a video",
            "Submit an asynchronous video generation task.",
          ],
          get_my_usage: [
            "Get account amounts",
            "Read available credit, lifetime spend, and request count in the current currency.",
          ],
          get_today_consumption: [
            "Get today's spend",
            "Read today's live spend using the same basis as the dashboard.",
          ],
          get_consumption_summary: [
            "Get consumption summary",
            "Use amounts in the current display currency; do not show or convert points unless explicitly requested and returned.",
          ],
          prepare_refresh_usage: [
            "Refresh account amounts",
            "Reload available credit, lifetime spend, and request count in the current display currency.",
          ],
        };
  return { ...common, descriptions };
}

const sensitiveDisplayKey =
  /^(authorization|cookie|password|passwd|secret|token|key|api[_-]?key|access[_-]?token|refresh[_-]?token|credential|certificate)$/i;

function displayJSON(value: unknown) {
  const visit = (item: unknown, seen: WeakSet<object>): unknown => {
    if (!item || typeof item !== "object") return item;
    if (seen.has(item as object)) return "[Circular]";
    seen.add(item as object);
    if (Array.isArray(item)) return item.map((entry) => visit(entry, seen));
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>).map(([key, entry]) => [
        key,
        sensitiveDisplayKey.test(key) ? "[REDACTED]" : visit(entry, seen),
      ]),
    );
  };
  const text =
    JSON.stringify(visit(value, new WeakSet()), null, 2) ?? String(value ?? "");
  return text.length > 50_000 ? `${text.slice(0, 50_000)}\n…` : text;
}

type ThreadSummary = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
};
type StoredThread = {
  id: string;
  contextUsage?: ContextUsage;
  messages: Array<{
    role: "user" | "assistant";
    text: string;
    createdAt: string;
    artifacts?: Artifact[];
    parts?: Array<
      | { type: "text"; text: string }
      | { type: "tool"; toolCallId: string; toolName: string; args: unknown; result?: unknown; isError?: boolean }
      | { type: "artifact"; artifact: Artifact }
    >;
  }>;
};

function visibleMessageArtifacts(artifacts: Artifact[]) {
  let latestConfirmation = -1;
  artifacts.forEach((artifact, index) => {
    if (artifact.kind === "execution" || artifact.kind === "parameter_form")
      latestConfirmation = index;
  });
  return artifacts.filter(
    (artifact, index) =>
      (artifact.kind !== "execution" && artifact.kind !== "parameter_form") ||
      index === latestConfirmation,
  );
}

function restoredMessageContent(message: StoredThread["messages"][number]): string | ThreadAssistantMessagePart[] {
  if (message.role !== "assistant") return message.text;
  if (message.parts) {
    const visible = visibleMessageArtifacts(
      message.parts.flatMap((part) => part.type === "artifact" ? [part.artifact] : []),
    );
    return message.parts.flatMap<ThreadAssistantMessagePart>((part) => {
      if (part.type === "text") return [{ type: "text", text: part.text }];
      if (part.type === "tool") return [{
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: part.args as never,
        argsText: JSON.stringify(part.args),
        ...(part.result === undefined ? {} : { result: part.result as never }),
        ...(part.isError ? { isError: true } : {}),
      }];
      return visible.includes(part.artifact)
        ? [{ type: "data", name: `artifact.${part.artifact.kind}`, data: part.artifact }]
        : [];
    });
  }
  if (!message.artifacts?.length) return message.text;
  return [
    ...(message.text ? [{ type: "text" as const, text: message.text }] : []),
    ...visibleMessageArtifacts(message.artifacts).map((artifact) => ({
      type: "data" as const,
      name: `artifact.${artifact.kind}`,
      data: artifact,
    })),
  ];
}
type DeleteRequest = { threadIds: string[]; title?: string };
const AgentLocaleContext = createContext("zh-CN");

function DeleteConfirmation({
  title,
  description,
  subject,
  cancelLabel,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  subject: string;
  cancelLabel: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);
  return (
    <div
      className="aih-confirm-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className="aih-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="aih-delete-title"
        aria-describedby="aih-delete-description"
      >
        <div className="aih-confirm-icon">
          <Trash weight="bold" />
        </div>
        <div className="aih-confirm-content">
          <h2 id="aih-delete-title">{title}</h2>
          <p id="aih-delete-description">{description}</p>
          <div className="aih-confirm-subject">{subject}</div>
        </div>
        <div className="aih-confirm-actions">
          <button
            ref={cancelRef}
            className="aih-confirm-cancel"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className="aih-confirm-delete"
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? (
              <SpinnerGap className="aih-spin" />
            ) : (
              <Trash weight="bold" />
            )}
            {busy ? `${confirmLabel}...` : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function isThreadId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function internalHref(href: string | undefined) {
  if (!href) return undefined;
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

function elementText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isValidElement<{ children?: ReactNode }>(node)) return "";
  return Children.toArray(node.props.children).map(elementText).join("").trim();
}

function tableCells(
  node: ReactNode,
): Array<{ header: boolean; value: string }> {
  const cells: Array<{ header: boolean; value: string }> = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return;
    if (child.type === "th" || child.type === "td")
      cells.push({
        header: child.type === "th",
        value: elementText(child.props.children),
      });
    else cells.push(...tableCells(child.props.children));
  });
  return cells;
}

function tableRows(
  node: ReactNode,
): Array<Array<{ header: boolean; value: string }>> {
  const rows: Array<Array<{ header: boolean; value: string }>> = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return;
    if (child.type === "tr") rows.push(tableCells(child.props.children));
    else rows.push(...tableRows(child.props.children));
  });
  return rows;
}

function MarkdownTable({ children }: { children?: ReactNode }) {
  const locale = useContext(AgentLocaleContext);
  const parsedRows = tableRows(children).filter((row) => row.length > 0);
  const firstRow = parsedRows[0] ?? [];
  const hasHeader = firstRow.some((cell) => cell.header);
  const columnCount = Math.max(0, ...parsedRows.map((row) => row.length));
  const genericColumn = /^zh[-_]HK/i.test(locale)
    ? "欄"
    : locale.startsWith("zh")
      ? "列"
      : locale.startsWith("ja")
        ? "列"
        : "Column";
  const title = /^zh[-_]HK/i.test(locale)
    ? "表格資料"
    : locale.startsWith("zh")
      ? "表格数据"
      : locale.startsWith("ja")
        ? "表データ"
        : "Table data";
  const columns = Array.from({ length: columnCount }, (_, index) => ({
    key: `column_${index}`,
    label:
      hasHeader && firstRow[index]?.value
        ? firstRow[index].value
        : `${genericColumn} ${index + 1}`,
  }));
  const bodyRows = (hasHeader ? parsedRows.slice(1) : parsedRows).map((row) =>
    Object.fromEntries(
      columns.map((column, index) => [column.key, row[index]?.value ?? ""]),
    ),
  );
  return (
    <div className="aih-markdown-table-artifact">
      <div className="aih-markdown-table-actions">
        <ExcelExportButton
          title={title}
          columns={columns}
          rows={bodyRows}
          locale={locale}
        />
      </div>
      <div className="aih-markdown-table-scroll">
        <table>{children}</table>
      </div>
    </div>
  );
}

function TextPart({
  text,
  onNavigate,
}: TextMessagePartProps & { onNavigate?: (href: string) => void }) {
  return (
    <div className="aih-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: MarkdownTable,
          a: ({ href, children }) => {
            const target = internalHref(href);
            if (!target || !onNavigate)
              return (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              );
            return (
              <a
                href={target}
                onClick={(event) => {
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  event.preventDefault();
                  onNavigate(target);
                }}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function AssistantTextPart(props: TextMessagePartProps & { onNavigate?: (href: string) => void }) {
  const locale = useContext(AgentLocaleContext);
  if (/<\s*(?:invoke|parameter)\s+name\s*=|<\s*\/\s*(?:invoke|parameter|think)\s*>|(?:^|\n)\s*result\s*[\[{]/i.test(props.text)) {
    return (
      <div className="aih-markdown" role="alert">
        {locale.startsWith("zh")
          ? "这条回复包含无效的工具调用文本，结果不可采信。请重新提问。"
          : locale.startsWith("ja")
            ? "この回答には無効なツール呼び出しが含まれています。再度質問してください。"
            : "This response contains an invalid tool call. Please ask again."}
      </div>
    );
  }
  return <TextPart {...props} />;
}

function ReasoningPart({ text, status }: ReasoningMessagePartProps) {
  const running = status.type === "running";
  const [open, setOpen] = useState(running);
  useEffect(() => setOpen(running), [running]);
  return (
    <details
      className="aih-reasoning"
      open={running || open}
      onToggle={(event) => {
        if (!running) setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        推理过程 <small>({text.length})</small>
      </summary>
      <div>{text}</div>
    </details>
  );
}

function ToolPart({
  toolName,
  args,
  result,
  isError,
}: ToolCallMessagePartProps) {
  const locale = useContext(AgentLocaleContext);
  const copy = toolCopy(locale);
  const state = toolStepState(result, Boolean(isError));
  const finished = state !== "running";
  const status = /^zh[-_]HK/i.test(locale)
    ? {
        running: copy.running,
        completed: copy.completed,
        failed: copy.failed,
        confirmation: "待確認",
        parameters: "待補充資料",
        handoff: "需在頁面繼續",
      }
    : locale.startsWith("zh")
    ? {
        running: copy.running,
        completed: copy.completed,
        failed: copy.failed,
        confirmation: "待确认",
        parameters: "待补充信息",
        handoff: "需在页面继续",
      }
    : locale.startsWith("ja")
      ? {
          running: copy.running,
          completed: copy.completed,
          failed: copy.failed,
          confirmation: "確認待ち",
          parameters: "入力待ち",
          handoff: "ページで続行",
        }
      : {
          running: copy.running,
          completed: copy.completed,
          failed: copy.failed,
          confirmation: "Awaiting confirmation",
          parameters: "Needs information",
          handoff: "Continue on page",
        };
  const [name, description] = copy.descriptions[toolName] ?? [
    toolName.replaceAll("_", " "),
    locale.startsWith("zh")
      ? "执行 Agent 工具并返回结构化结果。"
      : "Run an Agent tool and return its structured result.",
  ];
  return (
    <details className={`aih-tool is-${state}`}>
      <summary>
        <span className="aih-tool-status-icon">
          {state === "running" ? (
            <SpinnerGap className="aih-spin" />
          ) : state === "failed" ? (
            <WarningCircle />
          ) : state === "completed" ? (
            <CheckCircle />
          ) : (
            <ClockCounterClockwise />
          )}
        </span>
        <span className="aih-tool-identity">
          <span>{name}</span>
        </span>
        <small aria-live="polite">{status[state]}</small>
      </summary>
      <div className="aih-tool-details">
        <p>{description}</p>
        {state === "failed" && typeof result === "string" && (
          <p className="aih-tool-error" role="alert">{result}</p>
        )}
        <details className="aih-tool-json">
          <summary>
            {copy.request}
          </summary>
          <pre>{displayJSON(args)}</pre>
        </details>
        {finished && (
          <details className="aih-tool-json">
            <summary>
              {copy.response}
            </summary>
            <pre>{displayJSON(result)}</pre>
          </details>
        )}
      </div>
    </details>
  );
}

function ToolGroup({
  startIndex,
  endIndex,
  children,
}: {
  startIndex: number;
  endIndex: number;
  children?: ReactNode;
}) {
  const locale = useContext(AgentLocaleContext);
  const parts = useAuiState((state) => state.message.parts);
  const states = parts.slice(startIndex, endIndex + 1)
    .filter((part) => part.type === "tool-call")
    .map((part) => toolStepState(part.result, Boolean(part.isError)));
  const failed = states.includes("failed");
  const running = states.includes("running");
  const title = /^zh[-_]HK/i.test(locale) ? "處理過程" : locale.startsWith("zh") ? "处理过程" : locale.startsWith("ja") ? "処理過程" : "Activity";
  const status = failed ? toolCopy(locale).failed : running ? toolCopy(locale).running : toolCopy(locale).completed;
  return (
    <details className={`aih-tool-group${failed ? " is-failed" : ""}`}>
      <summary>
        <span>{title} · {endIndex - startIndex + 1}</span>
        <small aria-live="polite">{status}</small>
      </summary>
      <div className="aih-tool-group-content">{children}</div>
    </details>
  );
}

function LinkArtifact({
  data,
  onNavigate,
  onPageAction,
}: DataMessagePartProps<Artifact> & { onNavigate: (href: string) => void; onPageAction: MountOptions["onPageAction"] }) {
  const locale = useContext(AgentLocaleContext);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  if (data.kind !== "link") return null;
  const safeHref = data.href.startsWith("/") ? data.href : "/";
  const open = async () => {
    if (!data.guide || !onPageAction) return onNavigate(safeHref);
    if (opening) return;
    setOpening(true);
    setError("");
    try {
      await onPageAction(`${data.guide}.open`, { command: "open" });
      await onPageAction(`${data.guide}.editor.guide`, { command: "start", wait: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "页面引导无法启动");
    } finally {
      setOpening(false);
    }
  };
  return (
    <section className="aih-artifact">
      <h4>{data.title}</h4>
      {data.description && <p>{data.description}</p>}
      <p className="aih-handoff-note">
        {/^zh[-_]HK/i.test(locale)
          ? "可在 AI Hub 頁面查看或繼續操作。"
          : locale.startsWith("zh")
            ? "可在 AI Hub 页面查看或继续操作。"
            : locale.startsWith("ja")
              ? "AI Hub のページで確認または操作を続けられます。"
              : "Open the AI Hub page to view or continue this step."}
      </p>
      <button
        className="aih-button"
        type="button"
        onClick={open}
        disabled={opening}
      >
        {data.label}
        <ArrowSquareOut />
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function SuggestionsArtifact({ data }: DataMessagePartProps<Artifact>) {
  if (data.kind !== "suggestions") return null;
  return (
    <div className="aih-followup-suggestions">
      {data.questions.map((question: string) => (
        <ThreadPrimitive.Suggestion
          key={question}
          className="aih-followup-suggestion"
          prompt={question}
          send
          clearComposer={false}
        >
          {question}
          <ArrowUp />
        </ThreadPrimitive.Suggestion>
      ))}
    </div>
  );
}

function TableArtifact({ data }: DataMessagePartProps<Artifact>) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const locale = useContext(AgentLocaleContext);
  if (data.kind !== "table") return null;
  const traditional = /^zh[-_]HK/i.test(locale),
    isChinese = locale.startsWith("zh"),
    isJapanese = locale.startsWith("ja");
  const pages = Math.max(1, Math.ceil(data.rows.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const rows = data.rows.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  const totalLabel = traditional
    ? `共 ${data.rows.length} 項`
    : isChinese
      ? `共 ${data.rows.length} 项`
      : isJapanese
        ? `全 ${data.rows.length} 件`
        : `${data.rows.length} items`;
  const pageLabel = traditional
    ? `第 ${currentPage + 1} / ${pages} 頁`
    : isChinese
      ? `第 ${currentPage + 1} / ${pages} 页`
      : isJapanese
        ? `${currentPage + 1} / ${pages} ページ`
        : `Page ${currentPage + 1} of ${pages}`;
  const rowsLabel = traditional
    ? "每頁"
    : isChinese
      ? "每页"
      : isJapanese
        ? "表示件数"
        : "Rows";
  const previous = traditional
    ? "上一頁"
    : isChinese
      ? "上一页"
      : isJapanese
        ? "前へ"
        : "Previous";
  const next = traditional
    ? "下一頁"
    : isChinese
      ? "下一页"
      : isJapanese
        ? "次へ"
        : "Next";
  return (
    <section className="aih-artifact aih-data-table-artifact">
      <header className="aih-table-heading">
        <h4>{data.title}</h4>
        <ExcelExportButton
          title={data.title}
          columns={data.columns}
          rows={data.rows}
          locale={locale}
        />
      </header>
      <div className="aih-table-wrap">
        <table>
          <thead>
            <tr>
              {data.columns.map((column: { key: string; label: string }) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(
              (
                row: Record<string, string | number | boolean | null>,
                index: number,
              ) => (
                <tr key={currentPage * pageSize + index}>
                  {data.columns.map((column: { key: string }) => (
                    <td key={column.key}>{String(row[column.key] ?? "-")}</td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {data.rows.length > 10 && (
        <footer className="aih-chart-pagination">
          <span>{totalLabel}</span>
          <label>
            {rowsLabel}
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(0);
              }}
            >
              {[10, 20, 50].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <span>{pageLabel}</span>
          <div>
            <button
              type="button"
              aria-label={previous}
              title={previous}
              disabled={currentPage === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label={next}
              title={next}
              disabled={currentPage >= pages - 1}
              onClick={() => setPage((value) => Math.min(pages - 1, value + 1))}
            >
              ›
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}

function ActionArtifact({
  data,
  apiBasePath,
}: DataMessagePartProps<Artifact> & { apiBasePath: string }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<Artifact>();
  const [error, setError] = useState("");
  if (data.kind !== "action") return null;
  const execute = async () => {
    setState("running");
    setError("");
    try {
      const response = await fetch(
        `${apiBasePath}/actions/${data.actionId}/execute`,
        {
          method: "POST",
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
      const body = (await response.json()) as {
        success: boolean;
        artifact?: Artifact;
        message?: string;
      };
      if (!response.ok || !body.success) throw new Error(body.message || "执行失败，请重试");
      setResult(body.artifact);
      setState("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "执行失败，请重试");
      setState("error");
    }
  };
  return (
    <>
      <section className="aih-artifact">
        <h4>{data.title}</h4>
        {data.description && <p>{data.description}</p>}
        <button
          className="aih-button"
          type="button"
          onClick={execute}
          disabled={state === "running" || state === "done"}
        >
          {state === "running" && <SpinnerGap className="aih-spin" />}
          {state === "done"
            ? "已执行"
            : state === "error"
              ? "重试"
              : data.label}
        </button>
        {error && <p className="aih-artifact-error" role="alert">{error}</p>}
      </section>
      {result?.kind === "table" && (
        <TableArtifact
          data={result}
          type="data"
          name="artifact.table"
          status={{ type: "complete" }}
        />
      )}
    </>
  );
}

function formatDuration(milliseconds: number | undefined) {
  if (milliseconds === undefined) return "-";
  return milliseconds < 1000
    ? `${Math.round(milliseconds)}ms`
    : `${(milliseconds / 1000).toFixed(2)}s`;
}

function ResponseIdIcon() {
  return <span className="aih-response-id-icon">ID</span>;
}

function ExperienceCopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2m0 16H8V7h11z" />
    </svg>
  );
}

function ExperienceEditIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
      <path d="m14.06 9.02.92.92L5.92 19H5v-.92zM17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.2-.2-.45-.29-.71-.29m-3.6 3.19L3 17.25V21h3.75L17.81 9.94z" />
    </svg>
  );
}

function MetricsPart({ data }: DataMessagePartProps<TurnMetrics>) {
  const copyResponseId = async () => {
    if (data.responseId) await navigator.clipboard.writeText(data.responseId);
  };
  const metrics = [
    ["首帧", formatDuration(data.firstTokenMs)],
    ["尾帧", formatDuration(data.totalMs)],
    ["输入", data.inputTokens],
    ["输出", data.outputTokens],
  ];
  return (
    <div className="aih-message-meta">
      <ActionBarPrimitive.Root className="aih-message-actions">
        <ActionBarPrimitive.Copy
          className="aih-message-action"
          title="复制回答内容"
          aria-label="复制回答内容"
        >
          <ExperienceCopyIcon />
        </ActionBarPrimitive.Copy>
        <button
          className="aih-message-action"
          type="button"
          title={data.responseId ? "复制响应 ID" : "无响应 ID"}
          aria-label="复制响应 ID"
          disabled={!data.responseId}
          onClick={copyResponseId}
        >
          <ResponseIdIcon />
        </button>
        <ActionBarPrimitive.Reload
          className="aih-message-action"
          title="重新生成"
          aria-label="重新生成"
        >
          <ExperienceEditIcon />
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
      <div className="aih-metrics">
        {metrics.map(([label, value]) => (
          <span key={label}>
            <small>{label}:</small>
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

function FailurePart({ data }: DataMessagePartProps<FailedTurnDetails>) {
  const copyRequestId = async () => {
    if (data.requestId) await navigator.clipboard.writeText(data.requestId);
  };
  const metrics = [
    ["首帧", formatDuration(data.firstTokenMs)],
    ["尾帧", formatDuration(data.totalMs)],
    ["输入", "-"],
    ["输出", "-"],
  ];
  return (
    <div className="aih-message-meta">
      <ActionBarPrimitive.Root className="aih-message-actions">
        <ActionBarPrimitive.Copy
          className="aih-message-action"
          title="复制错误内容"
          aria-label="复制错误内容"
        >
          <ExperienceCopyIcon />
        </ActionBarPrimitive.Copy>
        <button
          className="aih-message-action"
          type="button"
          title={data.requestId ? "复制请求 ID" : "无请求 ID"}
          aria-label="复制请求 ID"
          disabled={!data.requestId}
          onClick={copyRequestId}
        >
          <ResponseIdIcon />
        </button>
        <ActionBarPrimitive.Reload
          className="aih-message-action"
          title="重试"
          aria-label="重试"
        >
          <ExperienceEditIcon />
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
      <div className="aih-metrics">
        {metrics.map(([label, value]) => (
          <span key={label}>
            <small>{label}:</small>
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

function SmoothResponse({ children }: { children: ReactNode }) {
  return (
    <div className="aih-response">
      <div className="aih-response-inner">{children}</div>
    </div>
  );
}

function formatHistoryDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  try {
    return date.toLocaleString(locale.replaceAll("_", "-"));
  } catch {
    return date.toLocaleString();
  }
}

function UserAvatar({
  src,
  name,
}: {
  src?: string | undefined;
  name?: string | undefined;
}) {
  const label = name?.trim() || "用户";
  const fallback = [...label][0]?.toLocaleUpperCase() || "U";
  return (
    <span className="aih-user-avatar" role="img" aria-label={`${label}的头像`}>
      {src ? <img src={src} alt="" /> : fallback}
    </span>
  );
}
function UserMessage({
  userAvatarUrl,
  userName,
}: {
  userAvatarUrl?: string | undefined;
  userName?: string | undefined;
}) {
  return (
    <MessagePrimitive.Root className="aih-message is-user">
      <div className="aih-bubble">
        <MessagePrimitive.Parts components={{ Text: TextPart }} />
      </div>
      <UserAvatar src={userAvatarUrl} name={userName} />
    </MessagePrimitive.Root>
  );
}
function AssistantAvatar({
  src,
  compact = false,
  active = false,
}: {
  src?: string | undefined;
  compact?: boolean;
  active?: boolean;
}) {
  return (
    <span
      className={`aih-avatar ${compact ? "is-compact" : ""} ${active ? "is-active" : ""}`}
      role="img"
      aria-label="AI 助手头像"
    >
      {src ? <img src={src} alt="" /> : "AI"}
    </span>
  );
}
function SystemWordmark({ name }: { name?: string | undefined }) {
  const systemName = name?.trim() || "AI Hub";
  const isTituEdge =
    systemName.replace(/\s+/g, " ").toLowerCase() === "titu edge";
  if (!isTituEdge) return <small>{systemName}</small>;
  return (
    <small className="aih-system-wordmark" aria-label="TITU Edge">
      <span aria-hidden="true" className="aih-system-wordmark-titu">
        TITU
      </span>
      <span aria-hidden="true" className="aih-system-wordmark-edge">
        Edge
      </span>
    </small>
  );
}
function AssistantMessage({
  apiBasePath,
  assistantAvatarUrl,
  onNavigate,
  onPageAction,
  threadId,
}: {
  apiBasePath: string;
  assistantAvatarUrl?: string | undefined;
  onNavigate: (href: string) => void;
  onPageAction: MountOptions["onPageAction"];
  threadId: string | undefined;
}) {
  const locale = useContext(AgentLocaleContext);
  const replying = useAuiState((state) => state.message.status?.type === "running");
  return (
    <MessagePrimitive.Root className="aih-message is-assistant">
      <AssistantAvatar src={assistantAvatarUrl} active={replying} />
      <SmoothResponse>
        <MessagePrimitive.Parts
          components={{
            Text: (props) => <AssistantTextPart {...props} onNavigate={onNavigate} />,
            Reasoning: ReasoningPart,
            tools: { Fallback: ToolPart },
            ToolGroup,
            data: {
              by_name: {
                "artifact.link": (props) => (
                  <LinkArtifact {...props} onNavigate={onNavigate} onPageAction={onPageAction} />
                ),
                "artifact.table": TableArtifact,
                "artifact.suggestions": SuggestionsArtifact,
                "artifact.page_workflow": (props) => (
                  <PageWorkflowArtifact data={props.data as Extract<Artifact, { kind: "page_workflow" }>} apiBasePath={apiBasePath} threadId={threadId} onPageAction={onPageAction} locale={locale} />
                ),
                "artifact.chart": (props) => (
                  <BusinessArtifact
                    {...props}
                    locale={locale}
                    onNavigate={onNavigate}
                  />
                ),
                "artifact.image": BusinessArtifact,
                "artifact.video": BusinessArtifact,
                "artifact.execution": (props) => (
                  <BusinessArtifact
                    {...props}
                    locale={locale}
                    onNavigate={onNavigate}
                  />
                ),
                "artifact.parameter_form": (props) => (
                  <BusinessArtifact
                    {...props}
                    locale={locale}
                    onNavigate={onNavigate}
                  />
                ),
                "artifact.action": (props) => (
                  <ActionArtifact {...props} apiBasePath={apiBasePath} />
                ),
                "turn.metrics": MetricsPart,
                "turn.failure": FailurePart,
              },
            },
          }}
        />
      </SmoothResponse>
    </MessagePrimitive.Root>
  );
}

function apiLocale(locale: string) {
  if (/^zh[-_]HK/i.test(locale)) return "zh_HK";
  if (/^ja/i.test(locale)) return "ja_JP";
  if (/^en/i.test(locale)) return "en_US";
  return "zh_CN";
}

export function AgentAssistant({ options }: { options: MountOptions }) {
  const copy = labels(options.locale);
  const [voiceScope, setVoiceScope] = useState(0);
  const [manualVoiceBusy, setManualVoiceBusy] = useState(false);
  const [voiceArmed, setVoiceArmed] = useState(false);
  const [voicePlaybackBusy, setVoicePlaybackBusy] = useState(false);
  const voiceInputRef = useRef<HTMLTextAreaElement>(null);
  const assistantName = options.assistantName?.trim() || "小T";
  const [images, setImages] = useState<PendingImage[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(Boolean(options.initialThreadId));
  const [threadLoadingId, setThreadLoadingId] = useState(options.initialThreadId);
  const [loadedThreadId, setLoadedThreadId] = useState<string>();
  const [threadLoadFailure, setThreadLoadFailure] = useState<string>();
  const historyRequestVersion = useRef(0);
  const [historyError, setHistoryError] = useState("");
  const [historyItems, setHistoryItems] = useState<ThreadSummary[]>([]);
  const [historySelectionMode, setHistorySelectionMode] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [historyDeleting, setHistoryDeleting] = useState(false);
  const [historyActionError, setHistoryActionError] = useState("");
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest>();
  const [activeThreadId, setActiveThreadId] = useState<string>();
  const [contextUsage, setContextUsage] = useState<ContextUsage>();
  const [starterQuestions, setStarterQuestions] = useState<string[]>(
    copy.suggestions,
  );
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [backgroundError, setBackgroundError] = useState("");
  const [backgroundId, setBackgroundId] = useState<AssistantBackgroundId>(
    options.backgroundId ?? "solid",
  );
  const backgroundPickerRef = useRef<HTMLDivElement>(null);
  const questionPickerRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef(images);
  const optionsRef = useRef(options);
  const lastThreadIdRef = useRef(options.initialThreadId);
  const wasVisibleRef = useRef(false);
  const threadLoadVersionRef = useRef(0);
  imagesRef.current = images;
  optionsRef.current = options;
  const selectedBackground =
    chatBackgrounds.find((item) => item.id === backgroundId) ??
    chatBackgrounds[0]!;
  const handleThreadChange = useCallback((threadId: string) => {
    threadLoadVersionRef.current += 1;
    setThreadLoading(false);
    setThreadLoadFailure(undefined);
    setLoadedThreadId(threadId);
    setActiveThreadId(threadId);
    lastThreadIdRef.current = threadId;
    optionsRef.current.onThreadChange(threadId);
  }, []);
  const adapter = useMemo(
    () =>
      createChatAdapter(
        options.apiBasePath,
        () => imagesRef.current,
        () => setImages([]),
        handleThreadChange,
        () => optionsRef.current.onUsageChanged?.(),
        () => optionsRef.current.locale,
        setContextUsage,
      ),
    [handleThreadChange, options.apiBasePath],
  );
  const runtime = useLocalRuntime(adapter);
  useEffect(() => {
    let cancelled = false;
    fetch(`${options.apiBasePath}/health`)
      .then((response) => response.json())
      .then((body: { data?: { contextWindow?: number } }) => {
        const contextWindow = body.data?.contextWindow;
        if (cancelled || !contextWindow || !Number.isInteger(contextWindow)) return;
        setContextUsage((current) => current ?? {
          tokens: 0,
          contextWindow,
          percent: 0,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [options.apiBasePath]);
  useEffect(() => {
    if (!options.visible) runtime.thread.cancelRun();
    return () => {
      runtime.thread.cancelRun();
    };
  }, [runtime, options.visible]);
  useEffect(() => {
    setBackgroundId(options.backgroundId ?? "solid");
  }, [options.backgroundId]);
  useEffect(() => {
    let cancelled = false;
    fetch(
      `${options.apiBasePath}/role-guide?locale=${apiLocale(options.locale)}`,
      { credentials: "include", headers: { accept: "application/json" } },
    )
      .then(async (response) => {
        const body = (await response.json()) as {
          success?: boolean;
          data?: { starter_questions?: string[] };
        };
        if (!response.ok || !body.success) throw new Error();
        if (!cancelled)
          setStarterQuestions(
            Array.isArray(body.data?.starter_questions)
              ? body.data.starter_questions
              : [],
          );
      })
      .catch(() => {
        if (!cancelled) setStarterQuestions(copy.suggestions);
      });
    return () => {
      cancelled = true;
    };
  }, [options.apiBasePath, options.locale]);
  useEffect(() => {
    if (!backgroundOpen && !questionsOpen) return undefined;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        setBackgroundOpen(false);
        setQuestionsOpen(false);
        return;
      }
      if (
        backgroundPickerRef.current?.contains(event.target as Node) ||
        questionPickerRef.current?.contains(event.target as Node)
      )
        return;
      setBackgroundOpen(false);
      setQuestionsOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [backgroundOpen, questionsOpen]);
  const changeBackground = async (next: AssistantBackgroundId) => {
    const previous = backgroundId;
    setBackgroundId(next);
    setBackgroundError("");
    setBackgroundOpen(false);
    try {
      await optionsRef.current.onBackgroundChange?.(next);
    } catch {
      setBackgroundId(previous);
      setBackgroundError(copy.backgroundSaveFailed);
    }
  };
  const loadHistory = async () => {
    const version = ++historyRequestVersion.current;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await fetch(`${options.apiBasePath}/threads`, {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const body = (await response.json()) as {
        success: boolean;
        data?: ThreadSummary[];
        message?: string;
      };
      if (!response.ok || !body.success) throw new Error(body.message);
      if (version !== historyRequestVersion.current) return;
      const items = Array.isArray(body.data) ? body.data : [];
      setHistoryItems(items);
      setSelectedHistoryIds((current) => {
        const available = new Set(items.map((item) => item.id));
        return new Set([...current].filter((id) => available.has(id)));
      });
    } catch {
      if (version === historyRequestVersion.current) setHistoryError(copy.historyLoadFailed);
    } finally {
      if (version === historyRequestVersion.current) setHistoryLoading(false);
    }
  };
  const startNewThread = () => {
    setVoiceScope(current => current + 1);
    threadLoadVersionRef.current += 1;
    setThreadLoading(false);
    setThreadLoadFailure(undefined);
    setLoadedThreadId(undefined);
    adapter.startNewThread();
    runtime.thread.reset();
    setActiveThreadId(undefined);
    setContextUsage((current) => current ? { tokens: 0, contextWindow: current.contextWindow, percent: 0 } : undefined);
    setImages([]);
    setHistoryOpen(false);
  };
  const clearThread = async () => {
    setVoiceScope(current => current + 1);
    const threadId = adapter.getThreadId();
    try {
      if (threadId) {
        const response = await fetch(
          `${options.apiBasePath}/threads/${threadId}/clear`,
          {
            method: "POST",
            credentials: "include",
            headers: { accept: "application/json" },
          },
        );
        if (!response.ok) throw new Error();
      }
      threadLoadVersionRef.current += 1;
      adapter.startNewThread();
      runtime.thread.reset();
      setActiveThreadId(undefined);
      setContextUsage((current) => current ? { tokens: 0, contextWindow: current.contextWindow, percent: 0 } : undefined);
      if (lastThreadIdRef.current === threadId) {
        lastThreadIdRef.current = undefined;
        optionsRef.current.onThreadChange(undefined);
      }
      setImages([]);
      if (historyOpen) await loadHistory();
    } catch {
      setHistoryError(copy.historyLoadFailed);
    }
  };
  const openHistory = async () => {
    const nextOpen = !historyOpen;
    setHistoryOpen(nextOpen);
    if (nextOpen) await loadHistory();
  };
  const loadThread = useCallback(
    async (threadId: string, clearInvalid = false) => {
      setVoiceScope(current => current + 1);
      const loadVersion = ++threadLoadVersionRef.current;
      setThreadLoading(true);
      setThreadLoadingId(threadId);
      setThreadLoadFailure(undefined);
      let threadInvalid = false;
      try {
        if (!isThreadId(threadId)) {
          threadInvalid = true;
          throw new Error("Invalid thread ID");
        }
        const response = await fetch(
          `${options.apiBasePath}/threads/${threadId}`,
          { credentials: "include", headers: { accept: "application/json" } },
        );
        const body = (await response.json()) as {
          success: boolean;
          data?: StoredThread;
          message?: string;
        };
        if (!response.ok || !body.success || !body.data) {
          threadInvalid =
            response.status === 403 ||
            response.status === 404 ||
            /不存在|无权访问/.test(body.message ?? "");
          throw new Error(body.message);
        }
        if (loadVersion !== threadLoadVersionRef.current) return false;
        setLoadedThreadId(threadId);
        if (body.data.contextUsage) setContextUsage(body.data.contextUsage);
        if (body.data.messages.length === 0) {
          adapter.startNewThread();
          runtime.thread.reset();
          setActiveThreadId(undefined);
          setContextUsage((current) => current ? { tokens: 0, contextWindow: current.contextWindow, percent: 0 } : undefined);
          if (clearInvalid) {
            lastThreadIdRef.current = undefined;
            optionsRef.current.onThreadChange(undefined);
          }
          setHistoryOpen(false);
          return true;
        }
        adapter.useThread(body.data.id);
        runtime.thread.reset(
          body.data.messages.map((message) => ({
            role: message.role,
            content: restoredMessageContent(message),
            createdAt: new Date(message.createdAt),
          })),
        );
        setHistoryOpen(false);
        return true;
      } catch {
        if (loadVersion !== threadLoadVersionRef.current) return false;
        if (!threadInvalid) setThreadLoadFailure(threadId);
        if (clearInvalid && threadInvalid) {
          adapter.startNewThread();
          runtime.thread.reset();
          setActiveThreadId(undefined);
          setContextUsage((current) => current ? { tokens: 0, contextWindow: current.contextWindow, percent: 0 } : undefined);
          lastThreadIdRef.current = undefined;
          optionsRef.current.onThreadChange(undefined);
        }
        return false;
      } finally {
        if (loadVersion === threadLoadVersionRef.current) setThreadLoading(false);
      }
    },
    [adapter, options.apiBasePath, runtime.thread],
  );
  const selectHistory = async (threadId: string) => {
    if (!(await loadThread(threadId))) setHistoryError(copy.historyLoadFailed);
  };
  const toggleHistorySelection = (threadId: string) => {
    setSelectedHistoryIds((current) => {
      const next = new Set(current);
      next.has(threadId) ? next.delete(threadId) : next.add(threadId);
      return next;
    });
  };
  const resetDeletedThread = (deletedIds: Set<string>) => {
    const currentThreadId = adapter.getThreadId();
    if (currentThreadId && deletedIds.has(currentThreadId)) {
      threadLoadVersionRef.current += 1;
      adapter.startNewThread();
      runtime.thread.reset();
      setActiveThreadId(undefined);
      setContextUsage((current) => current ? { tokens: 0, contextWindow: current.contextWindow, percent: 0 } : undefined);
      setImages([]);
    }
    const rememberedThreadId = lastThreadIdRef.current;
    if (rememberedThreadId && deletedIds.has(rememberedThreadId)) {
      lastThreadIdRef.current = undefined;
      optionsRef.current.onThreadChange(undefined);
    }
  };
  const deleteHistory = async (threadIds: string[]) => {
    if (threadIds.length === 0) return;
    setHistoryDeleting(true);
    setHistoryActionError("");
    try {
      const single = threadIds.length === 1;
      const response = await fetch(
        single
          ? `${options.apiBasePath}/threads/${threadIds[0]}`
          : `${options.apiBasePath}/threads/batch-delete`,
        {
          method: single ? "DELETE" : "POST",
          credentials: "include",
          headers: {
            accept: "application/json",
            ...(single ? {} : { "content-type": "application/json" }),
          },
          ...(single ? {} : { body: JSON.stringify({ threadIds }) }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
      };
      if (!response.ok || !body.success)
        throw new Error(body.message || copy.deleteFailed);
      const deletedIds = new Set(threadIds);
      setHistoryItems((current) =>
        current.filter((item) => !deletedIds.has(item.id)),
      );
      setSelectedHistoryIds(new Set());
      setHistorySelectionMode(false);
      resetDeletedThread(deletedIds);
    } catch (error) {
      setHistoryActionError(
        error instanceof Error && error.message
          ? error.message
          : copy.deleteFailed,
      );
    } finally {
      setHistoryDeleting(false);
    }
  };
  const deleteOneHistory = (item: ThreadSummary) => {
    setDeleteRequest({ threadIds: [item.id], title: item.title });
  };
  const deleteSelectedHistory = () => {
    const threadIds = [...selectedHistoryIds];
    if (threadIds.length > 0) setDeleteRequest({ threadIds });
  };
  useEffect(() => {
    if (options.initialThreadId && !lastThreadIdRef.current)
      lastThreadIdRef.current = options.initialThreadId;
  }, [options.initialThreadId]);
  useEffect(() => {
    const becameVisible = options.visible && !wasVisibleRef.current;
    wasVisibleRef.current = options.visible;
    const threadId = lastThreadIdRef.current;
    if (!becameVisible || activeThreadId || !threadId) return;
    void loadThread(threadId, true);
  }, [activeThreadId, loadThread, options.visible]);
  const onImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])].slice(0, 4 - images.length);
    const accepted = files.filter(
      (file) =>
        ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
          file.type,
        ) && file.size <= 8 * 1024 * 1024,
    );
    const additions = await Promise.all(
      accepted.map(
        (file) =>
          new Promise<PendingImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const preview = String(reader.result);
              resolve({
                preview,
                data: preview.split(",")[1] ?? "",
                mimeType: file.type as PendingImage["mimeType"],
              });
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          }),
      ),
    );
    setImages((current) => [...current, ...additions].slice(0, 4));
    event.target.value = "";
  };
  return (
    <AgentLocaleContext.Provider value={options.locale}>
      <AssistantRuntimeProvider runtime={runtime}>
        <div
          className={`aih-root is-${options.mode}`}
          style={
            {
              "--aih-bg": options.theme.background,
              "--aih-surface": options.theme.surface,
              "--aih-text": options.theme.text,
              "--aih-muted": options.theme.mutedText,
              "--aih-border": options.theme.border,
              "--aih-primary": options.theme.primary,
              "--aih-primary-contrast": options.theme.primaryContrast,
              "--aih-chat-background": selectedBackground.image
                ? `url(${selectedBackground.image})`
                : "none",
              "--aih-background-overlay": selectedBackground.overlay,
              "--aih-background-position": selectedBackground.position,
            } as React.CSSProperties
          }
        >
          <header className="aih-header">
            <div className="aih-brand">
              <AssistantAvatar src={options.assistantAvatarUrl} compact />
              <div>
                <strong>{assistantName}</strong>
                <SystemWordmark name={options.systemName} />
              </div>
            </div>
            <div className="aih-header-actions">
              <button
                type="button"
                title={copy.newThread}
                aria-label={copy.newThread}
                onClick={startNewThread}
              >
                <PlusCircle />
              </button>
              <div className="aih-question-control" ref={questionPickerRef}>
                <button
                  type="button"
                  className={questionsOpen ? "is-active" : ""}
                  title={copy.questionLibrary}
                  aria-label={copy.questionLibrary}
                  aria-expanded={questionsOpen}
                  onClick={() => {
                    setQuestionsOpen((current) => !current);
                    setBackgroundOpen(false);
                  }}
                >
                  <ListBullets />
                </button>
                {questionsOpen && (
                  <div
                    className="aih-question-picker"
                    role="menu"
                    aria-label={copy.questionLibrary}
                  >
                    <strong>{copy.questionLibrary}</strong>
                    {starterQuestions.map((question) => (
                      <ThreadPrimitive.Suggestion
                        key={question}
                        className="aih-question-option"
                        role="menuitem"
                        prompt={question}
                        send
                        clearComposer={false}
                        onClick={() => setQuestionsOpen(false)}
                      >
                        <span>{question}</span>
                        <ArrowUp />
                      </ThreadPrimitive.Suggestion>
                    ))}
                  </div>
                )}
              </div>
              <div className="aih-background-control" ref={backgroundPickerRef}>
                <button
                  type="button"
                  className={backgroundOpen ? "is-active" : ""}
                  title={copy.background}
                  aria-label={copy.background}
                  aria-expanded={backgroundOpen}
                  onClick={() => {
                    setBackgroundOpen((current) => !current);
                    setQuestionsOpen(false);
                    setBackgroundError("");
                  }}
                >
                  <Palette />
                </button>
                {backgroundOpen && (
                  <div
                    className="aih-background-picker"
                    role="menu"
                    aria-label={copy.background}
                  >
                    {chatBackgrounds.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={item.id === backgroundId}
                        title={
                          item.id === "solid" ? copy.solidBackground : item.name
                        }
                        onClick={() => void changeBackground(item.id)}
                      >
                        <span
                          className="aih-background-swatch"
                          style={
                            item.image
                              ? { backgroundImage: `url(${item.image})` }
                              : undefined
                          }
                        />{" "}
                        <small>
                          {item.id === "solid"
                            ? copy.solidBackground
                            : item.name}
                        </small>
                        {item.id === backgroundId && <Check weight="bold" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className={historyOpen ? "is-active" : ""}
                title={copy.history}
                aria-label={copy.history}
                onClick={openHistory}
              >
                <ClockCounterClockwise />
              </button>
              <button
                type="button"
                title={copy.clear}
                aria-label={copy.clear}
                onClick={clearThread}
              >
                <Trash />
              </button>
              <button
                type="button"
                title={options.mode === "page" ? copy.minimize : copy.maximize}
                aria-label={
                  options.mode === "page" ? copy.minimize : copy.maximize
                }
                onClick={
                  options.mode === "page"
                    ? options.onMinimize
                    : options.onMaximize
                }
              >
                {options.mode === "page" ? <ArrowsIn /> : <ArrowsOut />}
              </button>
              <button
                type="button"
                title={copy.close}
                aria-label={copy.close}
                onClick={options.onClose}
              >
                <X />
              </button>
            </div>
          </header>
          <VoiceControls
            onBusyChange={setVoicePlaybackBusy}
            runtime={runtime}
            output={Boolean(options.voiceOutput)}
            visible={options.visible}
            locale={options.locale}
          />
          {backgroundError && (
            <div className="aih-background-error" role="alert">
              {backgroundError}
            </div>
          )}
          {historyOpen && (
            <aside className="aih-history">
              <div className="aih-history-heading">
                <strong>{copy.history}</strong>
                <div className="aih-history-heading-actions">
                  {historyItems.length > 0 &&
                    !historyLoading &&
                    !historyError && (
                      <button
                        className="aih-history-select-toggle"
                        type="button"
                        disabled={historyDeleting || historyLoading}
                        onClick={() => {
                          setHistorySelectionMode((current) => !current);
                          setSelectedHistoryIds(new Set());
                          setHistoryActionError("");
                        }}
                      >
                        {historySelectionMode ? copy.cancelSelect : copy.select}
                      </button>
                    )}
                  <button
                    type="button"
                    title={copy.close}
                    aria-label={copy.close}
                    onClick={() => setHistoryOpen(false)}
                  >
                    <X />
                  </button>
                </div>
              </div>
              {historySelectionMode && historyItems.length > 0 && (
                <div className="aih-history-toolbar">
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedHistoryIds.size === historyItems.length}
                      onChange={(event) =>
                        setSelectedHistoryIds(
                          event.target.checked
                            ? new Set(historyItems.map((item) => item.id))
                            : new Set(),
                        )
                      }
                    />
                    {copy.selectAll}
                  </label>
                  <button
                    type="button"
                    disabled={selectedHistoryIds.size === 0 || historyDeleting}
                    onClick={deleteSelectedHistory}
                  >
                    <Trash />
                    {historyDeleting
                      ? copy.deleting
                      : `${copy.deleteSelected} (${selectedHistoryIds.size})`}
                  </button>
                </div>
              )}
              {historyActionError && (
                <div className="aih-history-action-error" role="alert">
                  <WarningCircle />
                  {historyActionError}
                </div>
              )}
              <div className="aih-history-list">
                {historyLoading && <div className="aih-loading-progress" role="progressbar" aria-label={copy.history} />}
                {historyError && <div className="aih-history-action-error" role="alert"><span>{historyError}</span><button type="button" onClick={loadHistory}>{copy.retry}</button></div>}
                {historyLoading && historyItems.length === 0 ? (
                  <LoadingSkeleton label={copy.history} />
                ) : historyError && historyItems.length === 0 ? (
                  <div className="aih-history-state is-error">
                    <WarningCircle />
                    <span>{historyError}</span>
                  </div>
                ) : historyItems.length === 0 ? (
                  <div className="aih-history-state">
                    <ClockCounterClockwise />
                    <span>{copy.emptyHistory}</span>
                  </div>
                ) : (
                  historyItems.map((item) => (
                    <div
                      className={`aih-history-item ${activeThreadId === item.id ? "is-active" : ""}`}
                      key={item.id}
                    >
                      {historySelectionMode && (
                        <label className="aih-history-check">
                          <input
                            type="checkbox"
                            aria-label={`${copy.select}: ${item.title}`}
                            checked={selectedHistoryIds.has(item.id)}
                            onChange={() => toggleHistorySelection(item.id)}
                          />
                        </label>
                      )}
                      <button
                        className="aih-history-open"
                        type="button"
                        disabled={historyDeleting || historyLoading}
                        onClick={() =>
                          historySelectionMode
                            ? toggleHistorySelection(item.id)
                            : selectHistory(item.id)
                        }
                      >
                        <strong>{item.title}</strong>
                        <small>
                          {formatHistoryDate(item.updatedAt, options.locale)} ·{" "}
                          {item.messageCount}
                        </small>
                      </button>
                      {!historySelectionMode && (
                        <button
                          className="aih-history-delete"
                          type="button"
                          title={copy.deleteOne}
                          aria-label={`${copy.deleteOne}: ${item.title}`}
                          disabled={historyDeleting || historyLoading}
                          onClick={() => deleteOneHistory(item)}
                        >
                          <Trash />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </aside>
          )}
          {deleteRequest && (
            <DeleteConfirmation
              title={
                deleteRequest.threadIds.length === 1
                  ? copy.deleteDialogTitle
                  : copy.deleteBatchDialogTitle
              }
              description={copy.deleteDialogDescription}
              subject={
                deleteRequest.title ??
                `${copy.selectedCount}: ${deleteRequest.threadIds.length}`
              }
              cancelLabel={copy.cancelDelete}
              confirmLabel={copy.confirmDelete}
              busy={historyDeleting}
              onCancel={() => setDeleteRequest(undefined)}
              onConfirm={async () => {
                await deleteHistory(deleteRequest.threadIds);
                setDeleteRequest(undefined);
              }}
            />
          )}
          <ThreadPrimitive.Root className="aih-thread" aria-busy={threadLoading}>
            {threadLoading && loadedThreadId !== threadLoadingId && <div className="aih-thread-loading"><LoadingSkeleton label={copy.history} rows={4} /></div>}
            {threadLoading && loadedThreadId === threadLoadingId && <div className="aih-loading-progress" role="progressbar" aria-label={copy.history} />}
            {threadLoadFailure && <div className="aih-history-action-error" role="alert"><span>{copy.historyLoadFailed}</span><button type="button" onClick={() => void loadThread(threadLoadFailure, true)}>{copy.retry}</button></div>}
            <ThreadPrimitive.Viewport className="aih-viewport" {...(threadLoading || threadLoadFailure ? { inert: "" } : {})} style={(threadLoading && loadedThreadId !== threadLoadingId) || (threadLoadFailure && loadedThreadId !== threadLoadFailure) ? { visibility: "hidden" } : undefined}>
              <ThreadPrimitive.If empty>
                <div className="aih-empty">
                  <AssistantAvatar src={options.assistantAvatarUrl} />
                  <h2>{assistantName}</h2>
                  <span className="aih-suggestions-label">
                    {copy.suggestionsLabel}
                  </span>
                  <div className="aih-suggestions">
                    {starterQuestions.slice(0, 8).map((question) => (
                      <ThreadPrimitive.Suggestion
                        key={question}
                        className="aih-suggestion"
                        prompt={question}
                        send
                        clearComposer={false}
                      >
                        {question}
                        <ArrowUp />
                      </ThreadPrimitive.Suggestion>
                    ))}
                  </div>
                </div>
              </ThreadPrimitive.If>
              <ThreadPrimitive.Messages
                components={{
                  UserMessage: () => (
                    <UserMessage
                      userAvatarUrl={options.userAvatarUrl}
                      userName={options.userName}
                    />
                  ),
                  AssistantMessage: () => (
                    <AssistantMessage
                      apiBasePath={options.apiBasePath}
                      assistantAvatarUrl={options.assistantAvatarUrl}
                      onNavigate={options.onNavigate}
                      onPageAction={options.onPageAction}
                      threadId={activeThreadId}
                    />
                  ),
                }}
              />
              <ThreadPrimitive.ViewportFooter className="aih-footer">
                <ComposerPrimitive.Root className="aih-composer">
                  {images.length > 0 && (
                    <div className="aih-images">
                      {images.map((image, index) => (
                        <div
                          className="aih-image"
                          key={image.preview.slice(-24)}
                        >
                          <img src={image.preview} alt="" />
                          <button
                            type="button"
                            title={copy.remove}
                            aria-label={copy.remove}
                            onClick={() =>
                              setImages((current) =>
                                current.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              )
                            }
                          >
                            <X />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="aih-compose-row">
                    <label
                      className="aih-icon-button"
                      title={copy.image}
                      aria-label={copy.image}
                    >
                      <ImageSquare />
                      <input
                        hidden
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        multiple
                        onChange={onImages}
                      />
                    </label>
                    <ComposerPrimitive.Input
                      ref={voiceInputRef}
                      className="aih-input"
                      placeholder={copy.placeholder}
                    />
                    <VoiceInput runtime={runtime} enabled={Boolean(options.voiceInput)} visible={options.visible}
                      scope={voiceScope} locked={threadLoading || Boolean(threadLoadFailure) || voiceArmed}
                      locale={options.locale} inputRef={voiceInputRef} onActiveChange={setManualVoiceBusy} />
                    <VoiceConversationInput runtime={runtime} enabled={Boolean(options.voiceInput)} output={Boolean(options.voiceOutput)}
                      manualBusy={manualVoiceBusy} playbackBusy={voicePlaybackBusy} locked={threadLoading || Boolean(threadLoadFailure)}
                      attachments={images.length > 0} scope={voiceScope} locale={options.locale} onArmed={setVoiceArmed}
                      onWake={() => optionsRef.current.onVoiceWake?.()}
                      onDismiss={() => { if (optionsRef.current.mode === "panel") optionsRef.current.onVoiceDismiss?.(); }} />
                    <ThreadPrimitive.If running>
                      <ComposerPrimitive.Cancel
                        className="aih-send"
                        title={copy.stop}
                        aria-label={copy.stop}
                      >
                        <Stop weight="fill" />
                      </ComposerPrimitive.Cancel>
                    </ThreadPrimitive.If>
                    <ThreadPrimitive.If running={false}>
                      <ComposerPrimitive.Send
                        className="aih-send"
                        title={copy.send}
                        aria-label={copy.send}
                      >
                        <ArrowUp weight="bold" />
                      </ComposerPrimitive.Send>
                    </ThreadPrimitive.If>
                  </div>
                </ComposerPrimitive.Root>
                <div className="aih-footer-meta">
                  <p className="aih-disclaimer">
                    AI 生成内容可能不准确，请核对重要信息。
                  </p>
                  <div className="aih-context-usage" title="智能体当前配置窗口">
                    {options.locale.startsWith("zh") ? "上下文" : "Context"}：
                    {contextUsage
                      ? `${contextUsage.tokens === null ? (options.locale.startsWith("zh") ? "重新计算中" : "Recalculating") : contextUsage.tokens.toLocaleString()} / ${contextUsage.contextWindow.toLocaleString()}${contextUsage.percent === null ? "" : ` · ${contextUsage.percent.toFixed(1)}%`}`
                      : <span className="aih-skeleton-line aih-context-skeleton" aria-label={options.locale.startsWith("zh") ? "读取中" : "Loading"} />}
                  </div>
                </div>
              </ThreadPrimitive.ViewportFooter>
            </ThreadPrimitive.Viewport>
          </ThreadPrimitive.Root>
        </div>
      </AssistantRuntimeProvider>
    </AgentLocaleContext.Provider>
  );
}
