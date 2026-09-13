'use strict';
/**
 * p1b/scripts/ui-refactor-evidence.cjs —— UI 重构验收证据（DOM+computed-style ＋ 色彩对比 ＋ 前后对比）。
 * 产出：p1b/sim/out/ui-refactor/receipt.md（＋ evidence.json）。只读渲染；临时库；隔离端口 8791；零碰 8787。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildServer } = require('../src/server');
const { db } = require('../src/deps');
const store = require('../src/db/predictionsStore');
const { chromium } = require('D:/agent1super/mcp/node_modules/playwright');

const PORT = 8791;
const DIR = path.join(__dirname, '..', 'sim', 'out', 'ui-refactor');
const WEB = path.join(__dirname, '..', 'web');

function lum(hex) {
  const c = hex.replace('#', '');
  const v = [0, 2, 4].map((i) => parseInt(c.substr(i, 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(a, b) { const L1 = lum(a); const L2 = lum(b); const hi = Math.max(L1, L2); const lo = Math.min(L1, L2); return (hi + 0.05) / (lo + 0.05); }
function parseTokens(css) { const o = {}; const re = /--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g; let m; while ((m = re.exec(css))) o[m[1]] = m[2]; return o; }
function seedData() {
  const layers = ['L1', 'L2', 'L3', 'L5', 'L6', 'L4'];
  for (const L2 of layers) {
    for (let k = 0; k < 4; k++) {
      const row = store.insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'UI 证据题 ' + L2 + '-' + k, prob: 0.2 + 0.15 * k });
      store.updateAuditFields(row.id, { layer: L2, checklistHash: 'v2', gate: 'descriptive', engine: 'stat_baseline' });
      if (k % 2 === 0) store.resolvePrediction(row.id, 'true', null);
    }
  }
  store.insertPrediction({ gameId: 1, sourceType: '预测卡', statement: 'UI 证据未分层行', prob: 0.5 });
  store.insertPrediction({ gameId: 1, sourceType: '预测卡', statement: '【forward】UI 证据前瞻 2026-12-01（cutoff=2026-09-01）', prob: 0.4 });
  db.getConnection().prepare("INSERT INTO predictions (game_id, source_type, statement, evidence_json, checklist_hash, g2_regime, layer, created_at, matures_at) VALUES (1,'预测卡',?,?,'v2','R4','L2','2026-01-01 00:00:00','2026-12-01')")
    .run('UI 证据 R4 合格题', JSON.stringify([{ resolve: { date: '2026-12-01' }, baseRateNote: '基率=0.5' }]));
}
async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const tokens = parseTokens(fs.readFileSync(path.join(WEB, 'src', 'styles', 'tokens.css'), 'utf8'));
  const pairs = [['text', 'panel'], ['text', 'bg'], ['muted', 'panel'], ['accent', 'panel'], ['info', 'panel'],
    ['ok', 'panel'], ['warn', 'panel'], ['danger', 'panel'],
    ['layer-l1', 'panel'], ['layer-l2', 'panel'], ['layer-l3', 'panel'], ['layer-l4', 'panel'], ['layer-l5', 'panel'], ['layer-l6', 'panel']];
  const contrast = pairs.map((p) => {
    const r = tokens[p[0]] && tokens[p[1]] ? Number(ratio(tokens[p[0]], tokens[p[1]]).toFixed(2)) : null;
    return { pair: p[0] + ' on ' + p[1], fg: tokens[p[0]], bg: tokens[p[1]], ratio: r, pass_4_5: r !== null && r >= 4.5 };
  });

  const dbPath = path.join(os.tmpdir(), 'p1b-ui-evidence-' + process.pid + '.db');
  const app = await buildServer({ dbPath: dbPath, llmMock: true, providersPath: path.join(os.tmpdir(), 'p1b-ui-ev-' + process.pid + '.json') });
  await app.inject({ method: 'POST', url: '/api/games', payload: { name: 'UI 证据局', type: 'werewolf', player_count: 6 } });
  seedData();
  await app.listen({ port: PORT, host: '127.0.0.1' });

  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const computed = {};
  for (const w of [375, 1440]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:' + PORT + '/#/audit', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    computed[String(w)] = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const kpi = document.querySelector('.ui-kpi-row');
      const kcols = kpi ? getComputedStyle(kpi).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
      const content = document.querySelector('.content');
      const matrix = document.querySelector('[data-testid="layer-matrix-table"]');
      return {
        body_font_family: body.fontFamily,
        body_font_variant_numeric: body.fontVariantNumeric,
        content_max_width: content ? getComputedStyle(content).maxWidth : null,
        kpi_grid_columns: kcols,
        matrix_cols: matrix ? matrix.querySelectorAll('thead th').length : 0,
        matrix_rows: matrix ? matrix.querySelectorAll('tbody tr.is-row').length : 0,
        h_overflow_px: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        emoji_in_text: (document.body.innerText.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length,
      };
    });
    await ctx.close();
  }
  await browser.close();
  await app.close();

  const dist = path.join(WEB, 'dist', 'assets');
  const files = fs.readdirSync(dist);
  const js = files.filter((f) => /^index-.*\.js$/.test(f))[0];
  const css = files.filter((f) => /^index-.*\.css$/.test(f))[0];
  const jsText = fs.readFileSync(path.join(dist, js), 'utf8');
  const cssText = fs.readFileSync(path.join(dist, css), 'utf8');
  const bundle = { js: js, css: css,
    js_has_forbidden_word: jsText.indexOf('预测') >= 0, css_has_forbidden_word: cssText.indexOf('预测') >= 0,
    js_has_intake: jsText.indexOf('/intake') >= 0,
    css_has_tokens: cssText.indexOf('--layer-l6') >= 0 && cssText.indexOf('--table-row-height') >= 0,
    css_has_breakpoints: ['375px', '768px', '1024px', '1440px'].filter((b) => cssText.indexOf(b) >= 0),
    font_assets: files.filter((f) => /fira/.test(f)).length };

  const before = JSON.parse(fs.readFileSync(path.join(DIR, 'before-metrics.json'), 'utf8'));
  const after = JSON.parse(fs.readFileSync(path.join(DIR, 'after-metrics.json'), 'utf8'));
  fs.writeFileSync(path.join(DIR, 'evidence.json'), JSON.stringify({ generated_at: new Date().toISOString(), bundle: bundle, contrast: contrast, computed: computed, before: before.widths, after: after.widths }, null, 1), 'utf8');

  const T = [];
  T.push('# UI 重构（步 1+2）验收收据');
  T.push('');
  T.push('- 新 bundle：' + js + ' ／ CSS ' + css + ' ／ 字体资产 ' + bundle.font_assets + ' 个（Fira Sans/Code latin）');
  T.push('- 「预测」字样：js=' + bundle.js_has_forbidden_word + ' css=' + bundle.css_has_forbidden_word);
  T.push('- 断点标记：' + bundle.css_has_breakpoints.join(' / '));
  T.push('');
  T.push('## 前后对比（DOM + computed-style 实测）');
  T.push('| 断点 | 容器宽 before→after | 旧6卡 | 矩阵行 | KPI格 | 横向溢出 | emoji |');
  T.push('|---|---|---|---|---|---|---|');
  for (const w of ['375', '768', '1024', '1440']) {
    const b = before.widths[w]; const a = after.widths[w];
    T.push('| ' + w + ' | ' + b.content_client_width + '→' + a.content_client_width + ' | ' + b.old_layer_cards + '→' + a.old_layer_cards + ' | ' + a.matrix_rows + ' | ' + a.kpi_cells + ' | ' + b.h_overflow_px + '→' + a.h_overflow_px + ' | ' + b.emoji_count + '→' + a.emoji_count + ' |');
  }
  T.push('');
  T.push('## computed-style（after）');
  for (const w of ['375', '1440']) {
    const c = computed[w];
    T.push('- ' + w + 'px：body font=' + c.body_font_family.split(',')[0] + ' ｜ font-variant-numeric=' + c.body_font_variant_numeric + ' ｜ .content max-width=' + c.content_max_width + ' ｜ KPI 列数=' + c.kpi_grid_columns + ' ｜ 矩阵列数=' + c.matrix_cols + ' ｜ 矩阵行数=' + c.matrix_rows + ' ｜ 横向溢出=' + c.h_overflow_px + 'px');
  }
  T.push('');
  T.push('## 色彩对比度（WCAG 2.1，阈值 ≥4.5:1）');
  for (const c of contrast) T.push('- ' + c.pair + ' = ' + c.ratio + (c.pass_4_5 ? ' ✅' : ' ❌'));
  const bad = contrast.filter((c) => !c.pass_4_5);
  T.push('');
  T.push('**结论**：' + (bad.length === 0 ? '全部 ≥4.5:1 ✅' : '未达标 ' + bad.length + ' 项 ❌'));
  T.push('');
  T.push('> 截图：before-audit-{375,768,1024,1440}.png ／ after-audit-{375,768,1024,1440}.png（本目录）');
  fs.writeFileSync(path.join(DIR, 'receipt.md'), T.join('\n') + '\n', 'utf8');
  console.log(T.join('\n'));
  console.log('[ui-evidence] -> ' + path.join(DIR, 'receipt.md'));
}
main().catch((e) => { console.error('[ui-evidence] FAIL ' + (e && e.stack ? e.stack : e)); process.exitCode = 1; });
