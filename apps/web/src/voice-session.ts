import { BrowserRecording, RecordingError, voiceLimits, type VoiceRecording } from "./voice-recording";

interface Composer {
  getState(): { text: string };
  setText(text: string): void;
  subscribe(listener: () => void): () => void;
}
export interface DraftSpan { revision: number; text: string; start: number; end: number }

/** Track actual text revisions, including edit-and-undo while recognition is pending. */
export class DraftGuard {
  private revision = 0;
  private text: string;
  constructor(private readonly composer: Composer, private readonly selection: () => { start: number; end: number },
    private readonly focus: (at: number, text: string) => void) { this.text = composer.getState().text; }

  changed = (): void => {
    const text = this.composer.getState().text;
    if (text !== this.text) { this.revision++; this.text = text; }
  };
  invalidate(): void { this.revision++; }
  capture(): DraftSpan {
    this.changed();
    const { start, end } = this.selection();
    return { revision: this.revision, text: this.text, start: Math.min(start, this.text.length), end: Math.min(end, this.text.length) };
  }
  insert(text: string, span: DraftSpan = this.capture()): boolean {
    this.changed();
    if (span.revision !== this.revision || span.text !== this.text) return false;
    const next = this.text.slice(0, span.start) + text + this.text.slice(span.end);
    this.composer.setText(next); this.changed();
    this.focus(span.start + text.length, next);
    return true;
  }
}

export type VoicePhase = "idle" | "requesting" | "recording" | "converting" | "transcribing" | "feedback";
export interface VoiceState { phase: VoicePhase; seconds: number; amplitude: number; failure?: string; detail?: string | undefined; pending: string }
const idle = (): VoiceState => ({ phase: "idle", seconds: 0, amplitude: 0, pending: "" });

export async function transcribeRecording(audio: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/wav" }), "recording.wav");
  form.append("response_format", "json");
  const response = await fetch("/api/user/self/assistant/audio/transcriptions", {
    method: "POST", credentials: "include", body: form, signal,
  });
  const result = await response.json() as { text?: unknown; message?: string; error?: { message?: string } };
  if (!response.ok || typeof result.text !== "string") throw new Error(result.message || result.error?.message || `HTTP ${response.status}`);
  return result.text;
}

/** Own capture and upload as one cancellable operation, independently of TTS. */
export class VoiceSession {
  private state = idle();
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private active?: { capture: VoiceRecording; abort: AbortController; span: DraftSpan; generation: number } | undefined;
  private timer?: ReturnType<typeof setInterval>;
  private readonly releasing = new Set<Promise<void>>();

  constructor(private readonly draft: DraftGuard,
    private readonly createRecording: () => VoiceRecording = () => new BrowserRecording(),
    private readonly transcribe: (audio: Uint8Array<ArrayBuffer>, signal: AbortSignal) => Promise<string> = transcribeRecording) {}

  getSnapshot = (): VoiceState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(state: VoiceState): void { this.state = state; for (const listener of this.listeners) listener(); }
  private release(capture: VoiceRecording): void {
    const promise = capture.dispose().catch(error => console.warn("Microphone cleanup failed", error));
    this.releasing.add(promise); void promise.finally(() => this.releasing.delete(promise));
  }
  cancel = (): void => {
    this.generation++; clearInterval(this.timer);
    const active = this.active; this.active = undefined;
    if (active) { active.abort.abort(); this.release(active.capture); }
    this.publish(idle());
  };
  private failed(error: unknown): void {
    this.publish({ ...idle(), phase: "feedback", failure: error instanceof RecordingError ? error.kind : "failed",
      detail: error instanceof RecordingError ? undefined : error instanceof Error ? error.message : undefined });
  }

  async start(): Promise<void> {
    if (this.active) return;
    const active = { capture: this.createRecording(), abort: new AbortController(), span: this.draft.capture(), generation: ++this.generation };
    this.active = active; this.publish({ ...idle(), phase: "requesting" });
    try {
      await active.capture.start(error => {
        if (this.active !== active) return;
        this.cancel(); this.failed(error);
      });
      if (this.active !== active) return;
      const started = Date.now();
      this.publish({ ...idle(), phase: "recording" });
      this.timer = setInterval(() => {
        if (this.active !== active) return;
        const seconds = Math.min(voiceLimits.maxSeconds, (Date.now() - started) / 1000);
        this.publish({ ...this.state, seconds, amplitude: active.capture.amplitude() });
        if (seconds >= voiceLimits.maxSeconds) void this.stop();
      }, 100);
    } catch (error) {
      this.release(active.capture);
      if (this.active === active) { this.active = undefined; this.failed(error); }
    }
  }

  async stop(): Promise<void> {
    const active = this.active;
    if (!active || this.state.phase !== "recording") return;
    clearInterval(this.timer); this.publish({ ...this.state, phase: "converting" });
    const timeout = setTimeout(() => active.abort.abort(new Error("Transcription timed out")), 150_000);
    try {
      const audio = await active.capture.stop();
      if (this.active !== active) return;
      active.abort.signal.throwIfAborted();
      this.publish({ ...this.state, phase: "transcribing" });
      const text = await this.transcribe(audio, active.abort.signal);
      if (this.active !== active || active.generation !== this.generation) return;
      active.abort.signal.throwIfAborted();
      if (!text.trim()) { this.failed(new RecordingError("empty")); return; }
      if (this.draft.insert(text, active.span)) this.publish(idle());
      else this.publish({ ...idle(), phase: "feedback", pending: text, failure: "conflict" });
    } catch (error) {
      if (this.active === active) this.failed(error);
    } finally {
      clearTimeout(timeout); this.release(active.capture);
      if (this.active === active) this.active = undefined;
    }
  }

  insertPending = (): void => {
    if (this.state.pending && this.draft.insert(this.state.pending)) this.publish(idle());
  };
  async dispose(): Promise<void> { this.cancel(); this.listeners.clear(); await Promise.all(this.releasing); }
}
