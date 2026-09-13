'use strict';
// corpus-resolve-daemon.cjs — 到期自动 resolve 调度（2026-09-13 调度棒）
// 用法：node p1b/scripts/corpus-resolve-daemon.cjs --once [--due-only] [--confirm]
//      node p1b/scripts/corpus-resolve-daemon.cjs --loop --interval=60 [--due-only] [--confirm]
// 安全四则：①不改 corpus-resolve.cjs（运行时抽取其 RESOLVERS；抽取失败退回 spawn 原脚本）
//          ②网络失败跳过不写 ③账本不可变（resolvePrediction 拒改已 resolve）④默认 dry-run，--confirm 才写库
// 日志：追加 p1b/sim/out/resolve-daemon.log（含时间戳与本轮 resolved/pending/fail 计数）
const fs = require('fs'), path = require('path'), cp = require('child_process');
const args = process.argv.slice(2);
const has = (f) => args.indexOf(f) !== -1;
const val = (f, d) => { const a = args.filter((x) => x.indexOf(f + '=') === 0)[0]; return a ? a.slice(f.length + 1) : d; };
const LOOP = has('--loop');
const CONFIRM = has('--confirm');
const DUE_ONLY = has('--due-only');
const INTERVAL_MIN = Math.max(1, Number(val('--interval', 60)) || 60);
const ROOT = path.join(__dirname, '..', '..');
const LOG = path.join(ROOT, 'p1b', 'sim', 'out', 'resolve-daemon.log');
const RESOLVE_SRC = path.join(__dirname, 'corpus-resolve.cjs');
function ts() { return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).replace(' ', 'T') + '+08:00'; }
function today() { return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).slice(0, 10); }
function log(line) {
  const l = '[' + ts() + '] ' + line;
  console.log(l);
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, l + '\n', 'utf8'); } catch (e) { console.error('LOG-FAIL ' + e.message); }
}
