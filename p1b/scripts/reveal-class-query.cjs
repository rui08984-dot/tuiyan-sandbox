#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/reveal-class-query.cjs —— 「这事该归哪一类」只读查询件（2026-09-30 · MCP 缺口第 ③ 组）
 *
 * ── 为什么有这件 ────────────────────────────────────────────────────────────
 *   「到期未解的题，机器能自己结 / 要人答 / 永远结不了」这条分流判据一直是**内部**的
 *   （`p1b/src/evidence/revealClass.js`），只经 `p1b/src/routes/disclosure.js` 露面，
 *   而该路由这一批不许动（另两轨在动）⇒ 外面没有任何东西能问「这个 kind 归哪一类」。
 *   本件把那**同一张表**原样端出来，不新增判据、不另立实现。
 *
 * ── 判据单一真源（照抄，不重写）────────────────────────────────────────────
 *   分类      ：`revealClass.classifyReveal`（ok / human / stuck 三类互斥且完备）
 *   支持与可达：`resolveKind.isSupportedKind`（契约表 ∪ aliases ∪ REVEAL_CLASS 的并集派生）
 *   ★本件**不复制任何一条判定**，只是把这两件已有的导出结果打印出来。
 *
 * ── 纪律 ────────────────────────────────────────────────────────────────────
 *   · **只读**：不碰 p1a.db（连只读句柄都不开）、零写盘、零网络。
 *   · **不编数**：契约表读不到就照实说读不到（`resolveKind.readContract` 自己会抛，
 *     本件不吞成「全部可达」——放行等于把今天的病原样留在库里）。
 *   · **禁词**：stdout 会被 MCP 逐位透传成对外文案，故不得出现「预测」二字。
 *
 * 用法：
 *   node p1b/scripts/reveal-class-query.cjs                     # 全表摘要
 *   node p1b/scripts/reveal-class-query.cjs --kind <kind>       # 查一个
 *   node p1b/scripts/reveal-class-query.cjs --kind <kind> --json
 *   node p1b/scripts/reveal-class-query.cjs --json              # 全表（机器读）
 *
 * 退出码：0 有答案（含「未登记 ⇒ 保守按需人确认」）｜2 用法错｜1 契约表读不到
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const revealClass = require(path.join(ROOT, 'p1b', 'src', 'evidence', 'revealClass.js'));
const resolveKind = require(path.join(ROOT, 'p1b', 'src', 'evidence', 'resolveKind.js'));

/** 本 CLI 自己的退出码表（与 `p1b/cli/index.cjs` 的 EXIT 同名不同表，见文件头）。 */
const EXIT = { OK: 0, ERR: 1, USAGE: 2 };

function argOf(name) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v === undefined || v.slice(0, 2) === '--' ? null : v;
}
const AS_JSON = process.argv.indexOf('--json') >= 0;

const KNOWN_FLAGS = ['--kind', '--json'];
for (let i = 2; i < process.argv.length; i++) {
  const t = process.argv[i];
  if (KNOWN_FLAGS.indexOf(t) < 0) {
    process.stderr.write('✗ 未知参数：' + t + '（本件只认 --kind <kind> 与 --json）\n');
    process.exit(EXIT.USAGE);
  }
  // ★带值的开关要把它的值跳过，否则 `--kind foo` 里的 `foo` 会被当成未知参数打红。
  if (t === '--kind') i += 1;
}

const CLASS_ZH = { ok: '机器能自动结（到期守护进程自己去查）', human: '要人答（机器拿不到，但人能答）', stuck: '永远结不了（接口封禁／真值窗口已滑出）' };

/** 支持表（派生）。读不到就抛，由调用方照实报——**不静默放行**。 */
function supported() {
  const kinds = resolveKind.supportedKinds();
  return new Set(kinds);
}

function buildOne(kind, sup) {
  const c = revealClass.classifyReveal(kind);
  return {
    kind: c.kind,
    cls: c.c,
    cls_zh: CLASS_ZH[c.c] || c.c,
    note: c.note,
    registered_in_reveal_class: Object.prototype.hasOwnProperty.call(revealClass.REVEAL_CLASS, kind),
    supported_kind: sup.has(kind),
  };
}

let sup;
try {
  sup = supported();
} catch (e) {
  process.stderr.write('✗ 冻结契约表读不到（' + (e && e.message ? e.message : String(e)) + '）\n'
    + '  ⇒ 本次**不给任何「可达/不可达」结论**：放行等于把今天的病原样留在库里。\n');
  process.exit(EXIT.ERR);
}

const kind = argOf('kind');
const out = { script: 'p1b/scripts/reveal-class-query.cjs', generated_at: new Date().toISOString() };

if (kind) {
  out.one = buildOne(kind, sup);
  if (AS_JSON) {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exit(EXIT.OK);
  }
  const o = out.one;
  const L = [];
  L.push('kind      ：' + o.kind);
  L.push('归哪一类  ：' + o.cls + ' —— ' + o.cls_zh);
  L.push('理由      ：' + o.note);
  L.push('登记情况  ：' + (o.registered_in_reveal_class ? '已登记在揭晓分流表里' : '★未登记 ⇒ 保守按「要人答」处理'));
  L.push('支持情况  ：' + (o.supported_kind ? '在支持表内（契约表 ∪ aliases ∪ 揭晓分流表）' : '★不在支持表内 ⇒ 落注端点会拒它'));
  L.push('');
  L.push('★本件只做分类与可达性查询：不替你把一句话归到 L1–L6（那是接题端点的事），');
  L.push('  也不查这道题今天会不会发生。');
  process.stdout.write(L.join('\n') + '\n');
  process.exit(EXIT.OK);
}

// ── 全表摘要 ──
const all = Object.keys(revealClass.REVEAL_CLASS).sort();
out.total = all.length;
out.by_class = { ok: 0, human: 0, stuck: 0 };
out.kinds = all.map((k) => {
  const o = buildOne(k, sup);
  out.by_class[o.cls] += 1;
  return o;
});
out.unsupported = out.kinds.filter((o) => !o.supported_kind).map((o) => o.kind);
out.not_registered_elsewhere = sup.size;

if (AS_JSON) {
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(EXIT.OK);
}

const L = [];
L.push('揭晓分流表（kind 的取数能力登记 · 单一真源 p1b/src/evidence/revealClass.js）');
L.push('  合计 ' + out.total + ' 条｜ok ' + out.by_class.ok + '｜human ' + out.by_class.human + '｜stuck ' + out.by_class.stuck);
L.push('  支持表（契约 ∪ aliases ∪ 本表）共 ' + out.not_registered_elsewhere + ' 条；本表里不在支持表的：'
  + (out.unsupported.length ? out.unsupported.join('、') : '无'));
L.push('');
for (const cls of ['ok', 'human', 'stuck']) {
  L.push('── ' + cls + '：' + CLASS_ZH[cls] + ' ──');
  for (const o of out.kinds.filter((k) => k.cls === cls)) {
    L.push('  ' + o.kind.padEnd(30) + (o.supported_kind ? '' : ' ★不在支持表') + '  ' + o.note);
  }
  L.push('');
}
L.push('★三类互斥且完备：每个到期未解的题必属其一（分类依据＝kind 的取数能力，不是运行时日志——那没落库）。');
L.push('★「永远结不了」的不给可点按钮：给假按钮比不给更糟。');
process.stdout.write(L.join('\n') + '\n');
process.exit(EXIT.OK);
