import { test } from "node:test";
import assert from "node:assert/strict";
import { VoiceConversation, type VoiceEvent, type VoiceScene, type VoiceSettings, type VoiceModule } from "./voice-conversation";

const settings: VoiceSettings = { enabled: true, wake_words: ["小踢小踢"], wake_threshold: 0.25, wake_score: 1, wake_chunk_ms: 160,
  wake_cooldown_ms: 1500, pause_ms: 1200, dismiss_phrases: ["退下吧"], wake_reply: "我在呢", dismiss_reply: "好的，再见", idle_seconds: 30 };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function setup(t: { after(fn: () => void): void }, transcribe: (signal: AbortSignal) => Promise<string> = async () => "今天天气") {
  let event!: (event: VoiceEvent) => void; let disposed = 0, wake = 0, dismiss = 0;
  const scene: VoiceScene = { text: "", revision: 0, blocked: false, attachments: false, scope: 0 };
  const sent: string[] = [], modes: string[] = [];
  const module: VoiceModule = {
    createVoiceController(options) { event = options.onEvent; return { start: async () => event({ type: "standby" }), mode: mode => modes.push(mode), dispose: async () => { disposed++; } }; },
    isDismiss: text => text === "退下吧",
  };
  const controller = new VoiceConversation({ scene: () => ({ ...scene }), transcribe: (_audio, signal) => transcribe(signal),
    submit: text => sent.push(text), wake: () => { wake++; }, dismiss: () => { dismiss++; }, speak: async () => {} });
  t.after(() => controller.stop()); await controller.start(module, "/assets", settings);
  const awaken = async () => { event({ type: "wake" }); await tick(); };
  return { controller, scene, sent, modes, event: (next: VoiceEvent) => event(next), awaken,
    counts: () => ({ wake, dismiss, disposed }) };
}
test("one completed utterance automatically sends once, then pauses until reply finishes", async t => {
  const f = await setup(t); await f.awaken(); f.event({ type: "speech" });
  f.event({ type: "utterance", audio: new ArrayBuffer(48) }); f.event({ type: "utterance", audio: new ArrayBuffer(48) }); await tick();
  assert.deepEqual(f.sent, ["今天天气"]); assert.equal(f.controller.getSnapshot().phase, "replying");
  f.scene.blocked = true; f.controller.busyChanged(); f.scene.blocked = false; f.controller.busyChanged();
  await new Promise(resolve => setTimeout(resolve, 230)); assert.equal(f.controller.getSnapshot().phase, "listening");
});
test("dismissal bypasses chat and preserves existing draft", async t => {
  const f = await setup(t, async () => "退下吧"); await f.awaken(); f.scene.text = "manual draft";
  f.event({ type: "utterance", audio: new ArrayBuffer(48) }); await tick();
  assert.deepEqual(f.sent, []); assert.equal(f.scene.text, "manual draft");
  assert.equal(f.controller.getSnapshot().phase, "standby"); assert.equal(f.counts().dismiss, 1);
});
test("edit-and-undo and attachments prevent auto-send and retain the transcript", async t => {
  let resolve!: (text: string) => void;
  const f = await setup(t, async () => new Promise<string>(done => { resolve = done; })); await f.awaken();
  f.event({ type: "speech" }); f.event({ type: "utterance", audio: new ArrayBuffer(48) });
  f.scene.revision += 2; resolve("保留这句话"); await tick();
  assert.deepEqual(f.sent, []); assert.equal(f.controller.getSnapshot().pending, "保留这句话");
  f.controller.listen(); f.scene.attachments = true; f.event({ type: "utterance", audio: new ArrayBuffer(48) }); resolve("with attachment"); await tick();
  assert.deepEqual(f.sent, []); assert.equal(f.controller.getSnapshot().error, "conflict");
});
test("cancel aborts upload and discards late recognition without chat", async t => {
  let resolve!: (text: string) => void; let signal!: AbortSignal;
  const f = await setup(t, async value => { signal = value; return new Promise<string>(done => { resolve = done; }); });
  await f.awaken(); f.event({ type: "utterance", audio: new ArrayBuffer(48) }); f.controller.stop();
  assert.equal(signal.aborted, true); resolve("late"); await tick();
  assert.deepEqual(f.sent, []); assert.equal(f.controller.getSnapshot().phase, "off"); assert.equal(f.counts().disposed, 1);
});
test("recognition failure retries only on explicit request; empty audio never sends", async t => {
  let calls = 0;
  const f = await setup(t, async () => { calls++; if (calls === 1) throw new Error("offline"); return ""; });
  await f.awaken(); f.event({ type: "utterance", audio: new ArrayBuffer(48) }); await tick();
  assert.equal(calls, 1); assert.equal(f.controller.getSnapshot().error, "failed");
  f.controller.retry(); await tick(); assert.equal(calls, 2); assert.deepEqual(f.sent, []);
  assert.equal(f.controller.getSnapshot().phase, "listening");
});
test("a manually started chat does not turn standby into dictation", async t => {
  const f = await setup(t); f.scene.blocked = true; f.controller.busyChanged();
  f.scene.blocked = false; f.controller.busyChanged(); await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(f.controller.getSnapshot().phase, "standby");
});
