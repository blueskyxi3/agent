import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type RefObject } from "react";
import type { useLocalRuntime } from "@assistant-ui/react";
import { Microphone, Stop, X, CircleNotch } from "@phosphor-icons/react";
import { DraftGuard, VoiceSession } from "./voice-session";
import { voiceCopy } from "./voice-locales";

export function VoiceInput({ runtime, enabled, visible, scope, locked, locale, inputRef, onActiveChange }: {
  runtime: ReturnType<typeof useLocalRuntime>; enabled: boolean; visible: boolean; scope: number;
  locked: boolean; locale: string; inputRef: RefObject<HTMLTextAreaElement>;
  onActiveChange?: (active: boolean) => void;
}) {
  const copy = voiceCopy(locale);
  const [running, setRunning] = useState(false);
  const draft = useMemo(() => new DraftGuard(runtime.thread.composer, () => {
    const node = inputRef.current;
    const end = runtime.thread.composer.getState().text.length;
    return { start: node?.selectionStart ?? end, end: node?.selectionEnd ?? end };
  }, (at, text) => requestAnimationFrame(() => {
    const node = inputRef.current;
    if (node?.value === text) { node.focus(); node.setSelectionRange(at, at); }
  })), [runtime, inputRef]);
  const session = useMemo(() => new VoiceSession(draft), [draft]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => { onActiveChange?.(state.phase !== "idle"); }, [state.phase, onActiveChange]);
  useLayoutEffect(() => {
    session.cancel(); draft.invalidate();
    return () => { session.cancel(); draft.invalidate(); };
  }, [session, draft, scope, visible, enabled, locked]);
  useEffect(() => {
    const changed = () => {
      const active = runtime.thread.getState().isRunning;
      setRunning(active);
      if (active) session.cancel();
    };
    changed();
    const unthread = runtime.thread.subscribe(changed);
    const uncomposer = runtime.thread.composer.subscribe(draft.changed);
    const hidden = () => { if (document.hidden) session.cancel(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && session.getSnapshot().phase !== "idle") {
        event.preventDefault(); event.stopPropagation(); session.cancel();
      }
    };
    document.addEventListener("visibilitychange", hidden); document.addEventListener("keydown", escape, true);
    return () => {
      unthread(); uncomposer();
      document.removeEventListener("visibilitychange", hidden); document.removeEventListener("keydown", escape, true);
      void session.dispose();
    };
  }, [session, draft, runtime]);
  if (!enabled) return null;
  const capturing = state.phase === "recording";
  const busy = ["requesting", "converting", "transcribing"].includes(state.phase);
  const message = state.failure ? copy[state.failure as keyof typeof copy] || copy.failed
    : state.phase !== "idle" && state.phase !== "feedback" ? copy[state.phase] : "";
  return <div className="aih-voice-input">
    <button type="button" className={`aih-icon-button${capturing ? " is-recording" : ""}`}
      title={capturing ? copy.stop : copy.start} aria-label={capturing ? copy.stop : copy.start}
      disabled={busy || locked || running || !visible}
      onMouseDown={event => event.preventDefault()}
      onClick={() => { if (capturing) void session.stop(); else void session.start(); }}>
      {busy ? <CircleNotch className="aih-voice-spinner" /> : capturing ? <Stop weight="fill" /> : <Microphone />}
    </button>
    {state.phase !== "idle" && <div className="aih-voice-activity" role="status" aria-live="polite">
      <div className="aih-voice-status">
        <span>{message}{capturing ? ` ${Math.floor(state.seconds / 60)}:${String(Math.floor(state.seconds % 60)).padStart(2, "0")} / 2:00` : ""}</span>
        {capturing && <meter min={0} max={0.2} value={state.amplitude} aria-label={copy.level} />}
        <button type="button" className="aih-icon-button" aria-label={state.pending ? copy.discard : copy.cancel}
          title={copy.cancel} onClick={session.cancel}><X /></button>
      </div>
      {state.detail && <p className="aih-voice-detail">{state.detail}</p>}
      {state.pending && <><p className="aih-voice-transcript">{state.pending}</p><button type="button" className="aih-button"
        onMouseDown={event => event.preventDefault()} onClick={session.insertPending}>{copy.insert}</button></>}
    </div>}
  </div>;
}
