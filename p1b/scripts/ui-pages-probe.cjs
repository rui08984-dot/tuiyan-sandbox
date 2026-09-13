'use strict';
/**
 * p1b/scripts/ui-pages-probe.cjs —— 四页(live/intake/manage/settings) before/after 截图 + 四断点横向溢出实测。
 * 用法：node scripts/ui-pages-probe.cjs --label before|after。隔离端口 8791 + 临时库；零碰 8787。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildServer } = require('../src/server');
const store = require('../src/db/predictionsStore');
const { chromium } = require('D:/agent1super/mcp/node_modules/playwright');
const PORT = 8791;
const DIR = path.join(__dirname, '..', 'sim', 'out', 'ui-refactor');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const LABEL = arg('label', 'before');
const PAGES = [['live', '#/'], ['intake', '#/intake'], ['manage', '#/manage'], ['settings', '#/settings']];
const WIDTHS = [375, 768, 1024, 1440];
function seed() {
  const layers = ['L1', 'L2', 'L3', 'L5', 'L6', 'L4'];
  for (const Lx of layers) {
    for (let k = 0; k < 3; k++) {
      const r = store.insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'UI 页证据 ' + Lx + '-' + k, prob: 0.3 + 0.1 * k });
      store.updateAuditFields(r.id, { layer: Lx, checklistHash: 'v2', gate: 'descriptive', engine: 'stat_baseline' });
      if (k % 2 === 0) store.resolvePrediction(r.id, 'true', null);
    }
  }
  store.insertPrediction({ gameId: 1, sourceType: '预测卡', statement: '【forward】UI 页前瞻 2026-12-01（cutoff=2026-09-01）', prob: 0.4 });
}
const EMOJI = () => new RegExp('[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]', 'gu');
async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const dbPath = path.join(os.tmpdir(), 'p1b-ui-pages-' + LABEL + '-' + process.pid + '.db');
  const app = await buildServer({ dbPath: dbPath, llmMock: true, providersPath: path.join(os.tmpdir(), 'p1b-ui-pages-' + process.pid + '.json') });
  await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'UI 页证据局', type: 'werewolf', player_count: 6 } });
  seed();
  await app.listen({ port: PORT, host: '127.0.0.1' });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const out = { label: LABEL, pages: {} };
  for (const pg of PAGES) {
    const name = pg[0]; const hash = pg[1];
    out.pages[name] = { widths: {} };
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
      const page = await ctx.newPage();
      await page.goto('http://127.0.0.1:' + PORT + '/' + hash, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const m = await page.evaluate((src) => ({
        h_overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        emoji: (document.body.innerText.match(new RegExp(src, 'gu')) || []).length,
        ui_cards: document.querySelectorAll('.ui-section, .ui-stat').length,
      }), EMOJI().source);
      out.pages[name].widths[String(w)] = m;
      if (w === 1440 || w === 375) await page.screenshot({ path: path.join(DIR, LABEL + '-' + name + '-' + w + '.png'), fullPage: true });
      await ctx.close();
    }
    console.log('[' + LABEL + '] ' + name + ' overflow=' + WIDTHS.map((w) => out.pages[name].widths[String(w)].h_overflow).join('/') + ' emoji=' + WIDTHS.map((w) => out.pages[name].widths[String(w)].emoji).join('/') + ' ui_cards@1440=' + out.pages[name].widths['1440'].ui_cards);
  }
  await browser.close();
  await app.close();
  fs.writeFileSync(path.join(DIR, LABEL + '-pages-metrics.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('[ui-pages] ' + LABEL + ' -> ' + path.join(DIR, LABEL + '-pages-metrics.json'));
}
main().catch((e) => { console.error('[ui-pages] FAIL ' + (e && e.stack ? e.stack : e)); process.exitCode = 1; });
