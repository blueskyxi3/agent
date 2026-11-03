export type AssistantTheme = {
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  border: string;
  primary: string;
  primaryContrast: string;
};

export type AssistantBackgroundId =
  | "solid"
  | "neural-ocean"
  | "aurora-mesh"
  | "cloud-stream"
  | "sand-circuit"
  | "graphite-topology";

export type MountOptions = {
  apiBasePath: string;
  assistantAvatarUrl?: string;
  assistantName?: string;
  systemName?: string;
  userAvatarUrl?: string;
  userName?: string;
  mode: "panel" | "page";
  visible: boolean;
  voiceInput?: boolean;
  voiceOutput?: boolean;
  locale: string;
  theme: AssistantTheme;
  initialThreadId?: string;
  backgroundId?: AssistantBackgroundId;
  onBackgroundChange?: (
    backgroundId: AssistantBackgroundId,
  ) => void | Promise<void>;
  onNavigate: (href: string) => void;
  onPageAction: (action: string, payload?: { command?: string; name?: string; wait?: boolean; revision?: string }) => Promise<unknown>;
  onThreadChange: (threadId: string | undefined) => void;
  onUsageChanged?: () => void;
  onClose: () => void;
  onVoiceWake?: () => void;
  onVoiceDismiss?: () => void;
  onMaximize: () => void;
  onMinimize: () => void;
};
