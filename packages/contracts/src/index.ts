import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

const linkArtifactSchema = z.object({
  kind: z.literal("link"),
  version: z.literal(PROTOCOL_VERSION),
  title: z.string(),
  description: z.string().optional(),
  label: z.string(),
  href: z.string(),
  guide: z.enum(["token.create", "channel.create"]).optional(),
});

const tableArtifactSchema = z.object({
  kind: z.literal("table"),
  version: z.literal(PROTOCOL_VERSION),
  title: z.string(),
  columns: z.array(z.object({ key: z.string(), label: z.string() })),
  rows: z.array(
    z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  ),
});

const actionArtifactSchema = z.object({
  kind: z.literal("action"),
  version: z.literal(PROTOCOL_VERSION),
  title: z.string(),
  description: z.string().optional(),
  label: z.string(),
  actionId: z.string().uuid(),
  tone: z.enum(["primary", "warning"]).default("primary"),
});

const suggestionsArtifactSchema = z.object({
  kind: z.literal("suggestions"),
  version: z.literal(PROTOCOL_VERSION),
  questions: z
    .tuple([
      z.string().trim().min(1).max(160),
      z.string().trim().min(1).max(160),
    ])
    .refine(([first, second]) => first !== second, {
      message: "Suggested questions must be different",
    }),
});

const parameterFormFieldSchema = z
  .object({
    location: z.enum(["path", "query", "body"]),
    path: z.string().regex(/^(path|query|body)(\.[A-Za-z0-9_-]+)+$/),
    name: z.string().regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/),
    label: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    input: z.enum([
      "text",
      "password",
      "number",
      "boolean",
      "select",
      "multiselect",
      "url",
      "textarea",
      "date",
      "month",
      "array",
      "json",
    ]),
    required: z.boolean(),
    sensitive: z.boolean().optional(),
    deferred_to_confirmation: z.boolean().optional(),
    value: z.unknown().optional(),
    options: z
      .array(
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.object({
            label: z.string().min(1).max(200),
            value: z.union([z.string(), z.number(), z.boolean()]),
            description: z.string().max(500).optional(),
          }),
        ]),
      )
      .max(5000)
      .optional(),
    options_source: z.string().max(120).optional(),
    depends_on: z.array(z.string().max(160)).max(20).optional(),
    browser_only: z.boolean().optional(),
    visible: z.boolean().optional(),
    readonly: z.boolean().optional(),
    loading: z.boolean().optional(),
    advanced: z.boolean().optional(),
    constraints: z.record(z.unknown()).optional(),
    error: z.string().optional(),
  })
  .superRefine((field, context) => {
    if (field.sensitive && field.value !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Sensitive form fields cannot contain values",
        path: ["value"],
      });
  });

const assistantParametersSchema = z.object({
  path: z.record(z.string()),
  query: z.record(z.unknown()),
  body: z.record(z.unknown()),
});

const parameterFormArtifactSchema = z.object({
  kind: z.literal("parameter_form"),
  version: z.literal(PROTOCOL_VERSION),
  formId: z.string().uuid(),
  operationId: z.string().min(1).max(160),
  title: z.string(),
  description: z.string().optional(),
  effect: z.string(),
  risk: z.string(),
  page: z
    .string()
    .regex(/^\/(?!\/)/)
    .max(512)
    .optional(),
  pageLabel: z.string().max(120).optional(),
  parameters: assistantParametersSchema,
  fields: z.array(parameterFormFieldSchema).max(300),
  error: z.string().optional(),
  mode: z.enum(["guided_confirm"]).optional(),
  helpPage: z
    .string()
    .regex(/^\/(?!\/)/)
    .max(512)
    .optional(),
  helpLabel: z.string().max(120).optional(),
});

