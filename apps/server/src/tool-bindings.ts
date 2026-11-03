export type ToolBinding = {
  tool: string;
  method: "GET" | "POST";
  endpoint: string;
  behavior: "fixed" | "dynamic" | "local";
};

export const toolBindings: readonly ToolBinding[] = [
  { tool: "start_api_key_page_workflow", method: "GET", endpoint: "/api/user/self/assistant/capabilities/post.api.token", behavior: "fixed" },
  { tool: "search_capabilities", method: "GET", endpoint: "/api/user/self/assistant/capabilities", behavior: "fixed" },
  { tool: "describe_capability", method: "GET", endpoint: "/api/user/self/assistant/capabilities/:operation_id", behavior: "fixed" },
  { tool: "execute_capability", method: "POST", endpoint: "/api/user/self/assistant/executions", behavior: "dynamic" },
  { tool: "get_execution", method: "GET", endpoint: "/api/user/self/assistant/executions/:execution_id", behavior: "fixed" },
  { tool: "list_workflows", method: "GET", endpoint: "/api/user/self/assistant/workflows", behavior: "fixed" },
  { tool: "chart_execution", method: "GET", endpoint: "/api/user/self/assistant/executions/:execution_id", behavior: "local" },
  { tool: "get_consumption_summary", method: "GET", endpoint: "/api/user/self/assistant/consumption-summary", behavior: "fixed" },
  { tool: "open_console_page", method: "GET", endpoint: "/api/user/self", behavior: "local" },
  { tool: "prepare_refresh_usage", method: "GET", endpoint: "/api/user/self/usage", behavior: "local" },
  { tool: "generate_image", method: "POST", endpoint: "/api/user/self/assistant/images/generations", behavior: "fixed" },
  { tool: "generate_video", method: "POST", endpoint: "/api/user/self/assistant/video/generations", behavior: "fixed" },
] as const;

export function toolBinding(name: string) {
  const binding = toolBindings.find((item) => item.tool === name);
  if (!binding) throw new Error(`Missing API binding for Agent tool: ${name}`);
  return binding;
}
