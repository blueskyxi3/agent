import { AsyncLocalStorage } from "node:async_hooks";

type Envelope<T> = { success: boolean; message?: string; data: T };
export class AiHubRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
export type AssistantPreferences = {
  enabled: boolean;
  token_id: number;
  text_model: string;
  rename_model: string;
  thinking_level: string;
  reasoning: boolean;
  voice_input: boolean;
  voice_output: boolean;
  background_id: string;
};

export type CurrentUser = {
  id: number;
  username: string;
  role: number;
  page_access?: Record<string, string>;
};
export type AssistantBootstrap = {
  user: CurrentUser;
  assistant: { name: string; timeout_seconds: number };
  preferences: { text_model: string; thinking_level: string; reasoning: boolean };
  versions: { protocol_version: number; catalog_version: string; content_version: string };
};
export type RoleGuide = {
  role: "common" | "admin" | "root";
  version: string;
  title: string;
  summary: string;
  capabilities: Array<{
    title: string;
    description: string;
    required_pages?: string[];
  }>;
  starter_questions: string[];
};
export type UsageSummary = {
  amount: string;
  used_amount: string;
  currency: string;
  request_count: number;
};
type ModelList = { data?: Array<{ id?: string }> };

export class AiHubClient {
  readonly context = new AsyncLocalStorage<Record<string, string>>();
  constructor(private readonly baseUrl: string) {}

  headers(delegation: string) {
    return { authorization: `Bearer ${delegation}`, "x-aihub-plugin-id": "agent", ...this.context.getStore() };
  }

  async request<T>(path: string, cookie: string, body?: unknown): Promise<T> {
    const response = await this.raw(
      path,
      cookie,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const result = (await response.json()) as Envelope<T>;
    if (!response.ok || !result.success)
      throw new Error(result.message || `请求失败 (${response.status})`);
    return result.data;
  }

  raw(path: string, cookie: string, init: RequestInit = {}) {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...this.headers(cookie),
        ...Object.fromEntries(new Headers(init.headers)),
      },
      redirect: "error",
      signal: init.signal ?? AbortSignal.timeout(120_000),
    });
  }

  getPreferences(cookie: string) {
    return this.get<AssistantPreferences>(
      "/api/user/self/assistant/preferences",
      cookie,
    );
  }

  getBootstrap(cookie: string, signedHeaders: Record<string, string>) {
    return this.context.run(signedHeaders, () =>
      this.get<AssistantBootstrap>("/api/user/self/assistant/bootstrap", cookie),
    );
  }

  private async get<T>(path: string, cookie: string): Promise<T> {
    const response = await this.raw(path, cookie, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as Envelope<T> | null;
      throw new AiHubRequestError(body?.message || `AI Hub 返回 HTTP ${response.status}`, response.status);
    }
    const body = (await response.json()) as Envelope<T>;
    if (!body.success) throw new Error(body.message || "AI Hub 请求失败");
    return body.data;
  }

  getStatus() {
    return this.get<Record<string, unknown>>("/api/status", "");
  }

  getCurrentUser(cookie: string) {
    return this.get<CurrentUser>("/api/user/self", cookie);
  }

  getRoleGuide(cookie: string, locale: string) {
    return this.request<RoleGuide>(
      `/api/user/self/assistant/role-guide?locale=${encodeURIComponent(locale)}`,
      cookie,
    );
  }

  getPlaygroundToken(cookie: string) {
    return this.get<string>("/api/token/playground", cookie);
  }

  getUsage(cookie: string) {
    return this.get<UsageSummary>("/api/user/self/usage", cookie);
  }

  async generateThreadTitle(
    cookie: string,
    userMessage: string,
    assistantMessage: string,
  ) {
    const response = await this.raw(
      "/api/user/self/assistant/rename/chat/completions",
      cookie,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "configured-by-server",
          stream: false,
          max_tokens: 32,
          messages: [
            {
              role: "system",
              content:
                "请为这段对话生成一个简洁、准确的标题，使用与对话相同的语言。只输出标题，不要引号、句号或解释，最多 20 个汉字或 8 个英文单词。",
            },
            {
              role: "user",
              content: `用户：${userMessage.slice(0, 1000)}\n助手：${assistantMessage.slice(0, 1000)}`,
            },
          ],
        }),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      error?: { message?: string };
    };
    if (!response.ok)
      throw new Error(
        body.error?.message || `生成会话标题失败 (HTTP ${response.status})`,
      );
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("标题模型未返回文本");
    return content;
  }

  async getAvailableModels(token: string) {
    const response = await fetch(`${this.baseUrl}/v1/models`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json().catch(() => ({}))) as ModelList & {
      error?: { message?: string };
    };
    if (!response.ok)
      throw new Error(
        body.error?.message || `读取可用模型失败 (HTTP ${response.status})`,
      );
    return new Set(
      (body.data ?? [])
        .map((model) => model.id)
        .filter((id): id is string => Boolean(id)),
    );
  }
}
