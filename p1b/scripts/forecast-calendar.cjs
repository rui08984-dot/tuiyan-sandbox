#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/forecast-calendar.cjs —— P0-U7 · 待验证队列日历（2026-09-16）
 *
 * 依据：【13】§二 U7。委托链＝spawn 子进程跑 `corpus-resolve-daemon.cjs --report-due`
 *   （daemon main() 无条件执行 ⇒ **不可 require**，spawn 是唯一零接触复用方式），
 *   再只读库取每行 matures_at，与证据侧到期日**逐行比对**（只披露不裁决谁对）。
 * 纪律：零账本写（库只读 readOnly）；本脚本无任何写库参数/路径；文案过禁词黑名单（铁律②）。
 * 用法：
 *   node p1b/scripts/forecast-calendar.cjs [--db <path>] [--out-dir <dir>]
 *        [--due-json <path>]      # 用现成 due.json（跳过 spawn；测试隔离用）
 *        [--daemon-cmd <path>]    # 换 daemon 实现（测试用桩；默认真 daemon）
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }

const DB_PATH = arg('db', path.join(ROOT, 'p1a-terminal', 'data', 'p1a.db'));
const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));
const DUE_JSON = arg('due-json', null);
const FORCE_SPAWN = process.argv.indexOf('--spawn') !== -1;
const DAEMON = arg('daemon-cmd', path.join(ROOT, 'p1b', 'scripts', 'corpus-resolve-daemon.cjs'));
const DAEMON_DUE = path.join(ROOT, 'p1b', 'sim', 'out', 'resolve-daemon.due.json');

