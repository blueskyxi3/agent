import assert from "node:assert/strict";
import { test } from "node:test";
import { BrowserRecording, encodeWave, RecordingError } from "./voice-recording";

test("WAV encoding clips samples and emits exact 16 kHz mono PCM16 headers", () => {
  const audio = encodeWave(new Float32Array([-2, 0, 2]));
  const view = new DataView(audio.buffer);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(40, true), 6);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(48, true), 32767);
});

test("a late browser permission grant is released immediately after cancellation", async t => {
  let grant!: (value: object) => void; let stopped = 0;
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: {
    getUserMedia: () => new Promise(resolve => grant = resolve),
  } } });
  t.after(() => { if (original) Object.defineProperty(globalThis, "navigator", original); else Reflect.deleteProperty(globalThis, "navigator"); });
  for (const name of ["MediaRecorder", "AudioContext"]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value: class {} });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }
  const recording = new BrowserRecording();
  const started = recording.start(() => {});
  const rejected = assert.rejects(started, (error: unknown) => error instanceof RecordingError && error.kind === "cancelled");
  await recording.dispose();
  grant({ getTracks: () => [{ stop: () => stopped++ }] });
  await rejected; assert.equal(stopped, 1);
});

test("stop waits for the final recorder chunk, resamples, and releases tracks and AudioContext once", async t => {
  let stops = 0, closes = 0, decodedSize = 0, instances = 0;
  class Track extends EventTarget { stop() { stops++; } }
  const track = new Track();
  class Recorder extends EventTarget {
    static isTypeSupported(type: string) { return type === "audio/mp4"; }
    state = "inactive"; mimeType = "audio/mp4";
    ondataavailable?: (event: { data: Blob }) => void;
    onerror?: () => void;
    constructor(_stream: object, options: { mimeType: string }) { super(); assert.equal(options.mimeType, "audio/mp4"); instances++; }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(["final-audio-chunk"]) });
        this.dispatchEvent(new Event("stop"));
      });
    }
  }
  class Context {
    state = "running";
    async resume() {}
    createAnalyser() { return { fftSize: 0, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0.1) }; }
    createMediaStreamSource() { return { connect() {} }; }
    async decodeAudioData(buffer: ArrayBuffer) { decodedSize = buffer.byteLength; return { duration: 1 }; }
    async close() { closes++; this.state = "closed"; }
  }
  class Offline {
    destination = {};
    constructor(channels: number, frames: number, rate: number) { assert.deepEqual([channels, frames, rate], [1, 16000, 16000]); }
    createBufferSource() { return { buffer: undefined, connect() {}, start() {} }; }
    async startRendering() { return { getChannelData: () => new Float32Array(16000) }; }
  }
  for (const [name, value] of Object.entries({
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } },
    MediaRecorder: Recorder, AudioContext: Context, OfflineAudioContext: Offline,
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else Reflect.deleteProperty(globalThis, name); });
  }
  const recording = new BrowserRecording();
  await recording.start(() => assert.fail("capture must not fail"));
  assert.ok(recording.amplitude() > 0);
  const result = await recording.stop(); await recording.dispose();
  assert.equal(decodedSize, "final-audio-chunk".length);
  assert.equal(result.byteLength, 32044); assert.equal(closes, 1); assert.equal(instances, 1);
  assert.ok(stops >= 1);
});
