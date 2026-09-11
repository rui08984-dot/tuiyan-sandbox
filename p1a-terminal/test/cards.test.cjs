'use strict';
// p1a-terminal · test/cards.test.cjs —— D 路参谋卡渲染层测试（零依赖，node 直跑）
// 运行: node test/cards.test.cjs
// 口径: 契约 docs/sandbox/p1a/schema-contract-v0.md §3（LLM 输出=渲染输入）+ design.md §14
// 约定: 与 engine/golden 测试同款 PASS/FAIL 计数 + 失败 exit(1)。
const assert = require('assert');
const path = require('path');
const cards = require('../src/cards');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; failures.push(name); console.log('FAIL  ' + name); console.log('      ' + (e && e.message)); }
}

// ── 夹具：契约 §3 形状的正常参谋卡数据 ──
const gameInfo = {
  name: '熊猫杀S1E7', day: 2,
  players: [{ seat: 1, name: '阿狸' }, { seat: 2, name: 'brook' }, { seat: 3, name: '老渣' }],
};
const cardData = {
  contradictions: [
    { pair_id: 'P-high', underdetermination: 'high',
      innocent_explanations: ['女巫可能毒错人/救错人——毒与守是合法谎言（药剂类）', '信息差：夜晚视角不同（信息差类）'],
      claim_a: 3, claim_b: 5 },
    { pair_id: 'P-mid', underdetermination: 'mid',
      innocent_explanations: ['记错号码、记错夜晚或口误（记忆类）'] },
    { pair_id: 'P-low', underdetermination: 'low',
      innocent_explanations: ['好人主动说谎（悍跳/挡刀/藏身份）'] },
  ],
  hypotheses: [
    { content: '6号是真女巫，10号是挡刀好人', stance: { '6': 'good_believe', '10': 'neutral' },
      support_events: [7, 8], oppose_events: [12], tendency: 'strong' },
    { content: '10号是真女巫，6号悍跳骗警徽', stance: { '6': 'wolf_suspect', '10': 'good_believe' },
      support_events: [12], oppose_events: [7, 8], tendency: 'mid' },
  ],
  checkpoints: [
    { text: '看夜2 7号死讯与6号留的警徽流是否对得上', resolves: [0] },
    { text: '对比两人对夜1死亡信息的知晓口径', resolves: [0, 1] },
  ],
};

// ── T1 正常渲染：三区全要素 ──
test('T1 正常渲染含三区全要素（矛盾/假设/验证点+横幅+局名天数）', () => {
  const out = cards.renderCards(cardData, gameInfo, { meihua: null });
  assert.ok(out.includes('【矛盾点】3 条'), '缺矛盾区标题');
  assert.ok(out.includes('无害解释: 女巫可能毒错人/救错人——毒与守是合法谎言（药剂类）'), '缺无害解释前缀条目');
  assert.ok(out.includes('【竞争假设】2 套'), '缺假设区标题');
  assert.ok(out.includes('假设H1（倾向:强）: 6号是真女巫，10号是挡刀好人'), '缺假设内容+倾向');
  assert.ok(out.includes('倾向:中'), '缺 H2 倾向');
  assert.ok(out.includes('支持事件: e7,e8 / 反对事件: e12'), '缺支持/反对事件');
  assert.ok(out.split('（思路，非定论）').length - 1 === 2, '「思路，非定论」后缀应每套假设一条，实得 ' + (out.split('（思路，非定论）').length - 1));
  assert.ok(out.includes('【验证点】2 条'), '缺验证点区标题');
  assert.ok(out.includes('（分辨 H1）'), '缺验证点 resolves 标注');
  assert.ok(out.includes('（分辨 H1/H2）'), '缺多假设 resolves 标注');
  assert.ok(out.includes('熊猫杀S1E7') && out.includes('第 2 天结算'), '缺局名/天数');
  assert.ok(out.includes('1号·阿狸'), '缺名单');
});

