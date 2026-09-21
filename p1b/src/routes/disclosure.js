'use strict';
/**
 * p1b/src/routes/disclosure.js —— 披露件只读端点（P0-U7/U8 · 2026-09-16）
 *
 * GET /api/disclosure/calendar    → 最新 p1b/sim/out/forecast-calendar-YYYYMMDD.json
 * GET /api/disclosure/calibration → 最新 p1b/sim/out/calibration-report-YYYYMMDD.json
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
}

module.exports = { register };
