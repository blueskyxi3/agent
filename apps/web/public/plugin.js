const sdk = window.AIHubPluginSDK;

export function GlobalLayer({ apiBase, assetBase }) {
  return sdk.React.createElement(sdk.components.AgentAssistantLayer, { apiBase, assetBase });
}
