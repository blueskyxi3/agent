import { useEffect, useRef, useState } from "react";
import type { Artifact } from "@ai-hub-agent/contracts";
import { ExcelExportButton } from "./ExcelExportButton";

const root = "/api/user/self/assistant";
function safeMedia(url: string) {
  return /^https?:\/\//i.test(url) ||
    /^data:image\/(png|jpeg|webp|gif);base64,/i.test(url) ||
    /^\/(?!\/)/.test(url)
    ? url
    : "";
}

type ChartArtifactData = Extract<Artifact, { kind: "chart" }>;
type ParameterFormArtifactData = Extract<Artifact, { kind: "parameter_form" }>;

function chartLabels(locale: string) {
  if (/^zh[-_]HK/i.test(locale))
    return {
      group: "分組",
      total: "共 {count} 項",
      page: "第 {page} / {pages} 頁",
      rows: "每頁",
      previous: "上一頁",
      next: "下一頁",
      complete: "完整結果",
      partial: "僅顯示本次查詢返回的資料",
    };
  if (locale.startsWith("zh"))
    return {
      group: "分组",
      total: "共 {count} 项",
      page: "第 {page} / {pages} 页",
      rows: "每页",
      previous: "上一页",
      next: "下一页",
      complete: "完整结果",
      partial: "仅显示本次查询返回的数据",
    };
  if (locale.startsWith("ja"))
    return {
      group: "グループ",
      total: "全 {count} 件",
      page: "{page} / {pages} ページ",
      rows: "表示件数",
      previous: "前へ",
      next: "次へ",
      complete: "完全な結果",
      partial: "今回のクエリで返されたデータのみ",
    };
  return {
    group: "Group",
    total: "{count} items",
    page: "Page {page} of {pages}",
    rows: "Rows",
    previous: "Previous",
    next: "Next",
    complete: "Complete result",
    partial: "Data returned by this query only",
  };
}

function executionLabels(locale: string) {
  if (/^zh[-_]HK/i.test(locale))
    return {
      title: "確認系統操作",
      input: "請求參數",
      output: "響應結果",
      json: "JSON",
      run: "確認執行",
      loading: "讀取狀態…",
      pending: "等待確認",
      running: "執行中…",
      review: "前往頁面核對",
      completed: "已完成",
      failed: "執行失敗",
      expired: "已過期",
      stale: "需要重新準備",
      loadFailed: "無法讀取操作狀態，請稍後重試",
    };
  if (locale.startsWith("zh"))
    return {
      title: "确认系统操作",
      input: "请求参数",
      output: "响应结果",
      json: "JSON",
      run: "确认执行",
      loading: "读取状态…",
      pending: "等待确认",
      running: "执行中…",
      review: "前往页面核对",
      completed: "已完成",
      failed: "执行失败",
      expired: "已过期",
      stale: "需要重新准备",
      loadFailed: "无法读取操作状态，请稍后重试",
    };
  if (locale.startsWith("ja"))
    return {
      title: "システム操作の確認",
      input: "リクエスト",
      output: "レスポンス",
      json: "JSON",
      run: "実行を確認",
      loading: "状態を取得中…",
      pending: "確認待ち",
      running: "実行中…",
      review: "ページで確認",
      completed: "完了",
      failed: "失敗",
      expired: "期限切れ",
      stale: "再準備が必要",
      loadFailed:
        "操作状態を取得できません。しばらくしてから再試行してください",
    };
  return {
    title: "Confirm system action",
    input: "Request",
    output: "Response",
    json: "JSON",
    run: "Confirm",
    loading: "Loading status…",
    pending: "Awaiting confirmation",
    running: "Running…",
    review: "Review on page",
    completed: "Completed",
    failed: "Failed",
    expired: "Expired",
    stale: "Prepare again",
    loadFailed: "Could not load the execution status. Try again shortly.",
  };
}

type ExecutionRecord = {
  status: string;
  result?: string;
  failure_reason?: string;
  parameters?: string;
  secret_fields?: string[];
  required_secret_fields?: string[];
  page?: string;
  form?: any;
};

async function readExecution(executionId: string) {
  const response = await fetch(
    `${root}/executions/${encodeURIComponent(executionId)}`,
    { credentials: "include", headers: { accept: "application/json" } },
  );
  const body = (await response.json()) as {
    success?: boolean;
    data?: ExecutionRecord;
    message?: string;
  };
  if (!response.ok || !body.success || !body.data)
    throw new Error(body.message || `HTTP ${response.status}`);
  return body.data;
}

