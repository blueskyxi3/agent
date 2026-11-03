import assert from "node:assert/strict";
import { test } from "node:test";
import { DraftGuard, VoiceSession, transcribeRecording } from "./voice-session";
import { RecordingError, encodeWave, type VoiceRecording } from "./voice-recording";

function fixture(text = "prefix suffix") {
  const listeners = new Set<() => void>();
  const composer = {
    getState: () => ({ text }),
    setText: (next: string) => { text = next; for (const listener of listeners) listener(); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const draft = new DraftGuard(composer, () => ({ start: 7, end: 7 }), () => {});
  composer.subscribe(draft.changed);
  let disposed = 0;
  const capture: VoiceRecording = {
    start: async () => {}, stop: async () => encodeWave(new Float32Array(16000)),
    amplitude: () => 0.1, dispose: async () => { disposed++; },
  };
  return { composer, draft, capture, disposed: () => disposed };
}

test("transcripts insert at the original cursor without sending or replacing the draft", async () => {
  const f = fixture(); const session = new VoiceSession(f.draft, () => f.capture, async () => "voice ");
  await session.start(); await session.stop();
  assert.equal(f.composer.getState().text, "prefix voice suffix");
  assert.equal(session.getSnapshot().phase, "idle");
  await session.dispose();
});

test("edit and undo invalidate automatic insertion; explicit insertion uses the current draft", async () => {
  const f = fixture(); let resolve!: (value: string) => void;
  const session = new VoiceSession(f.draft, () => f.capture, () => new Promise(done => resolve = done));
  await session.start(); const pending = session.stop(); await Promise.resolve();
  f.composer.setText("edited"); f.composer.setText("prefix suffix");
  resolve("voice "); await pending;
  assert.equal(f.composer.getState().text, "prefix suffix");
  assert.equal(session.getSnapshot().pending, "voice ");
  session.insertPending();
  assert.equal(f.composer.getState().text, "prefix voice suffix");
  await session.dispose();
});

test("cancel or session invalidation discards late responses and releases capture", async () => {
  const f = fixture(); let resolve!: (value: string) => void; let signal!: AbortSignal;
  const session = new VoiceSession(f.draft, () => f.capture, (_audio, abort) => { signal = abort; return new Promise(done => resolve = done); });
  await session.start(); const pending = session.stop(); await Promise.resolve();
  session.cancel(); f.draft.invalidate();
  assert.equal(signal.aborted, true);
  resolve("late"); await pending;
  assert.equal(f.composer.getState().text, "prefix suffix");
  assert.equal(session.getSnapshot().pending, "");
  assert.ok(f.disposed() > 0); await session.dispose();
});

test("permission requests cannot be duplicated and a cancelled late grant never records", async () => {
  const f = fixture(); let grant!: () => void; let starts = 0;
  f.capture.start = () => { starts++; return new Promise(resolve => grant = resolve); };
  const session = new VoiceSession(f.draft, () => f.capture, async () => "unused");
  const pending = session.start(); await session.start();
  assert.equal(starts, 1); session.cancel(); grant(); await pending;
  assert.equal(session.getSnapshot().phase, "idle");
  assert.ok(f.disposed() > 0); await session.dispose();
});

test("recording automatically stops at the advertised duration and distinguishes empty speech", async t => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
  const f = fixture(); let stops = 0;
  f.capture.stop = async () => { stops++; return encodeWave(new Float32Array(1)); };
  const session = new VoiceSession(f.draft, () => f.capture, async () => "");
  await session.start(); t.mock.timers.tick(120_100);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(stops, 1); assert.equal(session.getSnapshot().failure, "empty");
  await session.dispose();
});

test("capture failures stop the session; uploads target only the existing host transcription API", async t => {
  const f = fixture(); f.capture.start = async () => { throw new RecordingError("permission"); };
  const session = new VoiceSession(f.draft, () => f.capture);
  await session.start(); assert.equal(session.getSnapshot().failure, "permission");
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "/api/user/self/assistant/audio/transcriptions");
    assert.equal(options.credentials, "include");
    const form = options.body as FormData;
    assert.equal(form.get("response_format"), "json");
    assert.equal(form.has("model"), false, "the host chooses the saved model");
    assert.equal((form.get("file") as File).type, "audio/wav");
    return Response.json({ text: "recognized" });
  });
  assert.equal(await transcribeRecording(encodeWave(new Float32Array(1)), new AbortController().signal), "recognized");
  await session.dispose();
});
