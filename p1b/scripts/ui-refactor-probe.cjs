'use strict';
/**
 * p1b/scripts/ui-refactor-probe.cjs —— UI 重构前后对比探针（Playwright/Edge 无头，隔离端口 8791）。
 *
 * 用法：node scripts/ui-refactor-probe.cjs --label before|after [--out <dir>]
 * 产出：<out>/<label>-audit-<width>.png（4 断点全页截图）＋ <out>/<label>-metrics.json（DOM+computed-style 实测）
 * 铁律：只读渲染；临时库；零碰 8787；不改任何后端契约。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const store = require('../src/db/predictionsStore');
const { chromium } = require('D:/agent1super/mcp/node_modules/playwright');

const PORT = 8791;
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const LABEL = arg('label', 'before');
const OUT = arg('out', path.join(__dirname, '..', 'sim', 'out', 'ui-refactor'));
const dbPath = path.join(os.tmpdir(), 'p1b-ui-probe-' + LABEL + '-' + process.pid + '.db');
const providersPath = path.join(os.tmpdir(), 'p1b-ui-probe-' + process.pid + '.json');
const WIDTHS = [375, 768, 1024, 1440];

function seedData(app) {
  const conn = db.getConnection();
  const layers = ['L1', 'L2', 'L3', 'L5', 'L6', 'L4'];
  let n = 0;
  for (const L of layers) {
    for (let k = 0; k < 4; k++) {
      const row = store.insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'UI 探针题 ' + L + '-' + k, prob: 0.2 + 0.15 * k });
      store.updateAuditFields(row.id, { layer: L, checklistHash: 'v2', gate: 'descriptive', engine: 'stat_baseline' });
      if (k % 2 === 0) store.resolvePrediction(row.id, 'true', null);
      n++;
    }
  }
  store.insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'UI 探针未分层行（门域外展示）', prob: 0.5 });
  store.insertPrediction({ gameId: 1, sourceType: '预测卡', statement: '【forward】UI 探针前瞻题 2026-12-01（cutoff=2026-09-01）', prob: 0.4 });
  const ev = JSON.stringify([{ resolve: { date: '2026-12-01' }, baseRateNote: '基率=0.5' }]);
  conn.prepare("INSERT INTO predictions (game_id, source_type, statement, evidence_json, checklist_hash, g2_regime, layer, created_at, matures_at) VALUES (1,'预测卡',?,?,'v2','R4','L2','2026-01-01 00:00:00','2026-12-01')").run('UI 探针 R4 合格题 A', ev);
  conn.prepare("INSERT INTO predictions (game_id, source_type, statement, checklist_hash, g2_regime, layer, created_at, matures_at) VALUES (1,'预测卡',?,'v2','R4','L2','2026-01-01 00:00:00','2026-12-01')").run('UI 探针 R4 域内样例 B');
  return { layered_rows: n, forward: 1, r4_rows: 2, unlayered: 1 };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await buildServer({ dbPath: dbPath, llmMock: true, providersPath: providersPath });
  await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'UI 探针局', type: 'werewolf', player_count: 6 } });
  const seed = seedData(app);
  await app.listen({ port: PORT, host: '127.0.0.1' });
  const base = 'http://127.0.0.1:' + PORT + '/#/audit';
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const metrics = { label: LABEL, base: base, seed: seed, widths: {} };
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const content = document.querySelector('.content');
      const cs = content ? getComputedStyle(content) : null;
      const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
      const text = document.body ? document.body.innerText : '';
      window.scrollTo(9999, 0);
      return {
        doc_scroll_width: de.scrollWidth, doc_client_width: de.clientWidth,
        h_overflow_px: de.scrollWidth - de.clientWidth,
        window_scroll_x_after_scrollTo: window.scrollX,
        content_max_width: cs ? cs.maxWidth : null,
        content_client_width: content ? content.clientWidth : null,
        kpi_cells: document.querySelectorAll('[data-testid^="kpi-"]').length,
        matrix_rows: document.querySelectorAll('[data-testid^="layer-row-"]').length,
        old_layer_cards: document.querySelectorAll('.audit-lcard').length,
        has_breadcrumb: !!document.querySelector('[data-testid="breadcrumb"]'),
        has_alertbar: !!document.querySelector('[data-testid="alertbar"]'),
        tab_count: document.querySelectorAll('[role="tab"]').length,
        emoji_count: (text.match(emoji) || []).length,
        table_count: document.querySelectorAll('table').length,
      };
    });
    metrics.widths[String(w)] = m;
    await page.screenshot({ path: path.join(OUT, LABEL + '-audit-' + w + '.png'), fullPage: true });
    await ctx.close();
    console.log('[' + LABEL + '] ' + w + 'px -> h_overflow=' + m.h_overflow_px + ' kpi=' + m.kpi_cells + ' matrixRows=' + m.matrix_rows + ' oldCards=' + m.old_layer_cards + ' emoji=' + m.emoji_count + ' contentW=' + m.content_client_width);
  }
  await browser.close();
  await app.close();
  fs.writeFileSync(path.join(OUT, LABEL + '-metrics.json'), JSON.stringify(metrics, null, 1), 'utf8');
  console.log('[ui-probe] ' + LABEL + ' -> ' + path.join(OUT, LABEL + '-metrics.json'));
}
main().catch((e) => { console.error('[ui-probe] FAIL ' + (e && e.stack ? e.stack : e)); process.exitCode = 1; });
