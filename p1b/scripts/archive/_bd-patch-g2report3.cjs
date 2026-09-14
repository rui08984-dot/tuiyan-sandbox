'use strict';
// 口径B 微步2 补丁3：补 tryDerive（微步2 主补丁遗漏的派发函数）
const fs = require('fs');
const F = 'E:/music player/p1b/scripts/g2-report.cjs';
let src = fs.readFileSync(F, 'utf8');
if (src.includes('function tryDerive(r)')) { console.log('already patched'); process.exit(0); }
const LF = String.fromCharCode(10);
const anchor = "  return ddAddDays(cfg.date, Math.floor(k / 3) * 7 + cfg.offs[((k % 3) + 3) % 3]); }";
const n = src.split(anchor).length - 1;
if (n !== 1) throw new Error('锚点非唯一或缺失(' + n + ')');
const BLOCK = anchor + LF
+ "function tryDerive(r) {" + LF
+ "  let kind = null, resolve = null;" + LF
+ "  try { if (r.rj) { const o = JSON.parse(r.rj); resolve = o.resolve || null; kind = resolve ? resolve.kind : null; } }" + LF
+ "  catch (e) { return { ok: false, kind: null, reason: 'resolve_json_parse' }; }" + LF
+ "  if (!kind) return { ok: false, kind: null, reason: 'no_kind' };" + LF
+ "  const rule = DD_RULES[kind];" + LF
+ "  if (!rule) return { ok: false, kind: kind, reason: 'no_rule' };" + LF
+ "  const sv = resolve[rule.source_key];" + LF
+ "  if (sv === undefined || sv === null) return { ok: false, kind: kind, reason: 'source_key_missing:' + rule.source_key };" + LF
+ "  const s = String(sv); let out = null;" + LF
+ "  if (rule.granularity === 'daily') out = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s) ? s : null;" + LF
+ "  else if (rule.granularity === 'monthly') out = ddMonthlyNextEnd(s);" + LF
+ "  else if (rule.granularity === 'yearly') out = /^[0-9]{4}$/.test(s) ? (Number(s) + 1) + '-12-31' : null;" + LF
+ "  else if (rule.granularity === 'weekly') { // 按源值格式分流：YYYYWW=MMWR周六；YYYYWNN=BOM 周日末日；日期=窗口末日(+6)" + LF
+ "    if (/^[0-9]{6}$/.test(s)) out = ddEpiweek(s);" + LF
+ "    else if (/^[0-9]{4}W[0-9]{2}$/.test(s)) out = ddBomWeek(s);" + LF
+ "    else if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)) out = ddAddDays(s, 6);" + LF
+ "  } else if (rule.granularity === 'draw') out = ddDraw(s);" + LF
+ "  if (!out) return { ok: false, kind: kind, reason: 'derive_failed:' + rule.granularity + ':' + s };" + LF
+ "  return { ok: true, kind: kind, date: out };" + LF
+ "}";
src = src.replace(anchor, BLOCK);
fs.writeFileSync(F, src, 'utf8');
console.log('PATCH3 ok: tryDerive inserted');