export const artifactSchema = z.discriminatedUnion("kind", [
  linkArtifactSchema,
  tableArtifactSchema,
  actionArtifactSchema,
  suggestionsArtifactSchema,
  z.object({
    kind: z.literal("page_workflow"),
    version: z.literal(PROTOCOL_VERSION),
    workflowId: z.string().uuid(),
    expiresAt: z.number().int().positive(),
    operationId: z.literal("post.api.token"),
    step: z.enum(["start", "naming", "review", "submitting", "completed", "failed", "cancelled"]).default("start"),
    allowedActions: z.array(z.enum(["open", "fill", "read", "submit", "cancel"])),
    name: z.string().max(64).optional(),
    recordId: z.number().int().positive().optional(),
    message: z.string().max(300).optional(),
  }),
  parameterFormArtifactSchema,
  z.object({
    kind: z.literal("image"),
    version: z.literal(PROTOCOL_VERSION),
    title: z.string(),
    urls: z.array(z.string()).max(10),
  }),
  z.object({
    kind: z.literal("video"),
    version: z.literal(PROTOCOL_VERSION),
    title: z.string(),
    taskId: z.string(),
  }),
  z.object({
    kind: z.literal("execution"),
    version: z.literal(PROTOCOL_VERSION),
    title: z.string(),
    executionId: z.string().uuid(),
    parameters: z.string(),
    secretFields: z.array(z.string()).default([]),
    requiredSecretFields: z.array(z.string()).default([]),
    page: z.string().optional(),
  }),
  z.object({
    kind: z.literal("chart"),
    version: z.literal(PROTOCOL_VERSION),
    title: z.string(),
    chartType: z.enum(["bar", "line", "pie", "donut"]),
    unit: z.string(),
    labels: z.array(z.string()).max(100),
    values: z.array(z.number().finite()).max(100),
    sourceId: z.string().uuid(),
    complete: z.boolean(),
    generatedAt: z.string(),
  }),
]);
export type Artifact = z.infer<typeof artifactSchema>;

export const imageInputSchema = z.object({
  data: z.string().min(1),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
});

export const chatRequestSchema = z.object({
  threadId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(20_000),
  images: z.array(imageInputSchema).max(4).default([]),
  locale: z.enum(["zh_CN", "zh_HK", "en_US", "ja_JP"]).default("zh_CN"),
  page: z
    .object({
      path: z
        .string()
        .regex(/^\/(?!\/)/)
        .max(512),
      query: z
        .record(z.string().max(500))
        .refine((value) => Object.keys(value).length <= 50),
    })
    .optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const deleteThreadsRequestSchema = z.object({
  threadIds: z.array(z.string().uuid()).min(1).max(100),
});
export type DeleteThreadsRequest = z.infer<typeof deleteThreadsRequestSchema>;

const eventBase = { version: z.literal(PROTOCOL_VERSION) };
export const contextUsageSchema = z.object({
  tokens: z.number().int().nonnegative().nullable(),
  contextWindow: z.number().int().positive(),
  percent: z.number().nonnegative().nullable(),
});
export type ContextUsage = z.infer<typeof contextUsageSchema>;
export const turnMetricsSchema = z.object({
  responseId: z.string().optional(),
  characterCount: z.number().int().nonnegative(),
  firstTokenMs: z.number().nonnegative().optional(),
  totalMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  contextUsage: contextUsageSchema.optional(),
});
export type TurnMetrics = z.infer<typeof turnMetricsSchema>;

export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...eventBase,
    type: z.literal("turn.started"),
    threadId: z.string().uuid(),
  }),
  z.object({
    ...eventBase,
    type: z.literal("message.text.delta"),
    delta: z.string(),
  }),
  z.object({
    ...eventBase,
    type: z.literal("message.reasoning.delta"),
    delta: z.string(),
  }),
  z.object({
    ...eventBase,
    type: z.literal("tool.started"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
  }),
  z.object({
    ...eventBase,
    type: z.literal("tool.completed"),
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.unknown().optional(),
  }),
  z.object({
    ...eventBase,
    type: z.literal("tool.failed"),
    toolCallId: z.string(),
    toolName: z.string(),
    message: z.string(),
  }),
  z.object({
    ...eventBase,
    type: z.literal("artifact.created"),
    artifact: artifactSchema,
  }),
  z.object({
    ...eventBase,
    type: z.literal("turn.completed"),
    metrics: turnMetricsSchema,
  }),
  z.object({
    ...eventBase,
    type: z.literal("turn.failed"),
    message: z.string(),
    requestId: z.string().optional(),
  }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;

export const actionResponseSchema = z.object({
  success: z.boolean(),
  artifact: artifactSchema.optional(),
  message: z.string().optional(),
});
export type ActionResponse = z.infer<typeof actionResponseSchema>;
