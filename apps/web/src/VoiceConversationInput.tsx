import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { useLocalRuntime } from "@assistant-ui/react";
import { MicrophoneStage, X } from "@phosphor-icons/react";
import { VoiceConversation, type VoiceModule, type VoiceSettings } from "./voice-conversation";
import { transcribeRecording } from "./voice-session";
import { conversationCopy } from "./voice-conversation-copy";

interface Configuration { settings: VoiceSettings; revision: string; available: boolean; asset_base?: string; version?: string }
export function VoiceConversationInput({ runtime, enabled, output, manualBusy, playbackBusy, locked, attachments, scope, locale, onWake, onDismiss, onArmed }: {
  runtime: ReturnType<typeof useLocalRuntime>; enabled: boolean; output: boolean; manualBusy: boolean; playbackBusy: boolean; locked: boolean;
  attachments: boolean; scope: number; locale: string; onWake(): void; onDismiss(): void; onArmed(active: boolean): void;
}) {
  const copy = conversationCopy(locale);
  const [configuration, setConfiguration] = useState<Configuration>();
  const [loadError, setLoadError] = useState(false);
  const [importing, setImporting] = useState(false);
  const startEpoch = useRef(0);
  const configurationRef = useRef(configuration);
  configurationRef.current = configuration;
  const revision = useRef(0); const text = useRef(runtime.thread.composer.getState().text);
  const current = useRef({ playbackBusy, locked, attachments, scope, output, onWake, onDismiss });
  current.current = { playbackBusy, locked, attachments, scope, output, onWake, onDismiss };
  const controller = useMemo(() => new VoiceConversation({
    scene: () => ({ text: runtime.thread.composer.getState().text, revision: revision.current, scope: current.current.scope,
      attachments: current.current.attachments, blocked: current.current.locked || current.current.playbackBusy || runtime.thread.getState().isRunning }),
    transcribe: transcribeRecording,
    submit: (value) => { runtime.thread.composer.setText(value); runtime.thread.composer.send(); },
    wake: () => current.current.onWake(), dismiss: () => current.current.onDismiss(),
    speak: async (value, signal) => {
      if (!current.current.output || !value.trim()) return;
      const response = await fetch("/api/user/self/assistant/audio/speech", { method: "POST", credentials: "include",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ input: value, voice: "alloy", response_format: "mp3" }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
      if (!response.ok) return;
      const url = URL.createObjectURL(await response.blob()); const audio = new Audio(url);
      try { await new Promise<void>((resolve, reject) => {
        const done = () => { cleanup(); resolve(); };
        const aborted = () => { cleanup(); reject(new Error("cancelled")); };
        const timeout = setTimeout(done, 10000);
        const cleanup = () => { clearTimeout(timeout); audio.pause(); signal.removeEventListener("abort", aborted); audio.onended = null; audio.onerror = null; };
        signal.addEventListener("abort", aborted, { once: true }); audio.onended = done; audio.onerror = done;
        if (signal.aborted) aborted(); else void audio.play().catch(done);
      }); } finally { audio.pause(); URL.revokeObjectURL(url); }
    },
  }), [runtime]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const active = importing || state.phase !== "off" && !(state.phase === "feedback" && !state.pending && state.error !== "failed" && state.error !== "conflict");
  const stop = () => { startEpoch.current++; setImporting(false); controller.stop(); };
  useEffect(() => { onArmed(active); return () => onArmed(false); }, [active, onArmed]);
  useLayoutEffect(() => { startEpoch.current++; setImporting(false); controller.stop(); }, [controller, scope, enabled, configuration?.revision, configuration?.available]);
  useLayoutEffect(() => { if (locked) controller.stop(); controller.busyChanged(); }, [controller, locked, playbackBusy]);
  useEffect(() => {
    const uncomposer = runtime.thread.composer.subscribe(() => {
      const next = runtime.thread.composer.getState().text;
      if (next !== text.current) { revision.current++; text.current = next; controller.touch(); }
    });
    const unthread = runtime.thread.subscribe(() => controller.busyChanged());
    const stopCapture = () => { startEpoch.current++; setImporting(false); controller.stop(); };
    const hidden = () => { if (document.hidden) stopCapture(); };
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", stopCapture);
    return () => { startEpoch.current++; uncomposer(); unthread(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", stopCapture); void controller.dispose(); };
  }, [controller, runtime]);
  useEffect(() => {
    if (!enabled) { setConfiguration(undefined); return; }
    const abort = new AbortController(); let busy = false;
    const refresh = async () => {
      if (busy) return; busy = true;
      try {
        const response = await fetch("/api/user/self/assistant/voice-control", { credentials: "include", signal: abort.signal });
        const body = await response.json() as { success: boolean; data: Configuration };
        if (!response.ok || !body.success || typeof body.data?.settings?.enabled !== "boolean" ||
          typeof body.data.available !== "boolean" || typeof body.data.revision !== "string") throw new Error("unavailable");
        if (abort.signal.aborted) return;
        setLoadError(false);
        setConfiguration(body.data);
      } catch { if (!abort.signal.aborted) { controller.stop(); setLoadError(true); } }
      finally { busy = false; }
    };
    void refresh(); const timer = setInterval(() => { void refresh(); }, 15000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [enabled, controller]);
  const start = async () => {
    if (importing || manualBusy || !configuration?.available || !configuration.asset_base || document.hidden) return;
    const epoch = ++startEpoch.current; setImporting(true);
    try {
      const url = `${configuration.asset_base}/plugin.js?version=${encodeURIComponent(configuration.version || "")}`;
      const module = await import(/* @vite-ignore */ url) as VoiceModule;
      if (epoch !== startEpoch.current || !configurationRef.current?.available || document.hidden) return;
      await controller.start(module, configuration.asset_base, configuration.settings);
    } catch { if (epoch === startEpoch.current) setLoadError(true); }
    finally { if (epoch === startEpoch.current) setImporting(false); }
  };
  if (!enabled || !configuration?.settings?.enabled) return null;
  return <div className="aih-voice-input aih-voice-conversation">
    <button type="button" className={`aih-icon-button${active ? " is-recording" : ""}`} title={active ? copy.stop : copy.start}
      aria-label={active ? copy.stop : copy.start} disabled={!active && (manualBusy || locked || !configuration.available || loadError)}
      onClick={() => { if (active) stop(); else void start(); }}><MicrophoneStage /></button>
    {(state.phase !== "off" || !configuration.available || loadError) && <div className="aih-voice-activity" role="status" aria-live="polite">
      <div className="aih-voice-status"><span>{importing ? copy.loading : !configuration.available ? copy.unavailable : loadError ? copy.engine : state.error ?
        copy[state.error as keyof typeof copy] || copy.engine : copy[state.phase as keyof typeof copy]}</span>
        <button type="button" className="aih-icon-button" aria-label={copy.stop} onClick={stop}><X /></button></div>
      {state.notice && <p>{state.notice}</p>}
      {state.pending && <><p className="aih-voice-transcript">{state.pending}</p><button type="button" className="aih-button" onClick={() => {
        const composer = runtime.thread.composer; const previous = composer.getState().text;
        composer.setText(previous ? `${previous}\n${state.pending}` : state.pending); controller.stop();
      }}>{copy.insert}</button></>}
      {state.phase === "feedback" && <>
        {state.error === "failed" && <button type="button" className="aih-button" onClick={controller.retry}>{copy.retry}</button>}
        <button type="button" className="aih-button" onClick={controller.listen}>{state.pending ? copy.discard : copy.resume}</button>
      </>}
    </div>}
  </div>;
}
