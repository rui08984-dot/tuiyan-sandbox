'use strict';
// 合并 可机检段 + 代理语义段 → p1b/sim/out/g2-audit-r4.json（零写库）
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const machine = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit-machine.json'), 'utf8'));
const sem = {};
for (const line of fs.readFileSync(path.join(__dirname, 'semantic.tsv'), 'utf8').split(/\r?\n/)) {
  if (!line.trim() || line.startsWith('#')) continue;
  const parts = line.split('|');
  if (parts.length !== 3) continue;
  sem[Number(parts[0])] = { pass: parts[1] === 'PASS', reason: parts[2] };
}
const items = [];
for (const m of machine.machine) {
  const s = sem[m.id];
  if (!s) throw new Error('semantic missing for id ' + m.id);
  const machinePass = !!m.pass;
  const pass = machinePass && s.pass;
  const machineReasons = [];
  if (!m.resolve_present) machineReasons.push('resolve 缺失');
  if (!m.kind_ok) machineReasons.push('kind 缺失');
  if (!m.cmp) machineReasons.push('cmp 缺失');
  if (!m.slug_unique) machineReasons.push('slug 重复');
  if (m.unregistered_kind) machineReasons.push('未注册 kind（退回通用判据）');
  if (m.required_keys && m.missing_required && m.missing_required.length) machineReasons.push('缺契约键:' + m.missing_required.join(','));
  items.push({
    id: m.id, layer: m.layer, horizon: m.bucket, kind: m.kind, event_date: m.date ? m.date : null,
    base_rate: m.base_rate, machine: { pass: machinePass, resolve_present: m.resolve_present, kind_ok: m.kind_ok, date_ok: m.date, cmp_ok: m.cmp,
      registered_kind: m.registered_kind, unregistered_kind: m.unregistered_kind,
      required_keys: m.required_keys, missing_required: m.missing_required, contract_ok: m.contract_ok, contract_basis: m.contract_basis,
      url_ok: m.url, field_ok: m.field, threshold_ok: m.threshold, strict_four: m.strict_four,
      coverage_gap_4: m.coverage_gap_4, base_in_band: m.base_in_band,
      slug_present: m.slug_present, slug_unique: m.slug_unique, cutoff_ok: m.cutoff_ok, tautology_ok: m.tautology_ok,
      notes: machineReasons.length ? machineReasons : ['ok'] },
    semantic: s,
    pass: pass,
    verdict: pass ? 'PASS' : 'REJECT',
    reason: '机器段 ' + (machinePass ? ('PASS(契约:' + (m.required_keys || []).join('/') + ')') : ('REJECT[' + machineReasons.join(';') + ']'))
      + (m.coverage_gap_4 ? '〔④覆盖缺口:无 baseRateNote，不影响②〕' : '') + '；语义段 ' + (s.pass ? 'PASS' : 'REJECT') + '：' + s.reason
  });
}
const ok = items.filter((i) => i.pass).length;
const meta = {
  regime: 'R4', detail: '§4.2.1 细则 D（D-2 范围／D-3 三段式／D-4 诚实标注）',
  spec: 'docs/specs/2026-09-11-万物可预测性审计器-design.md §4.2.1',
  pool_n: machine.pool_n, sample_n: items.length, sample_rate: items.length / machine.pool_n,
  sampling: { method: '分层随机 layer×horizon；LCG 种子 987654321；每层 min 1；long 桶保底 ceil(10%)；层内按 id 稳定序 Fisher-Yates',
    strata: machine.alloc, long_ids: items.filter((i) => i.horizon === 'long').map((i) => i.id) },
  review_composition: { machine: 105, agent_semantic: 105, human_calibration: 14, user: 0 },
  honesty: '非全人工复核：机器段 105 题（脚本，按已注册 kind 契约）+ 代理判据语义段 105 题 + 人类校准段 14 题（队长，非端用户）+ 端用户 0 题。代理复核≠独立人类审计。',
  human_calibration_required: { min_n: 10, agree_threshold: 0.90, note: '按 D-3③：与代理语义段一致率 ≥90% 则采信 ② 段结果；否则按不一致率扩大人工比例。' },
  human_calibration_settlement: { record: 'p1b/sim/out/g2-human-calibration-r4.md', pre_fix_agreement: '5/14 = 0.357（<0.90 ⇒ 不采信旧代理段）',
    fix_applied: '机器段改为按已注册 kind 契约校验（8 条假阳性翻正）+ 语义段纠偏（缺 baseRateNote 记④覆盖缺口，不再归因 Q0-3）+ 1627 经源码证据判定',
    post_fix_alignment: '13/14：8 假阳性 + 4 顺延 + 1331 与队长一致；1627 本棒据源码判 PASS（队长暂判 REJECT 存疑）',
    pending: ['队长确认 1627', '（建议）按修正后规则重做一次人类校准以恢复采信'] },
  required_keys_table: machine.required_keys_table,
  registered_kinds_count: machine.registered_kinds.length,
  coverage_gap_4: { count: machine.machine.filter((m) => m.coverage_gap_4).length,
    ids: machine.machine.filter((m) => m.coverage_gap_4).map((m) => m.id),
    kinds: [...new Set(machine.machine.filter((m) => m.coverage_gap_4).map((m) => m.kind))],
    note: '缺 baseRateNote ⇒ ④ 难度覆盖缺口（不影响 ② 判定，也不等于 Q0-3）。' },
  machine_stats: { contract_pass: machine.machine.filter((m) => m.pass).length, contract_reject: machine.machine.filter((m) => !m.pass).length,
    strict_four_fields_pass: machine.machine.filter((m) => m.strict_four).length,
    unregistered_kind_rows: machine.machine.filter((m) => m.unregistered_kind).length },
  generated_at: new Date().toISOString()
};
const report = { meta: meta, human_calibration: { n: 14, agreed: 5, rate: 0.357, reviewer: '队长' }, summary: { n: items.length, pass: ok, reject: items.length - ok, rate: ok / items.length, threshold: 0.70, pass_gate: ok / items.length >= 0.70 }, items: items };
const outPath = path.join(ROOT, 'p1b', 'sim', 'out', 'g2-audit-r4.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 1), 'utf8');
const cl = [];
cl.push('# ② 抽检 · required-keys 契约 × 抽检样本对照（R4 · 2026-09-13）');
cl.push('');
cl.push('> 契约来源：corpus-resolve.cjs 已注册 kind（抽取 ' + meta.registered_kinds_count + ' 个）+ 全 R4 行观测键交集；未注册 kind 退回通用判据并标注。');
cl.push('> 用途：复核 machine 段逐题判据；required 为契约键，缺失 为空即契约满足。');
cl.push('');
cl.push('## 一 · required-keys 表（逐 kind，共 ' + Object.keys(machine.required_keys_table).length + ' 个）');
cl.push('| kind | n(全 R4 池) | required keys |');
cl.push('|---|---|---|');
for (const k of Object.keys(machine.required_keys_table).sort()) cl.push('| ' + k + ' | ' + machine.required_keys_table[k].n + ' | ' + machine.required_keys_table[k].required.join(', ') + ' |');
cl.push('');
cl.push('## 二 · 抽检样本对照（' + machine.machine.length + ' 条）');
cl.push('| id | kind | 注册 | required keys | 缺失 | machine | strict4 |');
cl.push('|---|---|---|---|---|---|---|');
for (const m of machine.machine) cl.push('| ' + m.id + ' | ' + m.kind + ' | ' + (m.registered_kind ? 'REG' : 'UNREG') + ' | ' + (m.required_keys || []).join(', ') + ' | ' + ((m.missing_required || []).join(', ') || '—') + ' | ' + (m.pass ? 'PASS' : 'REJECT') + ' | ' + (m.strict_four ? 'S4' : '-') + ' |');
cl.push('');
cl.push('## 三 · ④ 覆盖缺口（缺 baseRateNote，不影响 ②）');
cl.push('count=' + meta.coverage_gap_4.count + ' ｜ ids=' + meta.coverage_gap_4.ids.join(',') + ' ｜ kinds=' + meta.coverage_gap_4.kinds.join(','));
cl.push('');
cl.push('（对照表完 · 生成 ' + new Date().toISOString() + '）');
const contractPath = path.join(ROOT, 'p1b', 'sim', 'out', 'g2-audit-r4-contract.md');
fs.writeFileSync(contractPath, cl.join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8');
console.log('items=' + items.length + ' pass=' + ok + ' reject=' + items.length - ok + ' rate=' + (ok / items.length * 100).toFixed(1) + '%');
console.log('contract_pass=' + meta.machine_stats.contract_pass + ' reject=' + meta.machine_stats.contract_reject + ' strict4=' + meta.machine_stats.strict_four_fields_pass + ' unregistered=' + meta.machine_stats.unregistered_kind_rows);
console.log('coverage_gap_4=' + JSON.stringify(meta.coverage_gap_4));
console.log('long_ids=' + JSON.stringify(meta.sampling.long_ids));
console.log('OUT -> ' + outPath);
console.log('CONTRACT -> ' + contractPath);