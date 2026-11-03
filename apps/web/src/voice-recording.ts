export type RecordingFailure = "unavailable" | "permission" | "empty" | "cancelled" | "interrupted" | "tooLarge";
export class RecordingError extends Error {
  constructor(readonly kind: RecordingFailure) { super(kind); }
}

export const voiceLimits = { maxSeconds: 120, maxBytes: 4 * 1024 * 1024 } as const;

export function encodeWave(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (const [i, sample] of samples.entries()) {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

export interface VoiceRecording {
  start(onError: (error: RecordingError) => void): Promise<void>;
  stop(): Promise<Uint8Array<ArrayBuffer>>;
  amplitude(): number;
  dispose(): Promise<void>;
}

/** One browser microphone lifetime, including grants received after cancellation. */
export class BrowserRecording implements VoiceRecording {
  private stream?: MediaStream | undefined;
  private recorder?: MediaRecorder;
  private context?: AudioContext | undefined;
  private analyser?: AnalyserNode | undefined;
  private readonly samples = new Float32Array(256);
  private readonly lifetime = new AbortController();
  private chunks: Blob[] = [];
  private chunkBytes = 0;
  private disposal?: Promise<void>;

  async start(onError: (error: RecordingError) => void): Promise<void> {
    if (!globalThis.navigator?.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined") {
      throw new RecordingError("unavailable");
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    } catch (error) {
      if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) throw new RecordingError("permission");
      throw new RecordingError("unavailable");
    }
    if (this.lifetime.signal.aborted) { stream.getTracks().forEach(track => track.stop()); throw new RecordingError("cancelled"); }
    this.stream = stream;
    try {
      this.context = new AudioContext();
      await this.context.resume();
      this.lifetime.signal.throwIfAborted();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = this.samples.length;
      this.context.createMediaStreamSource(stream).connect(this.analyser);
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]
        .find(value => MediaRecorder.isTypeSupported(value));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.recorder = recorder;
      const fail = (kind: RecordingFailure) => {
        if (this.lifetime.signal.aborted) return;
        onError(new RecordingError(kind));
        void this.dispose().catch(error => console.warn("Microphone cleanup failed", error));
      };
      for (const track of stream.getTracks()) track.addEventListener("ended", () => fail("interrupted"), { signal: this.lifetime.signal });
      recorder.ondataavailable = event => {
        if (this.lifetime.signal.aborted || !event.data.size) return;
        this.chunkBytes += event.data.size;
        if (this.chunkBytes > 24 * 1024 * 1024) { fail("tooLarge"); return; }
        this.chunks.push(event.data);
      };
      recorder.onerror = () => fail("interrupted");
      recorder.start(1000);
    } catch (error) { await this.dispose(); throw error; }
  }

  amplitude(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    return Math.sqrt(this.samples.reduce((sum, value) => sum + value * value, 0) / this.samples.length);
  }

  async stop(): Promise<Uint8Array<ArrayBuffer>> {
    const recorder = this.recorder, context = this.context;
    if (!recorder || !context || recorder.state !== "recording") throw new RecordingError("empty");
    try {
      await new Promise<void>((resolve, reject) => {
        const stopped = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new RecordingError("interrupted")); };
        const aborted = () => { cleanup(); reject(new RecordingError("cancelled")); };
        const cleanup = () => {
          recorder.removeEventListener("stop", stopped); recorder.removeEventListener("error", failed);
          this.lifetime.signal.removeEventListener("abort", aborted);
        };
        recorder.addEventListener("stop", stopped, { once: true });
        recorder.addEventListener("error", failed, { once: true });
        this.lifetime.signal.addEventListener("abort", aborted, { once: true });
        recorder.stop();
      });
      this.stream?.getTracks().forEach(track => track.stop());
      this.lifetime.signal.throwIfAborted();
      const blob = new Blob(this.chunks, { type: recorder.mimeType });
      if (!blob.size) throw new RecordingError("empty");
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      this.lifetime.signal.throwIfAborted();
      const frames = Math.min(Math.floor(decoded.duration * 16000), voiceLimits.maxSeconds * 16000);
      if (!frames) throw new RecordingError("empty");
      const offline = new OfflineAudioContext(1, frames, 16000);
      const source = offline.createBufferSource();
      source.buffer = decoded; source.connect(offline.destination); source.start();
      const rendered = await offline.startRendering();
      this.lifetime.signal.throwIfAborted();
      const audio = encodeWave(rendered.getChannelData(0));
      if (audio.byteLength > voiceLimits.maxBytes) throw new RecordingError("tooLarge");
      return audio;
    } finally { await this.dispose(); }
  }

  dispose(): Promise<void> {
    if (!this.disposal) {
      this.lifetime.abort(new RecordingError("cancelled"));
      if (this.recorder?.state === "recording") this.recorder.stop();
      this.stream?.getTracks().forEach(track => track.stop());
      this.stream = undefined; this.analyser = undefined; this.chunks = [];
      const context = this.context; this.context = undefined;
      this.disposal = context && context.state !== "closed" ? context.close() : Promise.resolve();
    }
    return this.disposal;
  }
}
