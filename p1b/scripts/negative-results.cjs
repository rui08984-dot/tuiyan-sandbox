#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/negative-results.cjs —— I2 负结果账本 v0（对内）（2026-09-16 · P0+ · 蓝图 §2.1#8 / 15-I2）
 *
 * 用途：每个「死掉的假设」连同**四要素**（假设 / 判据（路径＋sha256 前 16）/ 结局 / 复算入口）公开挂出。
 *   「四要素缺一即撤」（15-I2 自设纪律）——本脚本在生成时**运行时校验**：引用的判据与证据文件必须存在，
 *   缺失即报错退出（账本不允许引用不存在的证据）。
 * 纪律：零 LLM、零网络、零写库（纯读文件）；产出 p1b/sim/out/negative-results-ledger-YYYYMMDD.{json,md}。
 * 用法：node p1b/scripts/negative-results.cjs [--out-dir <dir>]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..', '..');
function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d; }
const OUT_DIR = arg('out-dir', path.join(ROOT, 'p1b', 'sim', 'out'));

function sha16(p) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex').slice(0, 16); }
function need(p) { const f = path.join(ROOT, p); if (!fs.existsSync(f)) throw new Error('账本引用的文件不存在（四要素校验失败）: ' + p); return p; }
function entry(e) { need(e.criterion); need(e.evidence); return Object.assign({}, e, { criterion_sha16: sha16(e.criterion), evidence_sha16: sha16(e.evidence) }); }

