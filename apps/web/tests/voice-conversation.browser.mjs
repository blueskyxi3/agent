import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, firefox, webkit } from 'playwright';

const settings = { enabled: true, wake_words: ['小踢小踢'], wake_threshold: .25, wake_score: 1, wake_chunk_ms: 160,
  wake_cooldown_ms: 1500, pause_ms: 1200, dismiss_phrases: ['退下吧'], wake_reply: '', dismiss_reply: '', idle_seconds: 30 };
const moduleSource = `export function isDismiss(text){return text==='退下吧';}
export function createVoiceController({onEvent}){
 window.voiceEmit=onEvent;window.voiceModes=[];
 return {async start(){onEvent({type:'standby'});},mode(mode){window.voiceModes.push(mode);},async dispose(){window.disposed=(window.disposed||0)+1;}};
}`;
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/assistant.css"><div id="app"></div><script type="module">
import {mountAgentAssistant} from '/assistant-embed.js';
const options={apiBasePath:'/api/plugin-bridge/agent/api/v1',visible:true,voiceInput:true,voiceOutput:false,mode:new URL(location.href).searchParams.get('mode'),locale:'en_US',
theme:{primary:'#55c',primaryContrast:'#fff',surface:'#fff',background:'#fafafa',text:'#111',mutedText:'#666',border:'#ccc'},onNavigate(){},async onPageAction(){},onThreadChange(){},
onVoiceWake(){window.wakes=(window.wakes||0)+1;window.showVoice();},onVoiceDismiss(){window.dismissed=true;window.hideVoice();},onClose(){window.hideVoice();},onMinimize(){},onMaximize(){}};
window.controller=mountAgentAssistant(document.querySelector('#app'),options);
window.hideVoice=()=>controller.update({...options,visible:false});window.showVoice=()=>controller.update(options);
window.darkVoice=()=>controller.update({...options,locale:'zh_HK',theme:{...options.theme,surface:'#202124',background:'#151515',text:'#eee',mutedText:'#aaa',border:'#555'}});
window.emitSpeech=()=>{window.voiceEmit({type:'speech'});const a=new Uint8Array(48),v=new DataView(a.buffer);
for(const [offset,s] of [[0,'RIFF'],[8,'WAVEfmt '],[36,'data']])for(let i=0;i<s.length;i++)a[offset+i]=s.charCodeAt(i);
v.setUint32(4,40,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,4,true);
window.voiceEmit({type:'utterance',audio:a.buffer});};
</script>`;
for (const [name, browserType] of Object.entries({ chromium, firefox, webkit })) {
  for (const mode of ['page', 'panel']) {
    test(`${name} ${mode}: automatic chat, dismiss priority, draft protection, abort, dark mode`, { timeout: 60000 }, async t => {
      let transcript = '今天天气'; let hold, aborted = false, uploads = 0;
      const chats = [];
      const server = createServer(async (request, response) => {
        try {
          const path = new URL(request.url, 'http://localhost').pathname;
          if (path === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.setHeader('Set-Cookie', 'testsession=voice; HttpOnly; Path=/'); response.end(html); return; }
          if (path === '/assistant-embed.js' || path === '/assistant.css') {
            response.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : 'text/javascript'); response.end(await readFile(new URL(`../dist${path}`, import.meta.url))); return;
          }
          if (path === '/voice-assets/plugin.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(moduleSource); return; }
          response.setHeader('Content-Type', 'application/json');
          if (path.endsWith('/voice-control')) { response.end(JSON.stringify({ success: true, data: { settings, revision: 'test', available: true, asset_base: '/voice-assets', version: '0.2.0' } })); return; }
          if (path.endsWith('/audio/transcriptions')) {
            uploads++; assert.ok(request.headers.cookie?.includes('testsession=voice'));
            const chunks = []; for await (const chunk of request) chunks.push(chunk);
            assert.ok(Buffer.concat(chunks).includes(Buffer.from('RIFF')));
            response.on('close', () => { if (!response.writableFinished) aborted = true; });
            if (hold) await hold.promise;
            response.end(JSON.stringify({ text: transcript })); return;
          }
          if (path.endsWith('/chat')) {
            const chunks = []; for await (const chunk of request) chunks.push(chunk); chats.push(JSON.parse(Buffer.concat(chunks)));
            response.setHeader('Content-Type', 'text/event-stream');
            const events = [{ version: 1, type: 'turn.started', threadId: '11111111-1111-4111-8111-111111111111' },
              { version: 1, type: 'message.text.delta', delta: 'voice reply' },
              { version: 1, type: 'turn.completed', metrics: { characterCount: 11, totalMs: 1, inputTokens: 0, outputTokens: 0 } }];
            response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')); return;
          }
          response.end(JSON.stringify({ success: true, data: path.includes('role-guide') ? { starter_questions: [], capabilities: [] } : { contextWindow: 128000 } }));
        } catch { response.writeHead(500).end(); }
      });
      await new Promise(done => server.listen(0, '127.0.0.1', done));
      t.after(() => { hold?.release(); server.closeAllConnections(); return new Promise(done => server.close(done)); });
      const browser = await browserType.launch({ headless: true }); t.after(() => browser.close());
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);
      const start = () => page.getByRole('button', { name: 'Start voice conversation', exact: true }).click();
      await start(); await page.waitForFunction(() => Boolean(window.voiceEmit));
      assert.equal(uploads, 0); assert.equal(chats.length, 0);
      await page.evaluate(() => window.voiceEmit({ type: 'wake' }));
      await page.getByText('Listening · pauses send automatically', { exact: true }).waitFor();
      await page.evaluate(() => { window.emitSpeech(); window.emitSpeech(); });
      await page.getByText('voice reply', { exact: true }).waitFor();
      await page.getByText('Listening · pauses send automatically', { exact: true }).waitFor();
      assert.equal(uploads, 1); assert.equal(chats.length, 1); assert.equal(chats[0].message, '今天天气');

      const input = page.locator('.aih-input'); await input.fill('manual draft'); transcript = '退下吧';
      await page.evaluate(() => window.emitSpeech()); await page.waitForFunction(() => window.voiceModes.at(-1) === 'standby');
      assert.equal(await input.inputValue(), 'manual draft'); assert.equal(chats.length, 1);
      if (mode === 'panel') assert.equal(await page.evaluate(() => window.dismissed), true);
      await page.evaluate(() => window.showVoice());
      transcript = '保留语音'; await page.evaluate(() => window.voiceEmit({ type: 'wake' }));
      await page.getByText('Listening · pauses send automatically', { exact: true }).waitFor();
      await page.evaluate(() => window.emitSpeech());
      await page.getByRole('button', { name: 'Insert into draft', exact: true }).click();
      assert.equal(chats.length, 1); assert.equal(await input.inputValue(), 'manual draft\n保留语音');

      await input.fill(''); await start();
      await page.getByText('Waiting for wake word', { exact: true }).waitFor();
      await page.evaluate(() => window.voiceEmit({ type: 'wake' }));
      await page.getByText('Listening · pauses send automatically', { exact: true }).waitFor();
      let release; hold = { promise: new Promise(done => { release = done; }), release: () => release() };
      await page.evaluate(() => window.emitSpeech());
      await page.getByText('Transcribing…', { exact: true }).waitFor();
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => window.disposed >= 2);
      for (let n = 0; n < 20 && !aborted; n++) await new Promise(done => setTimeout(done, 20));
      assert.equal(aborted, true); hold.release(); assert.equal(chats.length, 1);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); window.darkVoice(); });
      await page.getByRole('button', { name: '開啟語音對話', exact: true }).waitFor();
      assert.deepEqual(errors, []);
    });
  }
}
