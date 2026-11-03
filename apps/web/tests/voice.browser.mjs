import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, firefox, webkit } from 'playwright';

const html = `<!doctype html><html><head><link rel="stylesheet" href="/assistant.css"></head><body><div id="app"></div>
<script type="module">
import { mountAgentAssistant } from '/assistant-embed.js';
const options = { apiBasePath: '/api/plugin-bridge/agent/api/v1', visible: true, voiceInput: true, voiceOutput: false,
  mode: new URL(location.href).searchParams.get('mode') || 'page', locale: 'en_US', theme: { primary: '#5b5ce2', primaryContrast: '#fff', surface: '#fff', background: '#f6f6f6',
  text: '#222', mutedText: '#666', border: '#ddd' }, onNavigate() {}, async onPageAction() {}, onThreadChange() {},
  onClose() { window.hideVoice(); }, onMinimize() {}, onMaximize() {} };
window.controller = mountAgentAssistant(document.getElementById('app'), options);
window.hideVoice = () => controller.update({ ...options, visible: false });
window.showVoice = () => controller.update(options);
window.darkVoice = () => controller.update({ ...options, locale: 'zh_HK', theme: { ...options.theme, surface: '#202124', background: '#151515', text: '#eee', mutedText: '#aaa', border: '#555' } });
</script></body></html>`;

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  for (const mode of ['page', 'panel']) {
    test(`${name} ${mode}: real recorder WAV, draft protection, cancellation, and dark mode`, { timeout: 60_000 }, async t => {
      let release;
      const server = createServer(async (request, response) => {
        try {
          if (new URL(request.url, 'http://localhost').pathname === '/') { response.setHeader('content-type', 'text/html'); response.end(html); return; }
          if (request.url === '/assistant-embed.js' || request.url === '/assistant.css') {
            response.setHeader('content-type', request.url.endsWith('.css') ? 'text/css' : 'text/javascript');
            response.end(await readFile(new URL(`../dist${request.url}`, import.meta.url))); return;
          }
          response.setHeader('content-type', 'application/json');
          if (request.url === '/api/user/self/assistant/audio/transcriptions') {
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const body = Buffer.concat(chunks);
            const form = await new Response(body, { headers: { 'content-type': request.headers['content-type'] } }).formData();
            const file = form.get('file');
            assert.equal(file.name, 'recording.wav');
            const audio = Buffer.from(await file.arrayBuffer());
            assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
            assert.equal(audio.toString('ascii', 8, 16), 'WAVEfmt ');
            assert.equal(audio.readUInt32LE(4), audio.length - 8);
            assert.equal(audio.readUInt32LE(16), 16);
            assert.equal(audio.readUInt16LE(20), 1, 'uncompressed PCM');
            assert.equal(audio.readUInt16LE(22), 1, 'mono');
            assert.equal(audio.readUInt32LE(24), 16000, '16 kHz');
            assert.equal(audio.readUInt32LE(28), 32000);
            assert.equal(audio.readUInt16LE(32), 2);
            assert.equal(audio.readUInt16LE(34), 16, 'PCM16');
            assert.equal(audio.toString('ascii', 36, 40), 'data');
            assert.equal(audio.readUInt32LE(40), audio.length - 44);
            assert.equal(form.get('response_format'), 'json');
            if (release) await release.promise;
            response.end(JSON.stringify({ text: 'recognized ' })); return;
          }
          response.end(JSON.stringify({ success: true, data: request.url?.includes('role-guide') ? { starter_questions: [], capabilities: [] } : { contextWindow: 128000 } }));
        } catch { response.writeHead(404).end(); }
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
      const browser = await engine.launch({ headless: true }); t.after(() => browser.close());
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
      await page.addInitScript(() => {
        window.voiceTracks = []; window.voiceChatRequests = 0;
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
          const context = new AudioContext(); const oscillator = context.createOscillator();
          const destination = context.createMediaStreamDestination();
          oscillator.connect(destination); oscillator.start(); await context.resume();
          const tracks = destination.stream.getTracks(); window.voiceTracks.push(...tracks);
          for (const track of tracks) {
            const stop = track.stop.bind(track);
            let stopped = false;
            track.stop = () => { if (stopped) return; stopped = true; stop(); oscillator.stop(); void context.close(); };
          }
          return destination.stream;
        } } });
      });
      page.on('request', request => { if (request.url().endsWith('/chat')) throw new Error('Dictation must not submit a chat turn'); });
      await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);
      const microphone = page.locator('.aih-compose-row .aih-voice-input button');
      assert.equal(await microphone.count(), 1, 'one microphone inside the composer');
      assert.equal(await microphone.textContent(), '', 'microphone is an icon without a text button');
      assert.equal(await microphone.locator('svg').count(), 1);
      const microphoneBounds = await microphone.boundingBox();
      const sendBounds = await page.locator('.aih-send').boundingBox();
      assert.ok(microphoneBounds.x + microphoneBounds.width <= sendBounds.x, 'microphone is left of send');
      assert.ok(Math.abs(microphoneBounds.y - sendBounds.y) <= 2, 'microphone and send share a row');
      const input = page.locator('.aih-input');
      await input.fill('prefix suffix'); await input.evaluate(node => { node.focus(); node.setSelectionRange(7, 7); });
      await page.getByRole('button', { name: 'Voice input', exact: true }).click();
      await page.getByRole('button', { name: 'Stop and transcribe', exact: true }).waitFor();
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: 'Stop and transcribe', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.aih-input')?.value === 'prefix recognized suffix');

      let resolve; release = { promise: new Promise(done => resolve = done) };
      await page.getByRole('button', { name: 'Voice input', exact: true }).click();
      await page.getByRole('button', { name: 'Stop and transcribe', exact: true }).waitFor();
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: 'Stop and transcribe', exact: true }).click();
      await page.getByText('Transcribing…', { exact: true }).waitFor();
      await input.fill('edited'); resolve();
      await page.getByText('The draft changed. Review the transcript and insert it when ready.').waitFor();
      assert.equal(await input.inputValue(), 'edited');
      await page.getByRole('button', { name: 'Insert text', exact: true }).click();
      assert.ok((await input.inputValue()).includes('recognized'));

      release = undefined;
      await page.getByRole('button', { name: 'Voice input', exact: true }).click();
      await page.getByRole('button', { name: 'Stop and transcribe', exact: true }).waitFor();
      await page.evaluate(() => window.hideVoice());
      await page.waitForFunction(() => window.voiceTracks.every(track => track.readyState === 'ended'));
      await page.evaluate(() => { window.showVoice(); window.darkVoice(); });
      await page.getByRole('button', { name: '語音輸入', exact: true }).waitFor();
      assert.equal(await input.evaluate(node => getComputedStyle(node.closest('.aih-root')).getPropertyValue('--aih-surface').trim()), '#202124');
    });
  }
}