function prettyJSON(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formLabels(locale: string) {
  if (/^zh[-_]HK/i.test(locale))
    return {
      path: "路徑參數",
      query: "查詢參數",
      body: "請求內容",
      optional: "選填",
      deferred: "在最終確認時填寫",
      submit: "提交參數",
      review: "下一步：核對",
      submitting: "提交中…",
      required: "請填寫此必填欄位",
      invalidNumber: "請輸入有效數字",
      invalidJSON: "請輸入有效的 JSON",
      expired: "表單已過期，請重新發起操作",
    };
  if (locale.startsWith("zh"))
    return {
      path: "路径参数",
      query: "查询参数",
      body: "请求内容",
      optional: "选填",
      deferred: "在最终确认时填写",
      submit: "提交参数",
      review: "下一步：核对",
      submitting: "提交中…",
      required: "请填写此必填字段",
      invalidNumber: "请输入有效数字",
      invalidJSON: "请输入有效的 JSON",
      expired: "表单已过期，请重新发起操作",
    };
  if (locale.startsWith("ja"))
    return {
      path: "パスパラメータ",
      query: "クエリパラメータ",
      body: "リクエスト本文",
      optional: "任意",
      deferred: "最終確認時に入力",
      submit: "パラメータを送信",
      review: "次へ：確認",
      submitting: "送信中…",
      required: "必須項目を入力してください",
      invalidNumber: "有効な数値を入力してください",
      invalidJSON: "有効な JSON を入力してください",
      expired: "フォームの有効期限が切れました",
    };
  return {
    path: "Path parameters",
    query: "Query parameters",
    body: "Request body",
    optional: "Optional",
    deferred: "Enter during final confirmation",
    submit: "Submit parameters",
    review: "Next: review",
    submitting: "Submitting…",
    required: "This field is required",
    invalidNumber: "Enter a valid number",
    invalidJSON: "Enter valid JSON",
    expired: "This form has expired. Prepare the action again.",
  };
}

function fieldInitialValue(field: ParameterFormArtifactData["fields"][number]) {
  if (field.value === undefined || field.value === null) return "";
  if (field.input === "multiselect")
    return Array.isArray(field.value) ? field.value : [];
  if (field.input === "array" || field.input === "json")
    return JSON.stringify(field.value, null, 2);
  if (field.input === "text" || field.input === "textarea")
    return String(field.value);
  return field.value;
}

function optionValue(option: any) {
  return option && typeof option === "object" ? option.value : option;
}
function optionLabel(option: any) {
  return option && typeof option === "object" ? option.label : String(option);
}

function parametersFromValues(
  form: ParameterFormArtifactData,
  values: Record<string, unknown>,
) {
  const parameters = structuredClone(form.parameters);
  for (const field of form.fields) {
    if (field.sensitive) continue;
    setParameterValue(parameters, field, values[field.path]);
  }
  return parameters;
}

function setParameterValue(
  parameters: ParameterFormArtifactData["parameters"],
  field: ParameterFormArtifactData["fields"][number],
  value: unknown,
) {
  const section = parameters[field.location] as Record<string, unknown>;
  const parts = field.name.split(".");
  let target = section;
  for (const part of parts.slice(0, -1)) {
    if (
      !target[part] ||
      typeof target[part] !== "object" ||
      Array.isArray(target[part])
    )
      target[part] = {};
    target = target[part] as Record<string, unknown>;
  }
  const key = parts.at(-1)!;
  if (value === "" || value === undefined) delete target[key];
  else target[key] = value;
}

function ParameterFormArtifact({
  data,
  locale,
  onNavigate,
}: {
  data: ParameterFormArtifactData;
  locale: string;
  onNavigate?: (href: string) => void;
}) {
  const copy = formLabels(locale);
  const [form, setForm] = useState(data);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      data.fields.map((field) => [field.path, fieldInitialValue(field)]),
    ),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState(data.error ?? "");
  const [busy, setBusy] = useState(false);
  const [transition, setTransition] =
    useState<Extract<Artifact, { kind: "execution" }>>();
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const secretsRef = useRef<Record<string, string>>({});
  const resolveSequence = useRef(0);
  const [dirtyFields, setDirtyFields] = useState<string[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const applyResolvedForm = (
    resolved: ParameterFormArtifactData,
    preserve: Record<string, unknown> = {},
  ) => {
    setForm(resolved);
    setValues(
      Object.fromEntries(
        resolved.fields.map((field) => [
          field.path,
          preserve[field.path] ?? fieldInitialValue(field),
        ]),
      ),
    );
    setError(resolved.error ?? "");
  };
  const resolveForm = async (
    currentForm: ParameterFormArtifactData,
    currentValues: Record<string, unknown>,
    changedField = "",
    dirty = dirtyFields,
  ) => {
    const sequence = ++resolveSequence.current;
    setBusy(true);
    try {
      const response = await fetch(
        `${root}/executions/${encodeURIComponent(currentForm.formId)}/form/resolve`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            changed_field: changedField,
            dirty_fields: dirty,
            parameters: parametersFromValues(currentForm, currentValues),
          }),
        },
      );
      const body = (await response.json()) as {
        success?: boolean;
        data?: { form?: ParameterFormArtifactData };
        message?: string;
      };
      if (!response.ok || !body.success || !body.data?.form)
        throw new Error(body.message || `HTTP ${response.status}`);
      if (sequence !== resolveSequence.current) return;
      applyResolvedForm(
        {
          ...data,
          ...body.data.form,
          helpPage: (body.data.form as any).help_page,
          helpLabel: (body.data.form as any).help_label,
        },
        changedField === "body.type"
          ? Object.fromEntries(
              Object.entries(currentValues).filter(
                ([key]) =>
                  ![
                    "body.name",
                    "body.models",
                    "body.base_url",
                    "body.other",
                  ].includes(key) ||
                  (key === "body.name" && dirty.includes(key)),
              ),
            )
          : currentValues,
      );
    } catch (reason) {
      if (sequence === resolveSequence.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (sequence === resolveSequence.current) setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void readExecution(data.formId)
      .then((execution) => {
        if (cancelled) return;
        if (execution.status === "awaiting_parameters") {
          if (execution.form) {
            const restored = {
              ...data,
              formId: execution.form.id,
              operationId: execution.form.operation_id,
              ...execution.form,
              helpPage: execution.form.help_page,
              helpLabel: execution.form.help_label,
              pageLabel: execution.form.page_label,
            } as ParameterFormArtifactData;
            applyResolvedForm(restored);
            if (restored.mode === "guided_confirm")
              void resolveForm(
                restored,
                Object.fromEntries(
                  restored.fields.map((field) => [
                    field.path,
                    fieldInitialValue(field),
                  ]),
                ),
              );
          }
          return;
        }
        setTransition({
          kind: "execution",
          version: 1,
          title: data.title,
          executionId: data.formId,
          parameters: execution.parameters ?? JSON.stringify(data.parameters),
          secretFields: execution.secret_fields ?? [],
          requiredSecretFields: execution.required_secret_fields ?? [],
          ...(execution.page || data.page
            ? { page: execution.page || data.page }
            : {}),
        });
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : copy.expired);
      });
    return () => {
      cancelled = true;
    };
  }, [copy.expired, data]);

  if (transition)
    return (
      <BusinessArtifact
        data={transition}
        locale={locale}
        internalInitialSecrets={secretsRef.current}
        {...(onNavigate ? { onNavigate } : {})}
      />
    );

  const submit = async () => {
    const errors: Record<string, string> = {};
    const nextSecrets = { ...secrets };
    const parameters = structuredClone(form.parameters);
    for (const field of form.fields) {
      if (field.sensitive) {
        const secret = String(values[field.path] ?? "").trim();
        if (field.required && !secret) errors[field.path] = copy.required;
        if (secret) nextSecrets[field.name] = secret;
        continue;
      }
      if (field.deferred_to_confirmation) continue;
      let value = values[field.path];
      if (
        field.required &&
        (value === "" ||
          value === undefined ||
          value === null ||
          (Array.isArray(value) && value.length === 0))
      ) {
        errors[field.path] = copy.required;
        continue;
      }
      if (value === "" || value === undefined) {
        setParameterValue(parameters, field, "");
        continue;
      }
      if (field.input === "number") {
        value = Number(value);
        if (!Number.isFinite(value)) {
          errors[field.path] = copy.invalidNumber;
          continue;
        }
      }
      if (field.input === "select")
        value =
          field.options
            ?.map(optionValue)
            .find((option) => String(option) === String(value)) ?? value;
      if (field.input === "multiselect")
        value = Array.isArray(value) ? value : [];
      if (field.input === "array" || field.input === "json") {
        try {
          value = JSON.parse(String(value));
        } catch {
          errors[field.path] = copy.invalidJSON;
          continue;
        }
      }
      setParameterValue(parameters, field, value);
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    setSecrets(nextSecrets);
    secretsRef.current = nextSecrets;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `${root}/executions/${encodeURIComponent(data.formId)}/parameters`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parameters }),
        },
      );
      const body = (await response.json()) as {
        success?: boolean;
        data?: any;
        message?: string;
      };
      if (!response.ok || !body.success) {
        if (body.data?.form) {
          const next = {
            ...data,
            formId: body.data.form.id,
            operationId: body.data.form.operation_id,
            ...body.data.form,
            helpPage: body.data.form.help_page,
            helpLabel: body.data.form.help_label,
            pageLabel: body.data.form.page_label,
          } as ParameterFormArtifactData;
          setForm(next);
          setValues(
            Object.fromEntries(
              next.fields.map((field) => [
                field.path,
                fieldInitialValue(field),
              ]),
            ),
          );
          setError(next.error ?? "");
        } else {
          setError(body.message || "提交失败");
        }
        return;
      }
      const execution = body.data?.execution ?? body.data;
      setTransition({
        kind: "execution",
        version: 1,
        title: data.title,
        executionId: data.formId,
        parameters: execution.parameters ?? JSON.stringify(parameters),
        secretFields: body.data?.secret_fields ?? execution.secret_fields ?? [],
        requiredSecretFields:
          body.data?.required_secret_fields ??
          execution.required_secret_fields ??
          [],
        ...(body.data?.page || execution.page || data.page
          ? { page: body.data?.page || execution.page || data.page }
          : {}),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const visibleFields = form.fields.filter(
    (field) => field.visible !== false && (!field.advanced || advancedOpen),
  );
  const modelsField = form.fields.find((field) => field.path === "body.models");
  const guidedUnavailable =
    form.mode === "guided_confirm" &&
    modelsField !== undefined &&
    (modelsField.options?.length ?? 0) === 0;
  return (
    <section className="aih-artifact aih-parameter-form">
      <header className="aih-execution-heading">
        <div>
          <h4>{form.title}</h4>
          {form.description && <p>{form.description}</p>}
        </div>
        <span>{form.effect}</span>
      </header>
      {(["path", "query", "body"] as const).map((location) => {
        const fields = visibleFields.filter(
          (field) => field.location === location,
        );
        if (!fields.length) return null;
        return (
          <fieldset key={location}>
            <legend>{copy[location]}</legend>
            {fields.map((field) => {
              const value = values[field.path];
              const update = (next: unknown) => {
                const nextValues = { ...values, [field.path]: next };
                setValues(nextValues);
                const nextDirty = dirtyFields.includes(field.path)
                  ? dirtyFields
                  : [...dirtyFields, field.path];
                setDirtyFields(nextDirty);
                if (field.path === "body.type")
                  void resolveForm(form, nextValues, field.path, nextDirty);
              };
              return (
                <label className="aih-form-field" key={field.path}>
                  <span>
                    {field.label}
                    {field.required && <b aria-label="required">*</b>}
                    {!field.required && <small>{copy.optional}</small>}
                  </span>
                  {field.description && <em>{field.description}</em>}
                  {field.input === "boolean" ? (
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      disabled={field.readonly || field.loading}
                      onChange={(event) => update(event.target.checked)}
                    />
                  ) : field.input === "select" ? (
                    <select
                      value={String(value ?? "")}
                      disabled={field.readonly || field.loading}
                      onChange={(event) => update(event.target.value)}
                    >
                      <option value="">—</option>
                      {field.options?.map((option) => (
                        <option
                          key={String(optionValue(option))}
                          value={String(optionValue(option))}
                        >
                          {optionLabel(option)}
                        </option>
                      ))}
                    </select>
                  ) : field.input === "multiselect" ? (
                    <select
                      multiple
                      value={(Array.isArray(value) ? value : []).map(String)}
                      disabled={field.readonly || field.loading}
                      onChange={(event) =>
                        update(
                          Array.from(
                            event.currentTarget.selectedOptions,
                            (option) => option.value,
                          ),
                        )
                      }
                    >
                      {field.options?.map((option) => (
                        <option
                          key={String(optionValue(option))}
                          value={String(optionValue(option))}
                        >
                          {optionLabel(option)}
                        </option>
                      ))}
                    </select>
                  ) : field.input === "array" ||
                    field.input === "json" ||
                    field.input === "textarea" ? (
                    <textarea
                      value={String(value ?? "")}
                      readOnly={field.readonly}
                      onChange={(event) => update(event.target.value)}
                    />
                  ) : (
                    <input
                      type={
                        field.sensitive
                          ? "password"
                          : field.input === "number"
                            ? "number"
                            : field.input === "date"
                              ? "date"
                              : field.input === "month"
                                ? "month"
                                : field.input === "url"
                                  ? "url"
                                  : "text"
                      }
                      value={String(value ?? "")}
                      readOnly={field.readonly}
                      autoComplete={field.sensitive ? "off" : undefined}
                      min={field.constraints?.minimum as number | undefined}
                      max={field.constraints?.maximum as number | undefined}
                      minLength={
                        field.constraints?.minLength as number | undefined
                      }
                      maxLength={
                        field.constraints?.maxLength as number | undefined
                      }
                      pattern={field.constraints?.pattern as string | undefined}
                      onChange={(event) => update(event.target.value)}
                    />
                  )}
                  {(fieldErrors[field.path] || field.error) && (
                    <strong role="alert">
                      {fieldErrors[field.path] || field.error}
                    </strong>
                  )}
                </label>
              );
            })}
          </fieldset>
        );
      })}
      {form.fields.some((field) => field.advanced) && (
        <button
          className="aih-form-advanced-toggle"
          type="button"
          onClick={() => setAdvancedOpen((value) => !value)}
        >
          {advancedOpen ? "收起高级设置" : "展开高级设置"}
        </button>
      )}
      {error && (
        <p className="aih-execution-error" role="alert">
          {error}
        </p>
      )}
      <div className="aih-execution-actions">
        <button
          className="aih-button"
          type="button"
          disabled={busy || guidedUnavailable}
          onClick={submit}
        >
          {busy
            ? copy.submitting
            : form.mode === "guided_confirm"
              ? copy.review
              : copy.submit}
        </button>
        {form.helpPage && onNavigate && /^\/(?!\/)/.test(form.helpPage) && (
          <button
            className="aih-button aih-page-review-button"
            type="button"
            onClick={() => onNavigate(form.helpPage!)}
          >
            {form.helpLabel || "打开相关页面"}
            <span aria-hidden="true">→</span>
          </button>
        )}
        {form.page && onNavigate && /^\/(?!\/)/.test(form.page) && (
          <button
            className="aih-button aih-page-review-button"
            type="button"
            onClick={() => onNavigate(form.page!)}
          >
            {form.pageLabel || "打开相关页面"}
            <span aria-hidden="true">→</span>
          </button>
        )}
      </div>
    </section>
  );
}

function ChartArtifact({
  data,
  locale,
}: {
  data: ChartArtifactData;
  locale: string;
}) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [tooltip, setTooltip] = useState<{
    index: number;
    x: number;
    y: number;
  }>();
  const chartVisualRef = useRef<HTMLDivElement>(null);
  const copy = chartLabels(locale);
  const values = data.values.slice(0, data.labels.length);
  const pageCount = Math.max(1, Math.ceil(values.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleValues = values.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values),
    span = max - min;
  const x = (index: number) =>
    30 + (index * 440) / Math.max(1, values.length - 1);
  const y = (value: number) => 180 - ((value - min) / span) * 160;
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  let angle = -Math.PI / 2;
  const interpolate = (
    template: string,
    replacements: Record<string, string | number>,
  ) =>
    Object.entries(replacements).reduce(
      (value, [key, replacement]) =>
        value.replace(`{${key}}`, String(replacement)),
      template,
    );
  // AI Hub uses i18next locales such as zh_CN; Intl requires BCP 47 tags.
  const number = new Intl.NumberFormat(locale.replaceAll("_", "-"), {
    maximumFractionDigits: 8,
  });
  const percentage = new Intl.NumberFormat(locale.replaceAll("_", "-"), {
    style: "percent",
    maximumFractionDigits: 2,
  });
  const color = (index: number) => `hsl(${(215 + index * 137.5) % 360},65%,56%)`;
  const radial = data.chartType === "pie" || data.chartType === "donut";
  const exportColumns = [
    { key: "index", label: "#" },
    { key: "group", label: copy.group },
    { key: "value", label: data.unit },
  ];
  const exportRows = values.map((value, index) => ({
    index: index + 1,
    group: data.labels[index] ?? "",
    value,
  }));
  const showTooltip = (index: number, target: SVGElement) => {
    const visualBounds = chartVisualRef.current?.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    if (!visualBounds || !visualBounds.width || !visualBounds.height) return;
    setTooltip({
      index,
      x: Math.min(
        Math.max(targetBounds.left + targetBounds.width / 2 - visualBounds.left, 12),
        visualBounds.width - 12,
      ),
      y: Math.max(targetBounds.top - visualBounds.top, 8),
    });
  };
  const hideTooltip = () => setTooltip(undefined);
  const tooltipValue = tooltip ? values[tooltip.index] : undefined;
  const tooltipText =
    tooltip && tooltipValue !== undefined
      ? `${data.labels[tooltip.index]}: ${number.format(tooltipValue)} ${data.unit}${
          (data.chartType === "pie" || data.chartType === "donut") && total > 0
            ? ` (${percentage.format(Math.max(0, tooltipValue) / total)})`
            : ""
        }`
      : "";
  return (
    <section className="aih-artifact aih-chart-artifact">
      <header className="aih-chart-heading">
        <div>
          <h4>{data.title}</h4>
          <small>{data.complete ? copy.complete : copy.partial}</small>
        </div>
        <div className="aih-chart-heading-actions">
          <span>{data.unit}</span>
          <ExcelExportButton
            title={data.title}
            columns={exportColumns}
            rows={exportRows}
            locale={locale}
          />
        </div>
      </header>
      <div className="aih-chart-visual" ref={chartVisualRef}>
        <svg viewBox={radial ? "120 0 260 205" : "0 0 500 205"} role="img" aria-label={data.title}>
          {data.chartType === "line" ? (
            <>
              <line
                x1="25"
                y1={y(0)}
                x2="480"
                y2={y(0)}
                className="aih-chart-axis"
              />
              <polyline
                points={values
                  .map((value, index) => `${x(index)},${y(value)}`)
                  .join(" ")}
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {values.map((value, index) => (
                <g key={index}>
                  <circle
                    cx={x(index)}
                    cy={y(value)}
                    r="3.5"
                    fill="var(--aih-surface)"
                    stroke="currentColor"
                    strokeWidth="2"
                    pointerEvents="none"
                  />
                  <circle
                    cx={x(index)}
                    cy={y(value)}
                    r="12"
                    fill="transparent"
                    tabIndex={0}
                    role="img"
                    aria-label={`${data.labels[index]}: ${number.format(value)} ${data.unit}`}
                    onPointerEnter={(event) => showTooltip(index, event.currentTarget)}
                    onPointerMove={(event) => showTooltip(index, event.currentTarget)}
                    onPointerLeave={hideTooltip}
                    onFocus={(event) => showTooltip(index, event.currentTarget)}
                    onBlur={hideTooltip}
                  >
                    <title>
                      {data.labels[index]}: {number.format(value)} {data.unit}
                    </title>
                  </circle>
                </g>
              ))}
            </>
          ) : data.chartType === "donut" && total === 0 && min >= 0 ? (
            <>
              <circle
                cx="250"
                cy="100"
                r="66.5"
                fill="none"
                stroke="var(--aih-border)"
                strokeWidth="37"
              >
                <title>0 {data.unit}</title>
              </circle>
              <text x="250" y="100" className="aih-chart-sector-label">
                0
              </text>
            </>
          ) : (data.chartType === "pie" || data.chartType === "donut") &&
            total > 0 &&
            min >= 0 ? (
            values.map((value, index) => {
              const start = angle;
              angle += (value / total) * Math.PI * 2;
              const largeArc = angle - start > Math.PI ? 1 : 0;
              const outerStart = `${250 + 85 * Math.cos(start)},${100 + 85 * Math.sin(start)}`;
              const outerEnd = `${250 + 85 * Math.cos(angle)},${100 + 85 * Math.sin(angle)}`;
              const innerEnd = `${250 + 48 * Math.cos(angle)},${100 + 48 * Math.sin(angle)}`;
              const innerStart = `${250 + 48 * Math.cos(start)},${100 + 48 * Math.sin(start)}`;
              const path =
                data.chartType === "donut"
                  ? `M${outerStart} A85,85 0 ${largeArc},1 ${outerEnd} L${innerEnd} A48,48 0 ${largeArc},0 ${innerStart} Z`
                  : `M250,100 L${outerStart} A85,85 0 ${largeArc},1 ${outerEnd} Z`;
              const share = value / total;
              const middle = start + (angle - start) / 2;
              const labelRadius = data.chartType === "donut" ? 67 : 55;
              const labelX = 250 + labelRadius * Math.cos(middle);
              const labelY = 100 + labelRadius * Math.sin(middle);
              const ariaLabel = `${data.labels[index]}: ${number.format(value)} ${data.unit} (${percentage.format(share)})`;
              const interaction = {
                tabIndex: 0,
                role: "img",
                "aria-label": ariaLabel,
                onPointerEnter: (event: React.PointerEvent<SVGElement>) =>
                  showTooltip(index, event.currentTarget),
                onPointerMove: (event: React.PointerEvent<SVGElement>) =>
                  showTooltip(index, event.currentTarget),
                onPointerLeave: hideTooltip,
                onFocus: (event: React.FocusEvent<SVGElement>) =>
                  showTooltip(index, event.currentTarget),
                onBlur: hideTooltip,
              };
              if (value <= 0) return null;
              return value === total ? (
                <g key={index}>
                  {data.chartType === "donut" ? (
                    <circle
                      {...interaction}
                      className="aih-chart-sector"
                      cx="250"
                      cy="100"
                      r="66.5"
                      fill="none"
                      stroke={color(index)}
                      strokeWidth="37"
                    >
                      <title>{ariaLabel}</title>
                    </circle>
                  ) : (
                    <circle
                      {...interaction}
                      className="aih-chart-sector"
                      cx="250"
                      cy="100"
                      r="85"
                      fill={color(index)}
                    >
                      <title>{ariaLabel}</title>
                    </circle>
                  )}
                  <text x="250" y="100" className="aih-chart-sector-label">
                    {percentage.format(1)}
                  </text>
                </g>
              ) : (
                <g key={index}>
                  <path
                    {...interaction}
                    className="aih-chart-sector"
                    d={path}
                    fill={color(index)}
                  >
                    <title>{ariaLabel}</title>
                  </path>
                  {share >= 0.035 && (
                    <text
                      x={labelX}
                      y={labelY}
                      className="aih-chart-sector-label"
                    >
                      {percentage.format(share)}
                    </text>
                  )}
                </g>
              );
            })
          ) : (
            values.map((value, index) => (
              <rect
                key={index}
                x={25 + (index * 450) / Math.max(1, values.length)}
                y={Math.min(y(value), y(0))}
                width={Math.max(2, 400 / Math.max(1, values.length))}
                height={Math.max(1, Math.abs(y(value) - y(0)))}
                rx="2"
                fill={color(index)}
                tabIndex={0}
                role="img"
                aria-label={`${data.labels[index]}: ${number.format(value)} ${data.unit}`}
                onPointerEnter={(event) => showTooltip(index, event.currentTarget)}
                onPointerMove={(event) => showTooltip(index, event.currentTarget)}
                onPointerLeave={hideTooltip}
                onFocus={(event) => showTooltip(index, event.currentTarget)}
                onBlur={hideTooltip}
              >
                <title>
                  {data.labels[index]}: {number.format(value)} {data.unit}
                </title>
              </rect>
            ))
          )}
        </svg>
        {tooltip && tooltipValue !== undefined && (
          <div
            className="aih-chart-tooltip"
            role="status"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            {tooltipText}
          </div>
        )}
      </div>
      <div className="aih-chart-table-wrap">
        <table className="aih-chart-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{copy.group}</th>
              <th>{data.unit}</th>
            </tr>
          </thead>
          <tbody>
            {visibleValues.map((value, index) => {
              const sourceIndex = currentPage * pageSize + index;
              return (
                <tr key={`${data.labels[sourceIndex]}-${sourceIndex}`}>
                  <td>{sourceIndex + 1}</td>
                  <td title={data.labels[sourceIndex]}>
                    <span className="aih-chart-group">
                      <span className="aih-chart-key" aria-hidden="true" style={{ background: data.chartType === "line" ? "var(--aih-primary)" : color(sourceIndex) }} />
                      <span>{data.labels[sourceIndex]}</span>
                    </span>
                  </td>
                  <td>{number.format(value)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {values.length > 10 && (
        <footer className="aih-chart-pagination">
          <span>{interpolate(copy.total, { count: values.length })}</span>
          <label>
            {copy.rows}
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
          <span>
            {interpolate(copy.page, {
              page: currentPage + 1,
              pages: pageCount,
            })}
          </span>
          <div>
            <button
              type="button"
              aria-label={copy.previous}
              title={copy.previous}
              disabled={currentPage === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label={copy.next}
              title={copy.next}
              disabled={currentPage >= pageCount - 1}
              onClick={() =>
                setPage((value) => Math.min(pageCount - 1, value + 1))
              }
            >
              ›
            </button>
          </div>
        </footer>
      )}
      <div className="aih-chart-source">
        <time>{data.generatedAt}</time>
        <span>{data.sourceId}</span>
      </div>
    </section>
  );
}

export function BusinessArtifact({
  data,
  locale = "zh-CN",
  onNavigate,
  internalInitialSecrets,
}: {
  data: Artifact;
  locale?: string;
  onNavigate?: (href: string) => void;
  internalInitialSecrets?: Record<string, string>;
}) {
  const executionId = data.kind === "execution" ? data.executionId : "";
  const [result, setResult] = useState<any>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [secrets, setSecrets] = useState<Record<string, string>>(
    internalInitialSecrets ?? {},
  );
  const [replacementForm, setReplacementForm] =
    useState<ParameterFormArtifactData>();
  const [executionLoaded, setExecutionLoaded] = useState(false);
  useEffect(() => {
    if (data.kind !== "video") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(
          `${root}/video/generations/${encodeURIComponent(data.taskId)}`,
          { credentials: "include" },
        );
        const body = await response.json();
        if (!response.ok || !body.success)
          throw new Error(body.message || "读取任务失败");
        if (cancelled) return;
        setResult(body.data);
        if (
          !["succeeded", "failed", "cancelled", "completed"].includes(
            body.data.status,
          )
        )
          timer = setTimeout(poll, 5000);
      } catch (error) {
        if (!cancelled) setError(String(error));
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [data]);
  useEffect(() => {
    if (!executionId) return;
    let cancelled = false;
    setResult(undefined);
    setError("");
    setExecutionLoaded(false);
    void readExecution(executionId)
      .then((execution) => {
        if (!cancelled) {
          setResult(execution);
          setExecutionLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(executionLabels(locale).loadFailed);
          setExecutionLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [executionId, locale]);
  const confirm = async () => {
    if (data.kind !== "execution") return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `${root}/executions/${data.executionId}/confirm`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secrets }),
        },
      );
      const body = await response.json();
      if (!response.ok || !body.success) {
        if (body.data?.form) {
          setReplacementForm({
            kind: "parameter_form",
            version: 1,
            formId: body.data.form.id,
            operationId: body.data.form.operation_id,
            title: body.data.form.title,
            description: body.data.form.description,
            effect: body.data.form.effect,
            risk: body.data.form.risk,
            parameters: body.data.form.parameters,
            fields: body.data.form.fields,
            error: body.data.form.error,
            ...(body.data.form.mode ? { mode: body.data.form.mode } : {}),
            ...(body.data.form.page
              ? {
                  page: body.data.form.page,
                  pageLabel: body.data.form.page_label,
                }
              : {}),
            ...(body.data.form.help_page
              ? {
                  helpPage: body.data.form.help_page,
                  helpLabel: body.data.form.help_label,
                }
              : {}),
          });
          setSecrets({});
          return;
        }
        setError(body.message || "执行失败");
        try {
          setResult(await readExecution(data.executionId));
        } catch {
          /* Keep the server confirmation error. */
        }
        return;
      }
      setResult(body.data);
      setSecrets({});
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  if (replacementForm)
    return (
      <ParameterFormArtifact
        data={replacementForm}
        locale={locale}
        {...(onNavigate ? { onNavigate } : {})}
      />
    );
  if (data.kind === "image")
    return (
      <section className="aih-artifact">
        <h4>{data.title}</h4>
        {data.urls.map((url, i) => (
          <a key={i} href={safeMedia(url)} target="_blank" rel="noreferrer">
            <img
              src={safeMedia(url)}
              alt={data.title}
              style={{ maxWidth: "100%" }}
            />
          </a>
        ))}
      </section>
    );
  if (data.kind === "video")
    return (
      <section className="aih-artifact">
        <h4>{data.title}</h4>
        <p>{error || result?.failure_reason || result?.status || "处理中…"}</p>
        {result?.video_url && (
          <video
            src={safeMedia(result.video_url)}
            controls
            style={{ maxWidth: "100%" }}
          />
        )}
      </section>
    );
  if (data.kind === "parameter_form")
    return (
      <ParameterFormArtifact
        data={data}
        locale={locale}
        {...(onNavigate ? { onNavigate } : {})}
      />
    );
  if (data.kind === "execution") {
    const copy = executionLabels(locale);
    const page = data.page && /^\/(?!\/)/.test(data.page) ? data.page : "";
    const status = (result as ExecutionRecord | undefined)?.status;
    const statusLabel =
      status === "completed"
        ? copy.completed
        : status === "failed"
          ? copy.failed
          : status === "expired"
            ? copy.expired
            : status === "stale"
              ? copy.stale
              : status === "running"
                ? copy.running
                : status === "pending"
                  ? copy.pending
                  : copy.failed;
    const requiredSecretFields = data.requiredSecretFields ?? [];
    const requiredSecretsPresent = requiredSecretFields.every((key) =>
      Boolean(secrets[key]?.trim()),
    );
    const canConfirm =
      executionLoaded && status === "pending" && requiredSecretsPresent;
    const failureReason = (result as ExecutionRecord | undefined)
      ?.failure_reason;
    return (
      <section className="aih-artifact aih-execution-artifact">
        <header className="aih-execution-heading">
          <h4>{copy.title}</h4>
          <span>{executionLoaded ? statusLabel : copy.loading}</span>
        </header>
        <details className="aih-json-disclosure">
          <summary>
            <span>{copy.input}</span>
            <small>{copy.json}</small>
          </summary>
          <pre>{prettyJSON(data.parameters)}</pre>
        </details>
        {executionLoaded &&
          status === "pending" &&
          data.secretFields.map((key) => (
            <label className="aih-secret-field" key={key}>
              <span>
                {key}
                {requiredSecretFields.includes(key) && (
                  <b aria-label="required">*</b>
                )}
              </span>
              <input
                type="password"
                required={requiredSecretFields.includes(key)}
                autoComplete="off"
                value={secrets[key] || ""}
                onChange={(event) =>
                  setSecrets({ ...secrets, [key]: event.target.value })
                }
              />
            </label>
          ))}
        {(error || failureReason) && (
          <p className="aih-execution-error" role="alert">
            {error || failureReason}
          </p>
        )}
        <div className="aih-execution-actions">
          <button
            className="aih-button"
            type="button"
            disabled={busy || !canConfirm}
            onClick={confirm}
          >
            {busy
              ? copy.running
              : !executionLoaded
                ? copy.loading
                : status === "pending"
                  ? copy.run
                  : statusLabel}
          </button>
          {page && onNavigate && (
            <button
              className="aih-button aih-page-review-button"
              type="button"
              onClick={() => onNavigate(page)}
            >
              {copy.review}
              <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
        {(result as ExecutionRecord | undefined)?.result && (
          <details className="aih-json-disclosure">
            <summary>
              <span>{copy.output}</span>
              <small>{copy.json}</small>
            </summary>
            <pre>{prettyJSON((result as ExecutionRecord).result!)}</pre>
          </details>
        )}
      </section>
    );
  }
  if (data.kind === "chart")
    return <ChartArtifact data={data} locale={locale} />;
  return null;
}
