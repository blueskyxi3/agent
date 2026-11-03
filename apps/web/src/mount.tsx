import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgentAssistant } from "./App";
import type { MountOptions } from "./types";
import "./styles.css";

class AgentMountBoundary extends Component<{ children: ReactNode; locale: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Failed to render the intelligent assistant", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const zh = this.props.locale.startsWith("zh");
    const ja = this.props.locale.startsWith("ja");
    return <div className="aih-root"><div className="aih-mount-error" role="alert"><strong>{zh ? "智能助手暂时无法显示" : ja ? "AI アシスタントを表示できません" : "The AI assistant could not be displayed"}</strong><p>{zh ? "界面加载时发生错误，请重试。" : ja ? "画面の読み込み中にエラーが発生しました。もう一度お試しください。" : "An error occurred while loading the interface. Please try again."}</p><button className="aih-button" type="button" onClick={() => this.setState({ failed: false })}>{zh ? "重试" : ja ? "再試行" : "Retry"}</button></div></div>;
  }
}

export function mountAgentAssistant(element: HTMLElement, initialOptions: MountOptions) {
  const root: Root = createRoot(element);
  let options = initialOptions;
  const render = () => root.render(<AgentMountBoundary locale={options.locale}><AgentAssistant options={options} /></AgentMountBoundary>);
  render();
  return {
    update(nextOptions: MountOptions) { options = nextOptions; render(); },
    unmount() { root.unmount(); },
  };
}

export type { MountOptions } from "./types";
