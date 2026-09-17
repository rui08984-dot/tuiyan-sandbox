#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/odds-probe.cjs —— The Odds API 探活 ＋ 历史可得性实测（2026-09-17）
 *
 * 依据：`docs/specs/第二期广域普查-体育赔率接入草案-20260917.md` **§5「拿 key 后的第一步（预设命令）」**：
 *   ① 探活 `GET /v4/sports`（确认 key 生效）→ 记录可用运动会清单；
 *   ② 探 `/v4/historical/...` 端点（**免费层是否开放历史 ＝ 接入成败关键**）：不可得 ⇒ 只做前瞻出题。
 * 纪律：**零账本写／零落盘**（除可选 --json）／**key 绝不出现在任何输出**（只回显脱敏）／只读外部 API。
 * 配置：`p1a-terminal/config/odds.json`（gitignored，铁律⑤；可用 env ODDS_CONFIG 覆盖）。
 * 用法：node p1b/scripts/odds-probe.cjs [--json <out>] [--no-historical]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const CFG = process.env.ODDS_CONFIG || path.join(ROOT, 'p1a-terminal', 'config', 'odds.json');
const JSON_OUT = arg('json', null);
const SKIP_HIST = process.argv.indexOf('--no-historical') !== -1;
const mask = (s) => (s && s.length > 6 ? s.slice(0, 3) + '***' + s.slice(-2) + '（len=' + s.length + '）' : '(过短/缺失)');

/** 单次 GET：返回 {status, headers(限配额相关), json 或 err}；key 只进 URL、不进日志。 */
async function get(url) {
  try {
    const res = await fetch(url);
    const h = {};
    for (const k of ['x-requests-remaining', 'x-requests-used', 'x-requests-last']) { const v = res.headers.get(k); if (v !== null) h[k] = v; }
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { status: res.status, headers: h, body: body };
  } catch (e) { return { status: null, headers: {}, body: null, err: String(e.message || e) }; }
}

(async () => {
  console.log('=== The Odds API 探活（key 不出明文；零写库）===');
  console.log('配置路径: ' + CFG);
  if (!fs.existsSync(CFG)) { console.log('状态: 未配置（n/a）——申请路径：the-odds-api.com → 注册 → API key；落 {"api_key":"..."}'); process.exitCode = 2; return; }
  let cfg = null; try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch (e) { cfg = null; }
  const key = cfg && (cfg.api_key || cfg.key || cfg.ODDS_API_KEY);
  if (!key) { console.log('状态: 配置存在但无 api_key 字段'); process.exitCode = 2; return; }
  console.log('key: ' + mask(key) + '（tier=' + (cfg.tier || '?') + '）');
  const BASE = cfg.base_url || 'https://api.the-odds-api.com/v4';

  // ① 探活 /v4/sports
  const s = await get(BASE + '/sports/?apiKey=' + encodeURIComponent(key));
  const sports = Array.isArray(s.body) ? s.body : null;
  const active = sports ? sports.filter((x) => x.active) : [];
  console.log('① /v4/sports: HTTP ' + s.status + (s.err ? '（' + s.err + '）' : '')
    + '｜运动会 ' + (sports ? sports.length + '（active ' + active.length + '）' : 'n/a')
    + '｜配额头 ' + JSON.stringify(s.headers));
  if (active.length) console.log('   active 清单: ' + active.map((x) => x.key).join(', '));

  // ② 历史端点可得性（草案 §5② ：免费层是否开放历史 ＝ 接入成败关键）
  let hist = { tried: false };
  if (!SKIP_HIST && sports) {
    const sample = active.find((x) => /soccer/.test(x.key)) || active[0];
    if (sample) {
      // 历史端点需 ISO 时间戳；取一个明显早于今天的日期（前一日 12:00Z）
      const d = new Date(Date.now() - 24 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
      const url = BASE + '/historical/sports/' + sample.key + '/odds/?apiKey=' + encodeURIComponent(key) + '&regions=eu&markets=h2h&date=' + encodeURIComponent(d);
      const h = await get(url);
      const okHist = h.status === 200;
      hist = { tried: true, sport: sample.key, date: d, status: h.status,
        available: okHist, headers: h.headers,
        note: okHist ? '历史端点可用（可回溯出历史题）'
          : (h.status === 401 || h.status === 403 ? 'HTTP ' + h.status + ' ⇒ 免费层未开放历史（只能前瞻出题：今日起攒样本）'
            : 'HTTP ' + h.status + ' ⇒ 历史可得性未定（须复核参数/计划）') };
      console.log('② /v4/historical/sports/' + sample.key + '/odds: HTTP ' + h.status
        + '（date=' + d + '）⇒ ' + hist.note + '｜配额头 ' + JSON.stringify(h.headers));
    }
  } else if (SKIP_HIST) console.log('② 历史端点：本跑已跳过（--no-historical）');

  // ③ 结论与配额
  const remain = Number(s.headers['x-requests-remaining'] ?? NaN);
  console.log('③ 配额：剩余 ' + (isFinite(remain) ? remain : 'n/a') + '（免费层 500/月）'
    + '｜草案定策＝降频每 3 日一次快照（≈10 req/日 ⇒ 月 ≈300，余量 40%）');
  console.log('   探活=' + (s.status === 200 ? 'PASS' : 'FAIL') + '｜历史可得=' + (hist.tried ? hist.available : 'n/a'));

  if (JSON_OUT) {
    fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
    fs.writeFileSync(JSON_OUT, JSON.stringify({
      script: 'p1b/scripts/odds-probe.cjs', generated_at: new Date().toISOString(),
      principle: 'docs/specs/第二期广域普查-体育赔率接入草案-20260917.md §5', discipline: { ledger_write: false, key_echoed: false },
      config_path: CFG, key_masked: mask(key), tier: cfg.tier || null,
      sports: { status: s.status, total: sports ? sports.length : null, active: active.map((x) => x.key), headers: s.headers },
      historical: hist,
      quota_plan: { tier: 'free', limit_per_month: 500, policy: '降频：每 3 日一次快照（≈10 req/日 ⇒ 月 ≈300）', decided: '2026-09-17' },
    }, null, 1), 'utf8');
    console.log('json -> ' + JSON_OUT);
  }
})();