/** 实证类负结果（跑过、有读数、结论=停） */
const EMPIRICAL = [
  { id: 'H1', name: '命题 A（多路判词消融信息增益）',
    hypothesis: '多路判词消融相对单路在基率之上有可检出增量（主判据 Δ≥0.02）',
    criterion: 'docs/assets/forecast-debate/PREREG-命题A-3.0消融-v1.md',
    evidence: 'docs/specs/命题A-全量消融判定报告-20260914.md',
    outcome: '负结果止发：全量 2158/2160，主判据 Δ=+0.00299（CI 含 0、<0.02）；v1.1 分层方向不一致（regime A +0.01438／B −0.02925）⇒ 以 regime A 为准，止发维持',
    rerun: 'node p1b/scripts/prereg-a-run.cjs（补漏入口见 docs/assets/forecast-debate/prereg-a/PAUSE-RESUME-20260914.md）' },
  { id: 'H2', name: 'R-B 信息价值（证据注入）实验',
    hypothesis: '证据行注入使判词在 T1/T2/T6/T7/T10 型上达成信息价值',
    criterion: 'docs/assets/forecast-debate/PREREG-RB-v1-待确认.md',
    evidence: 'docs/assets/forecast-debate/rb-attribution-诊断-20260913.md',
    outcome: '负结果：合并条款三路全未达成（TOST 三路≈基率）；归因诊断指出「LLM 判词未充分利用可用信号」（claims 从未注入＋200 字截断）',
    rerun: 'node p1b/scripts/rb-score.cjs' },
  { id: 'H3', name: 'R-C 判词修复 2.0（证据呈现方式）',
    hypothesis: '证据呈现 2.0（事件 120 字＋claims 按席聚合＋机械特征卡）可把判词拉到基率之上',
    criterion: 'docs/assets/forecast-debate/PREREG-RC-v1-待确认.md',
    evidence: 'p1b/sim/out/rc-full-run.log',
    outcome: '负结果（模型层结论成立）：v1@T2 +0.092★／T6 +0.067★ 仅 2 型<3 未达成；TOST 三路等价 ⇒ 机械直算接管；局部探索性信号（claims 注入在计数类题起效）留多日局/新场景复核',
    rerun: 'node p1b/scripts/rc-score.cjs' },
  { id: 'H4', name: 'VoI 开口规则（弱口径）',
    hypothesis: '价值信息开口子集优于全体（VoI 门可建）',
    criterion: 'docs/assets/forecast-debate/voi-a-report-20260912.md',
    evidence: 'docs/assets/forecast-debate/voi-a-report-20260912.md',
    outcome: '负结果：开口子集更差（+0.2965），τ_D 塌窗 3/90 ⇒ VoI 门不建，留文字版三准则',
    rerun: 'node p1b/scripts/voi-a.cjs' },
  { id: 'H5', name: '校准挑战者 beta calibration（离线 A/B 主口径）',
    hypothesis: 'beta calibration 相对现役恒等映射非劣（ΔBrier 95%CI 上界 ≤ +0.005 且 resolution 不降）',
    criterion: 'p1b/sim/out/calab-report-20260916.json',
    evidence: 'p1b/sim/out/calab-report-20260916.json',
    outcome: '未达非劣：n=695，Δ=+0.0014 CI[−0.0048,+0.0083]、resolution 下降 ⇒ 维持恒等（现役不动）；P0 只出报告，替换动作属 P1',
    rerun: 'node p1b/scripts/calab-run.cjs' },
  { id: 'H6', name: 'E2 路由 R3a/R3h（误差反馈/在线加权）',
    hypothesis: '按历史表现分配引擎（argmin/Hedge）可相对现状非劣并改善',
    criterion: 'docs/assets/forecast-debate/PREREG-E2-路由分配-v1.md',
    evidence: 'p1b/sim/out/e2-shadow-20260916.json',
    outcome: '**前置闸否决**（非跑输）：跨引擎重叠人口 = 0 ⇒ R3 双臂不可估；组合预检 ρ̂ 无 ≥10 题引擎对 ⇒ 先不要立票（先跑后立出证据）',
    rerun: 'node p1b/scripts/e2-shadow-score.cjs' },
  { id: 'H7', name: 'D2 回测 model 臂（第一版模型）',
    hypothesis: 'D2 首批 model 臂优于常数基率对照',
    criterion: 'docs/assets/forecast-debate/PREREG-D2-历史回测引擎-v1.md',
    evidence: 'docs/assets/forecast-debate/PREREG-D2-历史回测引擎-v1.1-补充与勘误.md',
    outcome: 'K4 如实报无增量（v1 model≡base）：Δ(vs b(1−b))=−0.0067；A1–A7/K1–K4 全 PASS 属**管线验收**非能力宣称',
    rerun: 'node p1b/scripts/d2-run-backtest.cjs' },
  { id: 'H8', name: '阶段 5 检索式证据（路线 a）',
    hypothesis: '检索式证据（文本面）可对前瞻题提供可结算信号',
    criterion: 'docs/assets/forecast-debate/PREREG-检索式预测-v1-骨架.md',
    evidence: 'docs/specs/阶段5-检索可行性勘察-20260915.md',
    outcome: '实证否决：跨 25 kind 抽 52 题真跑 ⇒ 证据产出率 **0/52**；论证「前瞻题要么空、要么泄」⇒ 路线 (a) 归档（(b) 前瞻数值信号另立并已达标）',
    rerun: '（勘察件本身为证据；无复算脚本）' },
  { id: 'H9', name: 'ACR 抗投毒（full 窗口径）',
    hypothesis: 'ACR 抗投毒在 full 窗同样成立',
    criterion: 'docs/assets/forecast-debate/acr-二期报告-20260912.md',
    evidence: 'docs/assets/forecast-debate/acr-二期报告-20260912.md',
    outcome: '负结果（口径修正）：cutoff 窗 PASS（0.0875/0.0850/0.0422）／full 窗 FAIL 0.6485 ⇒ **漂移由事件窗决定，非投毒本身**——机制结论改写（非能力宣称）',
    rerun: 'node p1b/scripts/acr-run.cjs（机械层）／acr-run-llm.cjs（LLM 层）' },
  { id: 'H10', name: 'E1 · DNA 加列制 S 维（平稳/漂移标签）',
    hypothesis: '控制 layer×domain 后，S 维（平稳/漂移）标签对 Brier 有可检出差异（主判据 ΔCI 不含 0）',
    criterion: 'docs/assets/forecast-debate/研讨会-20260916-预测万物v3/12-PREREG-E1-DNA加列S维-v1.md',
    evidence: 'p1b/sim/out/e1-judge-receipt-20260917.md',
    outcome: '负结果（弃权条款逐字生效）：前置门通过（双编码 34/34＝1.0）⇒ 生产写入 1792 行 ⇒ **ΔCI 含 0（三口径一致**：§3 主口径 Δ=+0.0025 CI[−0.0187,+0.0236]／Brier(assigned_prob) Δ=−0.0000 CI[−0.0201,+0.0188]／原 y 池化 CI[−0.0248,+0.0802]）⇒ **S 维永久降为文档标签、姿态门与路由主张一并放弃、DNA 线终止**；标签已归档为文档件、旁路表/视图已 DROP；禁换维度续命、禁以功效不足复议',
    rerun: 'node p1b/scripts/dna-s-backfill.cjs --db <副本> --route source --confirm --no-snapshot（确定性可复现）⇒ node p1b/scripts/dna-s-judge.cjs --db <副本> --gate p1b/sim/out/e1-gate-attestation-20260917.json' },
  { id: 'H11', name: '厚格 Granger 滞后臂（序列历史值不可得）',
    hypothesis: 'Granger 滞后臂能在账本内实现并产出对基线非劣的读数（判据照厚格 PREREG v1 §3 C1-C2）',
    criterion: 'docs/assets/forecast-debate/PREREG-厚格基建总票-v1.md',
    evidence: 'p1b/sim/out/thickcell-features-and-v11-receipt-20260918.md',
    outcome: '负结果（封存，2026-09-20 v1.3 裁决）：实现前置审计实证**账本根本不存序列历史值**（evidence 只存基率汇总 p/n/k 与阈值；序列 ID 覆盖 7.3%，属「账本根本不存在」字段）⇒ VAR 滞后项现数据结构下无法复算 ⇒ **封存不实现**（thickcell-replay 维持「已登记未实现 ⇒ exit 4」）；重启条件写死＝**序列历史值入库**（联网重取数＝新增数据依赖须另行立项＋用户拍板）**且**厚格队出现「过 C1+C2 的格需要滞后维解释」的证据需求，两条同时满足方可重开',
    rerun: '重启前置：先立项序列存储并拍板 ⇒ 重跑 p1b/scripts/thickcell-features.cjs 核 seriesID 覆盖 ≥60% 后按 PREREG v1.1 §3 待冻结项 3 重开（v1.3 sha256 前 8 位 49a381db）' },
];
/** 设计层拒绝（文献/分析层，非实证跑数） */
const DESIGN = [
  { id: 'D1', name: '专家网络（多底座集合）', reason: '单底座≠3 成员集合（Krishnamurti 1999 独立性语言不成立）；随 S7 死刑', source: 'docs/assets/forecast-debate/研讨会-20260916-预测万物v3/11-拒绝项救援-深度报告.md' },
  { id: 'D2', name: '乘法公式（概率直乘）', reason: '降格收编为 O6＋G2 门④；KL 相对熵替代', source: 'docs/assets/forecast-debate/研讨会-20260916-预测万物v3/11-拒绝项救援-深度报告.md' },
  { id: 'D3', name: '因果图/反事实沙盒（对外版）', reason: '因果图死刑；反事实降级为对内假设重算器（A1）；上界探针存活', source: 'docs/assets/forecast-debate/研讨会-20260916-预测万物v3/11-拒绝项救援-深度报告.md' },
  { id: 'D4', name: 'LLM 多智能体辩论主持', reason: '文献轮空＋同质性（WC2026 四前沿 agent 92% 相同首选；单底座 λ≈1 无信息差）', source: 'docs/assets/forecast-debate/研讨会-20260916-预测万物v3/17-AI角色重定位-深度报告.md' },
];