// ── T2 横幅恒挂（红队 YD5/产品定位）──
test('T2 「思路非答案」横幅存在且恒挂（正常/空数据两态）', () => {
  const out = cards.renderCards(cardData, gameInfo, { meihua: null });
  assert.ok(out.includes('═══ 参谋卡 · 思路非答案 ═══'), '正常态缺横幅');
  assert.ok(out.startsWith('═══ 参谋卡 · 思路非答案 ═══'), '横幅不在首行');
  const empty = cards.renderCards({}, {}, { meihua: null });
  assert.ok(empty.startsWith('═══ 参谋卡 · 思路非答案 ═══'), '空数据态缺横幅');
});

// ── T3 欠定度符号映射：high=⚠ mid=· low=空格前缀 ──
test('T3 欠定度符号正确映射（high→⚠ / mid→· / low→空格前缀）', () => {
  const out = cards.renderCards(cardData, gameInfo, { meihua: null });
  const lineOf = (pid) => out.split('\n').find((l) => l.includes('矛盾' + pid + '（'));
  const hi = lineOf('P-high'), mi = lineOf('P-mid'), lo = lineOf('P-low');
  assert.ok(hi, '未找到 high 矛盾行');
  assert.ok(mi && lo, '未找到 mid/low 矛盾行');
  assert.ok(hi.startsWith(' ⚠ 矛盾P-high'), 'high 行前缀非 ⚠: [' + hi.slice(0, 12) + ']');
  assert.ok(hi.includes('欠定度:高'), 'high 行缺「欠定度:高」');
  assert.ok(mi.startsWith(' · 矛盾P-mid'), 'mid 行前缀非 ·: [' + mi.slice(0, 12) + ']');
  assert.ok(mi.includes('欠定度:中'), 'mid 行缺「欠定度:中」');
  assert.ok(lo.startsWith('   矛盾P-low'), 'low 行非空格前缀: [' + lo.slice(0, 12) + ']');
  assert.ok(!lo.includes('⚠') && !lo.includes('·'), 'low 行不应带符号');
});

// ── T4 空矛盾列表 ──
test('T4 空矛盾列表输出「未发现矛盾」', () => {
  const out = cards.renderCards({ contradictions: [], hypotheses: cardData.hypotheses, checkpoints: [] }, gameInfo, { meihua: null });
  assert.ok(out.includes('未发现矛盾'), '缺「未发现矛盾」');
  assert.ok(!out.includes('矛盾P-'), '空列表不应出现矛盾条目');
});

// ── T5 meihua 缺失降级：彩蛋跳过不报错（真实路径缺失 + 强制 null + 模块抛错三态）──
test('T5 meihua 缺失时降级不崩（无卦象/无娱乐参考）', () => {
  let outDefault;
  assert.doesNotThrow(() => { outDefault = cards.renderCards(cardData, gameInfo); }, '默认真实路径渲染不应抛错');
  assert.ok(outDefault.includes('═══ 参谋卡 · 思路非答案 ═══'), '降级态仍应有横幅');
  const outNull = cards.renderCards(cardData, gameInfo, { meihua: null });
  assert.ok(!outNull.includes('今日卦象'), '强制缺失不应出现「今日卦象」');
  assert.ok(!outNull.includes('娱乐参考'), '强制缺失不应出现「娱乐参考」');
  const boom = { qiGuaByNumbers: () => { throw new Error('boom'); } };
  let outBoom;
  assert.doesNotThrow(() => { outBoom = cards.renderCards(cardData, gameInfo, { meihua: boom }); }, '模块抛错不应外溢');
  assert.ok(!outBoom.includes('今日卦象'), '模块抛错应静默跳过彩蛋');
});

