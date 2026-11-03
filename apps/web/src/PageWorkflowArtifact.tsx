import { useCallback, useEffect, useRef, useState } from "react";
import type { Artifact } from "@ai-hub-agent/contracts";
import type { MountOptions } from "./types";

type Workflow = Extract<Artifact, { kind: "page_workflow" }>;
type PageState = { status: string; name: string; revision: string; defaults: { tag: string; availableAmount: string; unlimitedQuota: boolean; expiresAt: number; modelLimitEnabled: boolean; ipLimitEnabled: boolean } };
// Streaming message updates can remount the card while its page action is pending.
const startedWorkflows = new Map<string, { expiresAt: number; result: Promise<Workflow> }>();
const translations = {
  zh_CN: { title: "创建 API Key", opening: "正在打开 API Key 页面和创建表单…", ready: "准备打开创建表单", askName: "请确认 API Key 名称：", defaultName: "用默认名 my-api-key", customName: "自定义名称", name: "名称", fill: "填入页面", tag: "标签", quota: "额度", unlimited: "不限额", pageValue: "按页面设置", expiry: "有效期", longTerm: "长期", models: "模型限制", ip: "IP 限制", enabled: "已启用", disabled: "未启用", editHint: "如需调整其他配置，请在页面表单中修改，然后重新核对。", review: "重新核对页面配置", confirm: "确认创建", uncertain: "提交状态尚未确认。请检查 API Key 列表，避免重复创建。", completed: "已创建", copy: "请在 API Key 页面复制密钥。", failed: "创建未完成。请检查页面提示或重新发起。", cancelled: "已取消。", expired: "操作已过期，请重新发起。", cancel: "取消", retry: "重试恢复", id: "记录 ID" },
  zh_HK: { title: "建立 API Key", opening: "正在開啟 API Key 頁面與建立表單…", ready: "準備開啟建立表單", askName: "請確認 API Key 名稱：", defaultName: "使用預設名稱 my-api-key", customName: "自訂名稱", name: "名稱", fill: "填入頁面", tag: "標籤", quota: "額度", unlimited: "不設限", pageValue: "依頁面設定", expiry: "有效期", longTerm: "長期", models: "模型限制", ip: "IP 限制", enabled: "已啟用", disabled: "未啟用", editHint: "如需調整其他設定，請在頁面表單中修改後重新核對。", review: "重新核對頁面設定", confirm: "確認建立", uncertain: "提交狀態尚未確認。請檢查 API Key 列表，避免重複建立。", completed: "已建立", copy: "請在 API Key 頁面複製密鑰。", failed: "建立未完成。請檢查頁面提示或重新發起。", cancelled: "已取消。", expired: "操作已過期，請重新發起。", cancel: "取消", retry: "重試恢復", id: "紀錄 ID" },
  en_US: { title: "Create API Key", opening: "Opening the API Key page and form…", ready: "Preparing the form", askName: "Choose an API Key name:", defaultName: "Use my-api-key", customName: "Custom name", name: "Name", fill: "Fill page", tag: "Tag", quota: "Quota", unlimited: "Unlimited", pageValue: "Page setting", expiry: "Expiry", longTerm: "No expiry", models: "Model limit", ip: "IP limit", enabled: "On", disabled: "Off", editHint: "To change other settings, edit the page form and review it again.", review: "Review page settings", confirm: "Confirm creation", uncertain: "Submission status is unknown. Check the API Key list before trying again.", completed: "Created", copy: "Copy the key from the API Key page.", failed: "Creation did not finish. Check the page or start again.", cancelled: "Cancelled.", expired: "This action expired. Start again.", cancel: "Cancel", retry: "Retry recovery", id: "Record ID" },
  ja_JP: { title: "API Key を作成", opening: "API Key ページと作成フォームを開いています…", ready: "作成フォームを準備中", askName: "API Key の名前を選択してください：", defaultName: "my-api-key を使用", customName: "名前を入力", name: "名前", fill: "ページに入力", tag: "タグ", quota: "上限", unlimited: "無制限", pageValue: "ページの設定", expiry: "有効期限", longTerm: "無期限", models: "モデル制限", ip: "IP 制限", enabled: "有効", disabled: "無効", editHint: "他の設定はページのフォームで変更し、再確認してください。", review: "ページの設定を再確認", confirm: "作成を確定", uncertain: "送信結果が不明です。再作成する前に API Key 一覧を確認してください。", completed: "作成済み", copy: "API Key ページでキーをコピーしてください。", failed: "作成できませんでした。ページを確認するか、やり直してください。", cancelled: "キャンセルしました。", expired: "操作の期限が切れました。やり直してください。", cancel: "キャンセル", retry: "再試行", id: "レコード ID" },
};

