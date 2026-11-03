export type ToolStepState = "running" | "completed" | "failed" | "confirmation" | "parameters" | "handoff";

export function toolStepState(result: unknown, isError: boolean): ToolStepState {
  if (isError) return "failed";
  if (result === undefined) return "running";
  if (!result || typeof result !== "object") return "completed";
  const response = result as { status?: unknown; success?: unknown; page?: unknown };
  if (response.success === false || response.status === "failed") return "failed";
  if (response.status === "pending_confirmation" || response.status === "pending") return "confirmation";
  if (response.status === "awaiting_parameters") return "parameters";
  if (typeof response.page === "string" && response.page.startsWith("/")) return "handoff";
  return "completed";
}
