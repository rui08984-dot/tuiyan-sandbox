'use strict';
// 口径B 微步2：g2-report.cjs additive 接线补丁（锚点唯一性守卫；LF 保持；改前自动备份 .bd-bak）
const fs = require('fs');
const F = 'E:/music player/p1b/scripts/g2-report.cjs';
const BAK = 'E:/music player/p1b/scripts/_bd-g2report.bd-bak.cjs';
const LF = String.fromCharCode(10);
let src = fs.readFileSync(F, 'utf8');
if (!src.includes('date_derivations 换算器')) fs.copyFileSync(F, BAK); // 首跑：备份基线
fs.copyFileSync(BAK, F); // 每次从基线重打（幂等）
src = fs.readFileSync(F, 'utf8');
const reps = [];
function rep(anchor, replacement, label) {
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error('锚点非唯一或缺失(' + n + '): ' + label);
  src = src.replace(anchor, replacement);
  reps.push(label);
}
// ── P1: 换算器（loader + 纯函数）插在 db 句柄之后；尾部留 __P2__ 占位 ──
const BLOCK1 = "const one = (s) => db.prepare(s).get();" + LF + LF
+ "// ── 口径 B（2026-09-14 · 微步 2）：date_derivations 换算器（additive；依微步 1 契约表扩展）──" + LF
+ "// 行为: resolve.date 存在→原样（现状不变）；缺失→按 kind 查规则换算 effective_date 入池；" + LF
+ "//       有规则但换算失败→仍排除＋计数 failed（不静默丢）；无规则→维持 no_resolve_date。" + LF
+ "const DD_FILE = path.join(ROOT, 'p1b', 'sim', 'out', 'g2-contract-frozen-r4.json');" + LF
+ "const DD_VERSION = '2026-09-14';" + LF
+ "const countsDD = { enabled: false, version: DD_VERSION, file: DD_FILE, sha256: null, previous_sha256: null, rules: 0," + LF
+ "  derived_rows: 0, derived_by_kind: {}, failed_rows: 0, failed_by_kind: {}, failed_ids_sample: [] };" + LF
+ "function loadDateDerivations() {" + LF
+ "  try {" + LF
+ "    const buf = fs.readFileSync(DD_FILE);" + LF
+ "    countsDD.sha256 = require('crypto').createHash('sha256').update(buf).digest('hex');" + LF
+ "    const doc = JSON.parse(buf.toString('utf8'));" + LF
+ "    const rules = doc.date_derivations || {};" + LF
+ "    countsDD.enabled = Object.keys(rules).length > 0;" + LF
+ "    countsDD.rules = Object.keys(rules).length;" + LF
+ "    countsDD.previous_sha256 = doc.previous_sha256 || null;" + LF
+ "    return rules;" + LF
+ "  } catch (e) { countsDD.error = '契约表加载失败: ' + e.message; return {}; }" + LF
+ "}" + LF
+ "const DD_RULES = loadDateDerivations();" + LF
+ "const ddPad2 = (n) => String(n).padStart(2, '0');" + LF
+ "function ddAddDays(ds, n) { const t = new Date(ds + 'T00:00:00Z').getTime(); return isNaN(t) ? null : new Date(t + n * 86400000).toISOString().slice(0, 10); }" + LF
+ "function ddMonthlyNextEnd(s) { const m = /^([0-9]{4})-([0-9]{2})$/.exec(s); if (!m) return null;" + LF
+ "  const y = Number(m[1]), mo = Number(m[2]); if (mo < 1 || mo > 12) return null;" + LF
+ "  let ny = y, nm = mo + 1; if (nm > 12) { nm = 1; ny++; }" + LF
+ "  return ny + '-' + ddPad2(nm) + '-' + ddPad2(new Date(Date.UTC(ny, nm, 0)).getUTCDate()); }" + LF
+ "function ddEpiweek(s) { const m = /^([0-9]{4})([0-9]{2})$/.exec(s); if (!m) return null;" + LF
+ "  const y = Number(m[1]), n = Number(m[2]); if (n < 1 || n > 53) return null;" + LF
+ "  const dow = new Date(Date.UTC(y, 0, 4)).getUTCDay(); // 1月4日星期（周日=0）；MMWR 第1周=含1/4、周日起始" + LF
+ "  const s1 = ddAddDays(y + '-01-04', 6 - dow); return s1 ? ddAddDays(s1, (n - 1) * 7) : null; } // S1=第1周周六" + LF
+ "function ddBomWeek(s) { const m = /^([0-9]{4})W([0-9]{2})$/.exec(s); if (!m) return null;" + LF
+ "  const n = Number(m[2]); if (n < 1 || n > 53) return null;" + LF
+ "  return ddAddDays(m[1] + '-01-04', (n - 1) * 7); } // BOM 周末末日=年内第 NN 个周日（2026 W1 末=01-04，微步1 网页实测）" + LF
+ "function ddDraw(s) { // 锚期反推（仅 2026 年段有锚，跨年需新锚——微步1 收据）：7位=SSQ 日/二/四；5位=DLT 一/三/六" + LF
+ "  const cfg = { 7: { yl: 4, issue: 106, date: '2026-09-13', offs: [0, 2, 4] }, 5: { yl: 2, issue: 105, date: '2026-09-14', offs: [0, 2, 5] } }[s.length];" + LF
+ "  if (!cfg) return null;" + LF
+ "  const y = Number(s.slice(0, cfg.yl)); if (y !== 2026) return null;" + LF
+ "  const k = Number(s.slice(cfg.yl)) - cfg.issue;" + LF
+ "  return ddAddDays(cfg.date, Math.floor(k / 3) * 7 + cfg.offs[((k % 3) + 3) % 3]); }" + LF;
rep("const one = (s) => db.prepare(s).get();", BLOCK1, 'P1');
// ── P2: ROWS_SQL 增列 rj（整段 resolve JSON，供 kind/source_key 取值）──
const RDLINE = '  + "(SELECT json_extract(e.value,' + String.fromCharCode(39) + '$.resolve.date' + String.fromCharCode(39) + ') FROM json_each(p.evidence_json) e WHERE json_extract(e.value,' + String.fromCharCode(39) + '$.resolve.date' + String.fromCharCode(39) + ') IS NOT NULL LIMIT 1) AS rd, "';
const RJLINE = '  + "(SELECT e.value FROM json_each(p.evidence_json) e WHERE json_extract(e.value,' + String.fromCharCode(39) + '$.resolve.kind' + String.fromCharCode(39) + ') IS NOT NULL LIMIT 1) AS rj, "';
rep(RDLINE, RDLINE + LF + RJLINE, 'P2');
fs.writeFileSync(F, src, 'utf8');
console.log('PATCHED ok: ' + reps.join(','));