export function PageWorkflowArtifact({ data, apiBasePath, threadId, onPageAction, locale }: {
  data: Workflow;
  apiBasePath: string;
  threadId: string | undefined;
  onPageAction: MountOptions["onPageAction"];
  locale: string;
}) {
  const copy = /^zh[-_]HK/i.test(locale) ? translations.zh_HK : /^zh/i.test(locale) ? translations.zh_CN : /^ja/i.test(locale) ? translations.ja_JP : translations.en_US;
  const [workflow, setWorkflow] = useState(data);
  const [name, setName] = useState(data.name || "");
  const [custom, setCustom] = useState(false);
  const [summary, setSummary] = useState<PageState>();
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const inFlight = useRef(false);
  const endpoint = threadId ? `${apiBasePath}/threads/${threadId}/page-workflows/${data.workflowId}` : "";

  const report = useCallback(async (step: Workflow["step"], details: { name?: string; recordId?: number } = {}) => {
    if (!endpoint) throw new Error("聊天记录尚未准备好");
    for (let attempt = 0; attempt < 8; attempt++) {
      const response = await fetch(endpoint, {
        method: "PATCH", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step, ...details }),
      });
      const body = await response.json();
      if (response.status === 404 && attempt < 7) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      if (!response.ok || !body.success) throw new Error(body.message || "无法保存工作流状态");
      setWorkflow(body.data);
      return body.data as Workflow;
    }
    throw new Error("无法保存工作流状态");
  }, [endpoint]);

  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const open = async () => {
    try {
      await onPageAction("token.create.editor", { command: "read" });
    } catch {
      await onPageAction("token.create.open", { command: "open" });
      await onPageAction("token.create.editor", { command: "read", wait: true });
    }
  };
  useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout>;
    const wait = () => new Promise<void>((resolve) => {
      retryTimer = setTimeout(resolve, 500);
    });
    for (const [key, entry] of startedWorkflows) {
      if (entry.expiresAt < Date.now()) startedWorkflows.delete(key);
    }
    setError("");
    const load = async () => {
      while (!cancelled) {
        const response = await fetch(endpoint, { credentials: "include", signal: controller.signal });
        if (cancelled) return;
        if (response.status === 404) {
          // The artifact is streamed before the completed reply is persisted.
          if (Date.now() > data.expiresAt) throw new Error(copy.expired);
          await wait();
          continue;
        }
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok || !body.success) throw new Error(body.message || copy.failed);
        const current = body.data as Workflow;
        setWorkflow(current);
        if (current.step === "start" && Date.now() <= current.expiresAt) {
          let started = startedWorkflows.get(endpoint);
          if (!started) {
            const result = (async () => {
              try {
                await open();
                return await report("naming");
              } catch (cause) {
                startedWorkflows.delete(endpoint);
                throw cause;
              }
            })();
            started = { expiresAt: current.expiresAt, result };
            startedWorkflows.set(endpoint, started);
          }
          setBusy(true);
          try {
            const updated = await started.result;
            if (!cancelled) { setWorkflow(updated); setError(""); }
          } finally {
            if (!cancelled) setBusy(false);
          }
        }
        return;
      }
    };
    void load().catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; controller.abort(); clearTimeout(retryTimer); };
  }, [endpoint, recoveryAttempt]);

  const chooseName = (value: string) => void run(async () => {
    const normalized = value.trim();
    if (!normalized || normalized.length > 64) throw new Error(`${copy.name}: 1–64`);
    await open();
    const current = await onPageAction("token.create.editor", { command: "fill", name: normalized }) as PageState;
    setSummary(current);
    setName(normalized);
    await report("review", { name: normalized });
    setReviewed(true);
  });

  const refresh = () => void run(async () => {
    let current: PageState;
    try {
      current = await onPageAction("token.create.editor", { command: "read" }) as PageState;
    } catch {
      await open();
      if (workflow.name) await onPageAction("token.create.editor", { command: "fill", name: workflow.name });
      current = await onPageAction("token.create.editor", { command: "read" }) as PageState;
    }
    setSummary(current);
    setReviewed(true);
    if (current.name !== workflow.name) await report("review", { name: current.name });
  });

  const confirm = () => void run(async () => {
    if (!reviewed || !summary) throw new Error(copy.review);
    const current = await onPageAction("token.create.editor", { command: "read" }) as PageState;
    if (!current.name.trim()) throw new Error(copy.askName);
    if (current.revision !== summary.revision) {
      setSummary(current);
      setReviewed(true);
      await report("review", { name: current.name });
      throw new Error(copy.review);
    }
    await report("submitting", { name: current.name });
    try {
      const result = await onPageAction("token.create.editor", { command: "submit", revision: current.revision }) as { id: number; name: string };
      await report("completed", { name: result.name, recordId: result.id });
    } catch (cause) {
      await report("failed");
      throw cause;
    }
  });

  const cancel = () => void run(async () => { await report("cancelled"); });
  const expired = Date.now() > workflow.expiresAt;
  const terminal = ["completed", "failed", "cancelled"].includes(workflow.step);
  return <section className="aih-artifact aih-page-workflow">
    <h4>{copy.title}</h4>
    {workflow.step === "start" && <p>{busy ? copy.opening : copy.ready}</p>}
    {workflow.step === "naming" && <>
      <p>{copy.askName}</p>
      <div className="aih-page-workflow-actions">
        <button className="aih-button" type="button" disabled={busy || expired} onClick={() => chooseName("my-api-key")}>{copy.defaultName}</button>
        <button className="aih-button" type="button" disabled={busy || expired} onClick={() => setCustom(true)}>{copy.customName}</button>
      </div>
      {custom && <div className="aih-page-workflow-actions"><input aria-label={copy.name} placeholder={copy.name} value={name} maxLength={64} onChange={(event) => setName(event.target.value)} /><button className="aih-button" type="button" disabled={busy || !name.trim()} onClick={() => chooseName(name)}>{copy.fill}</button></div>}
    </>}
    {workflow.step === "review" && <>
      <p>{copy.name}: {summary?.name || workflow.name}</p>
      {summary && <p>{copy.tag}: {summary.defaults.tag}; {copy.quota}: {summary.defaults.unlimitedQuota ? copy.unlimited : summary.defaults.availableAmount}; {copy.expiry}: {summary.defaults.expiresAt === -1 ? copy.longTerm : copy.pageValue}; {copy.models}: {summary.defaults.modelLimitEnabled ? copy.enabled : copy.disabled}; {copy.ip}: {summary.defaults.ipLimitEnabled ? copy.enabled : copy.disabled}</p>}
      <p>{copy.editHint}</p>
      <div className="aih-page-workflow-actions">
        <button className="aih-button" type="button" disabled={busy || expired} onClick={refresh}>{copy.review}</button>
        <button className="aih-button" type="button" disabled={busy || expired || !reviewed} onClick={confirm}>{copy.confirm}</button>
      </div>
    </>}
    {workflow.step === "submitting" && <p>{copy.uncertain}</p>}
    {workflow.step === "completed" && <p>{copy.completed} {workflow.name}（{copy.id}: {workflow.recordId}）。{copy.copy}</p>}
    {workflow.step === "failed" && <p>{copy.failed}</p>}
    {workflow.step === "cancelled" && <p>{copy.cancelled}</p>}
    {expired && !terminal && <p>{copy.expired}</p>}
    {!terminal && workflow.step !== "submitting" && <button className="aih-page-workflow-cancel" type="button" disabled={busy || expired} onClick={cancel}>{copy.cancel}</button>}
    {error && <p className="aih-artifact-error" role="alert">{error}</p>}
    {error && !terminal && !expired && workflow.step !== "submitting" && <button className="aih-button" type="button" disabled={busy} onClick={() => setRecoveryAttempt((attempt) => attempt + 1)}>{copy.retry}</button>}
  </section>;
}