const ledger = { script: 'p1b/scripts/negative-results.cjs', title: '负结果账本 v0（对内）', discipline: '四要素：假设／判据（路径＋sha16）／结局／复算入口；缺一即撤（15-I2）',
  note: '负结果也是产出：本账本只列「跑过并有读数」或「设计层正式拒绝」；不列未跑事项', empirical: EMPIRICAL.map(entry), design_rejected: DESIGN.map((d) => { need(d.source); return Object.assign({}, d, { source_sha16: sha16(d.source) }); }), generated_at: new Date().toISOString() };

const md = ['# 负结果账本 v0（对内 · ' + new Date().toISOString().slice(0, 10) + '）', '',
  '> ' + ledger.discipline + '；' + ledger.note, '', '## 实证类（跑过·有读数）', ''];
for (const e of ledger.empirical) md.push('- **' + e.id + ' ' + e.name + '**：' + e.outcome + '\n  · 判据 `' + e.criterion + '`（sha16 `' + e.criterion_sha16 + '`）｜证据 `' + e.evidence + '`（sha16 `' + e.evidence_sha16 + '`）｜复算：`' + e.rerun + '`');
md.push('', '## 设计层拒绝（文献/分析层，非实证）', '');
for (const d of ledger.design_rejected) md.push('- **' + d.id + ' ' + d.name + '**：' + d.reason + '（来源 `' + d.source + '`，sha16 `' + d.source_sha16 + '`）');
md.push('', '（零 LLM／零写库 · 本件为对内 v0；对外主件属第 4 期）');

fs.mkdirSync(OUT_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
fs.writeFileSync(path.join(OUT_DIR, 'negative-results-ledger-' + today + '.json'), JSON.stringify(ledger, null, 1), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'negative-results-ledger-' + today + '.md'), md.join('\n') + '\n', 'utf8');
console.log('=== 负结果账本 v0 ===');
console.log('实证 ' + ledger.empirical.length + ' 条 ｜ 设计层拒绝 ' + ledger.design_rejected.length + ' 条 ｜ 四要素校验全过（引用文件均存在）');
console.log('json/md -> ' + OUT_DIR);
