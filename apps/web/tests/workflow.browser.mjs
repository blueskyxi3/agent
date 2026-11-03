import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import { chromium } from 'playwright';

test('workflow waits for persistence, survives remounts, retries errors; Excel has no border', { timeout: 60_000 }, async t => {
  const fixture = `<!doctype html><html><body><div id="app"></div><script type="module">
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { PageWorkflowArtifact } from '/src/PageWorkflowArtifact.tsx';
    import { ExcelExportButton } from '/src/ExcelExportButton.tsx';
    import '/src/styles.css';
    const root = createRoot(document.getElementById('app'));
    window.workflow = { kind: 'page_workflow', version: 1, workflowId: 'test', step: 'start', expiresAt: Date.now() + 600000, operationId: 'post.api.token', allowedActions: ['open'] };
    window.calls = []; window.blockOpen = false;
    window.render = (key = 'initial') => root.render(React.createElement('div', { className: 'aih-root', style: { '--aih-primary': '#2962ff', '--aih-surface': '#fff' } },
      React.createElement(PageWorkflowArtifact, { key, data: window.workflow, apiBasePath: '/api', threadId: 'thread', locale: 'zh_CN', onPageAction: async (action, payload) => {
        window.calls.push({ action, command: payload.command });
        if (window.blockOpen) await new Promise(resolve => window.releaseOpen = resolve);
        return {};
      } }),
      React.createElement(ExcelExportButton, { title: 'test', columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }], locale: 'zh_CN' })));
    window.clear = () => root.render(null);
    window.render();
  </script></body></html>`;
  const server = await createServer({
    configFile: false, root: new URL('..', import.meta.url).pathname,
    esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'workflow-fixture', configureServer(server) {
      server.middlewares.use('/fixture', async (_request, response) => {
        response.setHeader('content-type', 'text/html');
        response.end(await server.transformIndexHtml('/fixture', fixture));
      });
    } }],
  });
  t.after(() => server.close()); await server.listen();
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let available = false, failure = false, step = 'start', gets = 0, patches = 0;
  await page.route('**/api/threads/thread/page-workflows/test', async route => {
    if (route.request().method() === 'PATCH') {
      patches++; step = route.request().postDataJSON().step;
    } else {
      gets++;
      if (failure) return route.fulfill({ status: 503, json: { success: false, message: '服务暂不可用' } });
      if (!available) return route.fulfill({ status: 404, json: { success: false } });
    }
    await route.fulfill({ json: { success: true, data: { kind: 'page_workflow', workflowId: 'test', step, expiresAt: Date.now() + 600000, allowedActions: [] } } });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/fixture`);
  await page.getByText('准备打开创建表单', { exact: true }).waitFor();
  // Previously, 20 unsuccessful reads (~10 seconds) produced a false failure.
  await page.waitForTimeout(11000);
  assert.ok(gets >= 20);
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.evaluate(() => window.blockOpen = true); available = true;
  await page.waitForFunction(() => window.calls.length === 1);
  await page.evaluate(() => window.render('remounted'));
  await page.waitForTimeout(11000);
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await page.evaluate(() => window.calls.length), 1);
  await page.evaluate(() => { window.blockOpen = false; window.releaseOpen(); });
  await page.getByText('请确认 API Key 名称：', { exact: true }).waitFor();
  assert.equal(patches, 1);
  assert.equal(await page.evaluate(() => window.calls.some(call => call.command === 'submit')), false);

  failure = true;
  await page.evaluate(() => window.render('error'));
  await page.getByRole('alert').filter({ hasText: '服务暂不可用' }).waitFor();
  failure = false;
  await page.getByRole('button', { name: '重试恢复' }).click();
  await page.getByText('请确认 API Key 名称：', { exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(patches, 1);

  step = 'submitting';
  await page.evaluate(() => window.render('submitting'));
  await page.getByText('提交状态尚未确认。请检查 API Key 列表，避免重复创建。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '确认创建' }).count(), 0);
  assert.equal(patches, 1);

  const exportButton = page.getByRole('button', { name: '导出 Excel', exact: true });
  for (const surface of ['#fff', '#202124']) {
    await page.locator('.aih-root').evaluate((node, value) => node.style.setProperty('--aih-surface', value), surface);
    assert.equal(await exportButton.evaluate(node => getComputedStyle(node).borderWidth), '0px');
    await exportButton.hover();
    assert.equal(await exportButton.evaluate(node => getComputedStyle(node).borderWidth), '0px');
  }
  const downloadEvent = page.waitForEvent('download'); await exportButton.click();
  assert.equal((await downloadEvent).suggestedFilename(), 'test.xlsx');
  available = false;
  await page.evaluate(() => { window.workflow.expiresAt = Date.now() - 1; window.render('expired'); });
  await page.getByRole('alert').filter({ hasText: '操作已过期，请重新发起。' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '重试恢复' }).count(), 0);

  await page.evaluate(() => { window.workflow.expiresAt = Date.now() + 600000; window.render('cancel-poll'); });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.clear());
  await page.waitForTimeout(600);
  const stoppedGets = gets;
  await page.waitForTimeout(600);
  assert.equal(gets, stoppedGets);
  assert.deepEqual(errors, []);
});
