'use strict';
/**
 * p1b/src/routes/disclosure.js —— 披露件只读端点（P0-U7/U8 · 2026-09-16）
 *
 * GET /api/disclosure/calendar    → 最新 p1b/sim/out/forecast-calendar-YYYYMMDD.json
 * GET /api/disclosure/calibration → 最新 p1b/sim/out/calibration-report-YYYYMMDD.json
 * GET /api/disclosure/negative-results → 最新 p1b/sim/out/negative-results-ledger-YYYYMMDD.json（第 4 期 I2）
 * GET /api/disclosure/bayes-lens  → 最新 p1b/sim/out/stage4-run-five-layers-YYYYMMDD[a-z].json 的**精简投影**（第 4 期 I6）
 * 纪律：只读落盘件（latestByPattern 同款取最新日期件）；缺件 404 + 生成命令提示（不静默、不编数）；
 *   零 LLM、零写库、零引擎重跑。additive：既有端点零改动。
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'sim', 'out');

function latest(re) {
  try {
    const c = fs.readdirSync(OUT).filter((f) => re.test(f)).sort();
    if (c.length) return path.join(OUT, c[c.length - 1]);
  } catch (e) { /* 目录不可读 ⇒ 视为缺件 */ }
  return null;
}
// ★2026-09-21：日期后允许可选小写字母后缀（同日重跑的 `…-20260921c.json` 此前被忽略 ⇒ 静默读旧件）。
//   与 board.cjs / calibration-report.cjs 同批修（三处同一缺陷）。
function serve(pattern, hint, reply) {
  const p = latest(pattern);
  if (!p) return reply.code(404).send({ error: 'n/a：缺披露件（未生成或尚未跑脚本）', hint: hint });
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
    return reply.code(500).send({ error: '披露件不可解析: ' + path.basename(p) });
  }
}

function register(app) {
  app.get('/api/disclosure/calendar', async (req, reply) =>
    serve(/^forecast-calendar-(\d{8})([a-z]?)\.json$/, 'node p1b/scripts/forecast-calendar.cjs', reply));
  app.get('/api/disclosure/calibration', async (req, reply) =>
    serve(/^calibration-report-(\d{8})([a-z]?)\.json$/, 'node p1b/scripts/calibration-report.cjs', reply));

  // ── 第 4 期 I2：负结果账本对外（15 号件 §I2「第 1 期末即可上，成本近零」）──
  app.get('/api/disclosure/negative-results', async (req, reply) =>
    serve(/^negative-results-ledger-(\d{8})([a-z]?)\.json$/, 'node p1b/scripts/negative-results.cjs', reply));

  // ── 第 4 期 I6：贝叶斯语义透镜（**精简投影**：只返回页面需要的字段，不透传整件）──
  app.get('/api/disclosure/bayes-lens', async (req, reply) => {
    const p = latest(/^stage4-run-five-layers-(\d{8})([a-z]?)\.json$/);
    if (!p) return reply.code(404).send({ error: 'n/a：缺读数件（未生成或尚未跑脚本）', hint: 'node p1b/scripts/stage4-run.cjs --text <out> --json <out>' });
    let j;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
      return reply.code(500).send({ error: '读数件不可解析: ' + path.basename(p) });
    }
    // 只投影页面需要的既有列（零新算；缺键如实 null）
    const layers = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
    const report = j.report || {};
    const domains = Array.isArray(j.by_domain) ? j.by_domain : [];
    return {
      source_file: path.basename(p),
      generated_at: j.generated_at || null,
      bayes_legend: j.bayes_legend || null,
      layers: layers.map((L) => {
        const r = report[L] || {};
        return { layer: L, ledger_rows: r.ledger_rows === undefined ? null : r.ledger_rows, scored_n: r.scored_n === undefined ? null : r.scored_n, brier_engine: r.brier_engine === undefined ? null : r.brier_engine };
      }),
      domains: domains.map((d) => ({
        layer: d.layer, domain: d.domain, scored_n: d.scored_n, conclusion_allowed: d.conclusion_allowed,
        mean_p: d.mean_p === undefined ? null : d.mean_p, obs_rate: d.obs_rate === undefined ? null : d.obs_rate,
        brier_engine: d.brier_engine === undefined ? null : d.brier_engine,
      })),
      cells_total: j.domain_cells_total === undefined ? null : j.domain_cells_total,
      cells_with_conclusion: j.domain_cells_with_conclusion === undefined ? null : j.domain_cells_with_conclusion,
    };
  });
}

module.exports = { register };