// ── T6 超长内容不溢出：每行 ≤80 字符（换行保信息，不丢内容）──
test('T6 超长内容不溢出（每行 ≤80 字符且内容完整保留）', () => {
  const longCn = '狼'.repeat(300);
  const longEn = 'a'.repeat(200);
  const fat = {
    name: 'X'.repeat(100),
    day: 2,
    players: [{ seat: 1, name: '名'.repeat(60) }, { seat: 2, name: 'b'.repeat(70) }],
  };
  const data = {
    contradictions: [{ pair_id: 'L1', underdetermination: 'high',
      innocent_explanations: [longCn + longEn, '短'] }],
    hypotheses: [{ content: longCn + longEn, stance: {}, support_events: [], oppose_events: [], tendency: 'weak' }],
    checkpoints: [{ text: longCn, resolves: [0] }],
  };
  const out = cards.renderCards(data, fat, { meihua: null });
  const lines = out.split('\n');
  const maxLen = Math.max.apply(null, lines.map((l) => l.length));
  assert.ok(maxLen <= cards.CARD_WIDTH, '存在超长行: maxLen=' + maxLen + ' > ' + cards.CARD_WIDTH);
  const flat = out.replace(/\n/g, '');
  assert.ok(flat.includes(longCn + longEn), '换行后内容应完整保留（不得截断丢失）');
  assert.ok(out.includes('假设H1（倾向:弱）'), '超长假设倾向标注丢失');
});

// ── T7 玄学彩蛋（正路径）：注入真实 meihua 模块 → 今日卦象卡（娱乐参考恒挂）──
test('T7 注入 meihua 时输出今日卦象卡（本卦/互卦/变卦/体用生克+娱乐参考）', () => {
  const meihuaPath = path.join(__dirname, '..', '..', 'docs', 'sandbox', 'p2-yijing', 'meihua.js');
  const meihua = require(meihuaPath);
  const out = cards.renderCards(cardData, gameInfo, { meihua: meihua });
  const expected = meihua.qiGuaByNumbers(2, 3); // 口径: 数A=day, 数B=人数
  assert.ok(out.includes('今日卦象'), '缺「今日卦象」卡');
  assert.ok(out.includes('娱乐参考'), '缺「娱乐参考」标注');
  assert.ok(out.includes('本卦: ' + expected.benGua.fullName), '本卦与 meihua 口径不符');
  assert.ok(out.includes('互卦: ' + expected.huGua.fullName), '互卦与 meihua 口径不符');
  assert.ok(out.includes('变卦: ' + expected.bianGua.fullName), '变卦与 meihua 口径不符');
  assert.ok(out.includes('体用:') && out.includes(expected.tiYongRelation), '缺体用生克');
  assert.ok(out.includes('动爻' + expected.dongYao), '缺动爻');
});

// ── T8 容错：null 输入 / resolves 越界 / 空假设与空验证点 ──
test('T8 容错：null cardData、resolves 越界、空假设空验证点均不崩', () => {
  const out = cards.renderCards(null, null, { meihua: null });
  assert.ok(out.startsWith('═══ 参谋卡 · 思路非答案 ═══'), 'null 输入仍应有横幅');
  assert.ok(out.includes('未发现矛盾'), 'null 输入矛盾区应显示未发现矛盾');
  assert.ok(out.includes('（无假设'), 'null 输入假设区应显示无假设');
  assert.ok(out.includes('（无验证点）'), 'null 输入验证点区应显示无验证点');
  const bad = { contradictions: cardData.contradictions, hypotheses: cardData.hypotheses,
    checkpoints: [{ text: 't', resolves: [99, -1, 'x'] }] };
  const out2 = cards.renderCards(bad, gameInfo, { meihua: null });
  assert.ok(out2.includes('（分辨 -）'), 'resolves 全越界应显示 -');
  assert.ok(!out2.includes('H100'), '越界下标不得渲染成假设编号');
  const alias = cards.renderAdvisor(cardData, { game: { name: gameInfo.name, player_count: 3 }, day: 2 }, { meihua: null });
  assert.ok(alias.includes('熊猫杀S1E7') && alias.includes('第 2 天结算'), 'renderAdvisor B 路适配别名应可用');
});

console.log('──────────────────────────────');
console.log('cards.test: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) { console.log('FAILED: ' + failures.join(' | ')); process.exit(1); }