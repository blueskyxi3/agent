import type { Artifact } from "@ai-hub-agent/contracts";
import type { UsageSummary } from "./aihub-client.js";

export function usageArtifact(usage: UsageSummary): Artifact {
  return {
    kind: "table",
    version: 1,
    title: "当前账户金额",
    columns: [
      { key: "available", label: `可用额度 (${usage.currency})` },
      { key: "spent", label: `累计消费 (${usage.currency})` },
      { key: "requests", label: "累计请求" },
    ],
    rows: [{ available: usage.amount, spent: usage.used_amount, requests: usage.request_count }],
  };
}
