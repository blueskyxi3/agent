import { useEffect, useRef, useState } from "react";
import type { useLocalRuntime } from "@assistant-ui/react";
import { voiceCopy } from "./voice-locales";

/** Speech playback owns its request independently of microphone capture. */
export function VoiceControls({ runtime, output, visible, locale, onBusyChange }: {
  runtime: ReturnType<typeof useLocalRuntime>; output: boolean; visible: boolean; locale: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const request = useRef<AbortController>();
  const audio = useRef<HTMLAudioElement>(null);
  const lastMessage = useRef<string>();
  const [error, setError] = useState("");
  const [audioURL, setAudioURL] = useState("");
  const copy = voiceCopy(locale);
  const notifyBusy = useRef(onBusyChange);
  notifyBusy.current = onBusyChange;
  useEffect(() => {
    if (!audioURL || !audio.current) return;
    void audio.current.play().catch(() => notifyBusy.current?.(false));
  }, [audioURL]);
  useEffect(() => () => { if (audioURL) URL.revokeObjectURL(audioURL); }, [audioURL]);
  useEffect(() => {
    if (!visible || !output) {
      request.current?.abort(); audio.current?.pause(); setAudioURL(""); setError("");
      notifyBusy.current?.(false);
    }
    return () => { request.current?.abort(); audio.current?.pause(); notifyBusy.current?.(false); };
  }, [visible, output]);
  useEffect(() => {
    lastMessage.current = runtime.thread.getState().messages.at(-1)?.id;
    if (!output || !visible) return;
    return runtime.thread.subscribe(() => {
      const state = runtime.thread.getState();
      const message = state.messages.at(-1);
      if (state.isRunning || !message || message.role !== "assistant" || message.id === lastMessage.current) return;
      lastMessage.current = message.id;
      const text = message.content.filter(part => part.type === "text").map(part => part.type === "text" ? part.text : "").join("\n");
      if (!text) return;
      request.current?.abort();
      notifyBusy.current?.(true);
      const controller = new AbortController(); request.current = controller;
      void fetch("/api/user/self/assistant/audio/speech", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: text, voice: "alloy", response_format: "mp3" }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
      }).then(async response => {
        if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/")) throw new Error(copy.speechFailed);
        const blob = await response.blob();
        if (!controller.signal.aborted) { setAudioURL(URL.createObjectURL(blob)); setError(""); }
      }).catch(err => { if (!controller.signal.aborted) { setError(String(err)); notifyBusy.current?.(false); } });
    });
  }, [runtime, output, visible, copy]);
  return <div className="aih-voice-output">{output && audioURL && <audio ref={audio} src={audioURL} controls autoPlay
    onPlay={() => notifyBusy.current?.(true)} onPause={() => notifyBusy.current?.(false)}
    onEnded={() => notifyBusy.current?.(false)} onError={() => notifyBusy.current?.(false)} />}{error && <p role="alert">{error}</p>}</div>;
}