// ── 证据侧到期日规则（**同源副本**：照 corpus-resolve-daemon.cjs L47-64 dueOf 的前 8 条可复制规则；
//    infer:* 两族依赖 daemon 内置彩票日历数据，本脚本**不重算**、如实标注为"由 daemon 侧推断"）──
function monthEndPlusOne(ym) { const y = Number(String(ym).slice(0, 4)), mo = Number(String(ym).slice(5, 7)); return mo === 12 ? (y + 1) + '-01-01' : y + '-' + String(mo + 1).padStart(2, '0') + '-01'; }
function addDays(d, n) { const t = new Date(String(d) + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function evidenceDueOf(e0) {
  const r = (e0 && e0.resolve) || {};
  let m = {}; try { m = JSON.parse((e0 && e0.meta) || '{}'); } catch (e) { m = {}; }
  const k = String(r.kind || '');
  if (m.expectDate) return { due: m.expectDate, src: 'meta.expectDate' };
  if (m.eventDate) return { due: m.eventDate, src: 'meta.eventDate' };
  if (r.date) return { due: r.date, src: 'resolve.date' };
  if (r.period) return { due: monthEndPlusOne(r.period), src: 'period+1mo' };
  if (r.month) return { due: monthEndPlusOne(r.month), src: 'month+1mo' };
  if (m.expectMonth) return { due: m.expectMonth + '-01', src: 'meta.expectMonth' };
  if (r.week_end && k === 'github_weekly_commits') return { due: addDays(r.week_end, 1), src: 'week_end+1d' };
  if (r.end && k === 'npm_downloads_window') return { due: addDays(r.end, 1), src: 'end+1d' };
  if (k.indexOf('cwl') === 0 && r.issue) return { due: null, src: 'infer:*（daemon 侧推断，本脚本不重算）' };
  if (k === 'dlt_draw_result' && r.issue) return { due: null, src: 'infer:*（daemon 侧推断，本脚本不重算）' };
  return { due: null, src: 'undatable' };
}

function main() {
  // ① 三段链第一步：spawn daemon --report-due（显式 --due-json 时默认跳过；--spawn 强制走委托链）
  let duePath = DUE_JSON;
  if (!duePath || FORCE_SPAWN) {
    execFileSync(process.execPath, [DAEMON, '--report-due'], { cwd: ROOT, stdio: 'inherit' });
    if (!duePath) duePath = DAEMON_DUE;
  }
  const due = JSON.parse(fs.readFileSync(duePath, 'utf8'));

  // ② 只读库：逐行取 matures_at ＋ 证据侧规则重算
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const rows = db.prepare("SELECT p.id, p.matures_at, p.evidence_json FROM predictions p JOIN games g ON g.id = p.game_id WHERE g.game_type LIKE 'corpus%' AND p.outcome IS NULL ORDER BY p.id").all();
  db.close();

  const today = new Date().toISOString().slice(0, 10);
  const dayN = (d) => Math.floor((Date.parse(d + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
  const b = { d0_7: {}, d8_30: {}, gt30: 0, undatable: 0 };
  const dual = { agree: 0, mismatch_n: 0, mismatch: [], ledger_only_n: 0, ledger_only: [], evidence_only_n: 0, evidence_only: [], both_none: 0 };
  const srcCount = {}; const kindCount = {};
  const undatableIds = [];
  for (const r of rows) {
    const ledger = r.matures_at ? String(r.matures_at).slice(0, 10) : null;
    let ev = []; try { ev = JSON.parse(r.evidence_json || '[]'); } catch (e) { ev = []; }
    const ed = evidenceDueOf(ev[0] || {});
    const kind = String((((ev[0] || {}).resolve) || {}).kind || '');
    kindCount[kind] = (kindCount[kind] || 0) + 1;
    srcCount[ed.src] = (srcCount[ed.src] || 0) + 1;
    // 桶（账本侧 matures_at；主口径）
    if (!ledger) { b.undatable++; undatableIds.push({ id: r.id, kind: kind, evidence_src: ed.src }); }
    else {
      const n = dayN(ledger);
      if (n <= 7) b.d0_7[ledger] = (b.d0_7[ledger] || 0) + 1;
      else if (n <= 30) { const wk = ledger.slice(0, 10); b.d8_30[wk] = (b.d8_30[wk] || 0) + 1; }
      else b.gt30++;
    }
    // 双源逐行比对（只披露不裁决）
    if (ledger && ed.due) { if (ledger === ed.due) dual.agree++; else { dual.mismatch_n++; if (dual.mismatch.length < 50) dual.mismatch.push({ id: r.id, ledger: ledger, evidence: ed.due, src: ed.src }); } }
    else if (ledger && !ed.due) { dual.ledger_only_n++; if (dual.ledger_only.length < 50) dual.ledger_only.push({ id: r.id, ledger: ledger, evidence_src: ed.src }); }
    else if (!ledger && ed.due) { dual.evidence_only_n++; if (dual.evidence_only.length < 50) dual.evidence_only.push({ id: r.id, evidence: ed.due, src: ed.src }); }
    else dual.both_none++;
  }
  // 双源**桶级**比对（账本侧 byDay vs daemon due.json byDay；只披露差异日）
  const dueByDay = due.byDay || {};
  const ledgerByDay = {};
  for (const r of rows) { if (!r.matures_at) continue; const d = String(r.matures_at).slice(0, 10); ledgerByDay[d] = (ledgerByDay[d] || 0) + 1; }
  const days = Array.from(new Set(Object.keys(ledgerByDay).concat(Object.keys(dueByDay)))).sort();
  const bydayDiff = days.filter((d) => (ledgerByDay[d] || 0) !== (dueByDay[d] || 0)).map((d) => ({ day: d, ledger: ledgerByDay[d] || 0, evidence_daemon: dueByDay[d] || 0 }));

  const report = {
    script: 'p1b/scripts/forecast-calendar.cjs', title: '待验证队列日历',
    db: DB_PATH, due_json: duePath, today: today,
    basis: '账本侧＝predictions.matures_at（只读）；证据侧＝daemon dueOf 规则同源副本（前 8 条可复制规则；infer:* 不重算如实标注）',
    rows: rows.length,
    buckets: { day_window: b.d0_7, week_window: b.d8_30, gt30: b.gt30, undatable_ledger: b.undatable },
    conservation: { sum: Object.keys(b.d0_7).reduce((s, k) => s + b.d0_7[k], 0) + Object.keys(b.d8_30).reduce((s, k) => s + b.d8_30[k], 0) + b.gt30 + b.undatable, rows: rows.length },
    undatable_ids: undatableIds.slice(0, 50),
    dual_source_row: { agree: dual.agree, mismatch_n: dual.mismatch_n, mismatch_show: dual.mismatch, ledger_only_n: dual.ledger_only_n, ledger_only_show: dual.ledger_only, evidence_only_n: dual.evidence_only_n, evidence_only_show: dual.evidence_only, both_none: dual.both_none, rule: '只披露不裁决（对齐 daemon「refused 只记差异」语义）；差异 >10% 触发人工对账而非自动改数' },
    dual_source_bucket: { ledger_by_day_n: Object.keys(ledgerByDay).length, evidence_by_day_n: Object.keys(dueByDay).length, diff_days: bydayDiff.length, diff: bydayDiff.slice(0, 50) },
    evidence_src_counts: srcCount, by_kind: kindCount,
    disclaimer: '本件为只读披露（非判据）；账本零写；数字随时间自然漂移（今日快照）',
    generated_at: new Date().toISOString(),
  };

  const md = [];
  md.push('# 待验证队列日历（' + today + '）');
  md.push('');
  md.push('> 口径：' + report.basis + '。**只披露不裁决**；本件不构成任何能力宣称。');
  md.push('');
  md.push('## ① 未来 7 天（逐日，账本侧 matures_at）');
  const d7 = Object.keys(b.d0_7).sort();
  if (d7.length) for (const k of d7) md.push('- ' + k + '：' + b.d0_7[k] + ' 条');
  else md.push('- （窗口内无到期）');
  md.push('');
  md.push('## ② 8–30 天（按到期日）');
  const d30 = Object.keys(b.d8_30).sort();
  if (d30.length) for (const k of d30) md.push('- ' + k + '：' + b.d8_30[k] + ' 条');
  else md.push('- （窗口内无到期）');
  md.push('');
  md.push('## ③ 30 天以上与不可定到期');
  md.push('- 30 天以上：' + b.gt30 + ' 条');
  md.push('- 无 matures_at（不可定）：' + b.undatable + ' 条' + (undatableIds.length ? '（含 ' + JSON.stringify(undatableIds.slice(0, 5)) + '…）' : ''));
  md.push('');
  md.push('## ④ 双源比对（账本 matures_at ↔ 证据规则；**只披露不裁决**）');
  md.push('- 逐行：一致 ' + dual.agree + ' ｜ 不一致 ' + dual.mismatch_n + ' ｜ 仅账本 ' + dual.ledger_only_n + ' ｜ 仅证据 ' + dual.evidence_only_n + ' ｜ 两无 ' + dual.both_none);
  md.push('- 桶级（对比 daemon due.json）：' + bydayDiff.length + ' 个日桶有差异' + (bydayDiff.length ? '（例 ' + JSON.stringify(bydayDiff.slice(0, 5)) + '）' : ''));
  if (dual.mismatch.length) md.push('- 不一致明细（前 10）：' + JSON.stringify(dual.mismatch.slice(0, 10)));
  md.push('');
  md.push('## ⑤ 来源分布');
  md.push('- 证据侧到期来源：' + JSON.stringify(srcCount));
  md.push('- 未解题 kind 数：' + Object.keys(kindCount).length + ' 类');
  md.push('');
  md.push('- 守恒自检：' + JSON.stringify(report.conservation) + '（各桶之和=总行数）');
  md.push('');
  md.push('（零账本写 · 只读披露件 · ' + report.disclaimer + '）');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jf = path.join(OUT_DIR, 'forecast-calendar-' + today.replace(/-/g, '') + '.json');
  const mf = path.join(OUT_DIR, 'forecast-calendar-' + today.replace(/-/g, '') + '.md');
  fs.writeFileSync(jf, JSON.stringify(report, null, 1), 'utf8');
  fs.writeFileSync(mf, md.join('\n') + '\n', 'utf8');
  console.log('=== 待验证队列日历（P0-U7）===');
  console.log('未解 ' + rows.length + ' ｜ 7 天内 ' + report.conservation.sum + ' 桶和自检 ' + (report.conservation.sum === rows.length ? 'OK' : 'FAIL') + ' ｜ 双源桶差异日 ' + bydayDiff.length);
  console.log('json -> ' + jf);
  console.log('md   -> ' + mf);
  return 0;
}

module.exports = { evidenceDueOf: evidenceDueOf, monthEndPlusOne: monthEndPlusOne, addDays: addDays };
if (require.main === module) { process.exitCode = main(); }
