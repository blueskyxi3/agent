export interface VoiceSettings {
  enabled: boolean; wake_words: string[]; wake_threshold: number; wake_score: number;
  wake_chunk_ms: number; wake_cooldown_ms: number; pause_ms: number; dismiss_phrases: string[];
  wake_reply: string; dismiss_reply: string; idle_seconds: number;
}
export type VoiceEvent = { type: string; audio?: ArrayBuffer; code?: string };
export interface VoiceEngine { start(): Promise<void>; mode(mode: "standby" | "listen" | "paused"): void; dispose(): Promise<void> }
export interface VoiceModule {
  createVoiceController(options: { assetBase: string; settings: VoiceSettings; onEvent(event: VoiceEvent): void }): VoiceEngine;
  isDismiss(text: string, phrases: string[]): boolean;
}
export interface VoiceScene { text: string; revision: number; blocked: boolean; scope: number; attachments: boolean }
export type ConversationPhase = "off" | "loading" | "requesting" | "standby" | "listening" | "transcribing" | "replying" | "feedback";
export interface ConversationState { phase: ConversationPhase; pending: string; error: string; notice: string }
interface Dependencies {
  scene(): VoiceScene;
  transcribe(audio: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<string>;
  submit(text: string): void;
  wake(): void; dismiss(): void;
  speak(text: string, signal: AbortSignal): Promise<void>;
}

// One generation owns one microphone, one transcription, and at most one submission.
export class VoiceConversation {
  private state: ConversationState = { phase: "off", pending: "", error: "", notice: "" };
  private listeners = new Set<() => void>();
  private engine: VoiceEngine | undefined;
  private module?: VoiceModule;
  private settings?: VoiceSettings;
  private generation = 0;
  private awake = false;
  private abort: AbortController | undefined;
  private idle?: ReturnType<typeof setTimeout>;
  private resume?: ReturnType<typeof setTimeout>;
  private span: VoiceScene | undefined;
  private retryAudio: Uint8Array<ArrayBuffer> | undefined;
  constructor(private readonly dependencies: Dependencies) {}
  getSnapshot = (): ConversationState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(phase: ConversationPhase, extra: Partial<ConversationState> = {}): void {
    this.state = { phase, pending: "", error: "", notice: "", ...extra }; for (const listener of this.listeners) listener();
  }
  stop = (): void => {
    this.generation++; this.awake = false; this.abort?.abort(); this.abort = undefined; clearTimeout(this.idle); clearTimeout(this.resume);
    const engine = this.engine; this.engine = undefined; this.span = undefined; this.retryAudio = undefined;
    if (engine) void engine.dispose().catch(() => {});
    this.publish("off");
  };
  async start(module: VoiceModule, assetBase: string, settings: VoiceSettings): Promise<void> {
    this.stop(); this.module = module; this.settings = settings;
    const generation = this.generation;
    this.publish("loading");
    this.engine = module.createVoiceController({ assetBase, settings, onEvent: event => {
      if (generation !== this.generation) return;
      if (event.type === "loading" || event.type === "requesting" || event.type === "standby") {
        this.publish(event.type);
        if (event.type === "standby") this.busyChanged();
      }
      else if (event.type === "wake") void this.awaken();
      else if (event.type === "speech") { this.span ??= this.dependencies.scene(); this.resetIdle(); }
      else if (event.type === "utterance" && event.audio) void this.recognize(new Uint8Array(event.audio));
      else if (event.type === "error") { this.stop(); this.publish("feedback", { error: event.code || "engine" }); }
    } });
    try { await this.engine.start(); } catch { if (generation === this.generation) { this.stop(); this.publish("feedback", { error: "engine" }); } }
  }
  private resetIdle(): void {
    clearTimeout(this.idle);
    if (this.settings && this.state.phase === "listening") this.idle = setTimeout(() => this.standby(false), this.settings.idle_seconds * 1000);
  }
  touch = (): void => { this.resetIdle(); };
  private async feedback(text: string): Promise<void> {
    this.abort?.abort(); this.abort = new AbortController();
    try { await this.dependencies.speak(text, this.abort.signal); } catch { /* Spoken feedback is optional; the visible notice remains. */ }
  }
  private async awaken(): Promise<void> {
    if (!this.engine) return;
    if (this.dependencies.scene().blocked) { this.engine.mode("paused"); return; }
    const generation = this.generation;
    this.awake = true; this.span = undefined; this.engine.mode("paused"); this.dependencies.wake();
    this.publish("listening", { notice: this.settings!.wake_reply });
    await this.feedback(this.settings!.wake_reply);
    if (generation === this.generation && this.engine && !this.dependencies.scene().blocked) { this.engine.mode("listen"); this.resetIdle(); }
  }
  private standby(spoken: boolean): void {
    if (!this.engine) return;
    clearTimeout(this.idle); this.awake = false; this.span = undefined; this.retryAudio = undefined;
    this.dependencies.dismiss(); this.engine.mode("paused"); this.publish("standby", { notice: spoken ? this.settings!.dismiss_reply : "" });
    const generation = this.generation;
    void this.feedback(spoken ? this.settings!.dismiss_reply : "").finally(() => {
      if (generation === this.generation && !this.dependencies.scene().blocked) this.engine?.mode("standby");
    });
  }
  async recognize(audio: Uint8Array<ArrayBuffer>): Promise<void> {
    if (!this.engine || !["listening", "feedback"].includes(this.state.phase)) return;
    this.engine.mode("paused"); clearTimeout(this.idle); clearTimeout(this.resume);
    const span = this.span || this.dependencies.scene(); this.span = undefined;
    const generation = this.generation; this.abort?.abort(); const abort = new AbortController(); this.abort = abort;
    this.retryAudio = audio; this.publish("transcribing");
    const timeout = setTimeout(() => abort.abort(), 150000);
    try {
      const text = (await this.dependencies.transcribe(audio, abort.signal)).trim();
      if (generation !== this.generation || abort.signal.aborted) return;
      this.retryAudio = undefined;
      if (!text) { this.listen(); return; }
      if (this.module!.isDismiss(text, this.settings!.dismiss_phrases)) { this.standby(true); return; }
      const scene = this.dependencies.scene();
      if (span.text || scene.text || span.revision !== scene.revision || span.scope !== scene.scope || span.attachments || scene.attachments || scene.blocked) {
        this.publish("feedback", { pending: text, error: "conflict" }); return;
      }
      this.publish("replying"); this.dependencies.submit(text);
    } catch {
      if (generation === this.generation && !abort.signal.aborted) this.publish("feedback", { error: "failed" });
      else if (generation === this.generation) this.publish("feedback", { error: "failed" });
    } finally { clearTimeout(timeout); }
  }
  listen = (): void => {
    if (!this.engine || this.dependencies.scene().blocked) return;
    this.span = undefined; this.retryAudio = undefined; this.engine.mode("listen"); this.publish("listening"); this.resetIdle();
  };
  busyChanged(): void {
    clearTimeout(this.resume);
    if (!this.engine) return;
    if (this.dependencies.scene().blocked) {
      clearTimeout(this.idle); this.engine.mode("paused");
      if (this.state.phase !== "feedback" && this.state.phase !== "transcribing") this.publish("replying");
    } else if (this.state.phase === "replying") {
      this.resume = setTimeout(() => {
        if (this.dependencies.scene().blocked || !this.engine) return;
        if (this.awake) this.listen();
        else { this.engine.mode("standby"); this.publish("standby"); }
      }, 200);
    }
  }
  retry = (): void => { if (this.retryAudio) { this.span = this.dependencies.scene(); void this.recognize(this.retryAudio); } };
  async dispose(): Promise<void> { this.stop(); this.listeners.clear(); }
}
