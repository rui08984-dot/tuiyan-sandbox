/**
 * 算数露头闸（2026-09-28 · T5 / 模块 M2 前端半）
 *
 * 这是本产品**存在的理由**：出题 → **算数** → 到期验证。
 * 过去写完题面什么都拿不到——用户不知道"我凭什么给这个数"、
 * 也不知道"历史上这类题怎么样"。T4 把数从后端端出来，T5 接到界面上。
 *
 * 本闸锁四件事：
 *   ① 两个数**并排**且地位对等（不是"基率当主角、你的判断当配角"——
 *      那会暗示"你该跟着基率填"）
 *   ② ★样本不足（n<30）**不给结论句**——用 27 条样本说"你比基率乐观"
 *      是拿噪音当结论，正是本项目最要防的误读
 *   ③ rate 为 null（没有历史）时**不显示 0**——null 是"没有"，0 是"测了是 0"
 *   ④ 判据一条不减（判据不减闸在 kind-label/note-form 里，此处防叠加）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, 'pages', 'NotePage.tsx'), 'utf8');

test('① 两个数并排，且地位对等', () => {
  assert.ok(page.includes('note-nums'), '须有并排容器');
  assert.ok(page.includes('同类历史'), '左：同类历史');
  assert.ok(page.includes('你的判断'), '右：你的判断');
  // 两个格子都要有 label（"lab" 与 "note-num" 成对出现）
  const nums = (page.match(/note-num-lab/g) || []).length;
  assert.ok(nums >= 2, '两个数都要有标签，实得 ' + nums);
  // 结论句
  assert.ok(page.includes('note-verdict'), '须有结论句区');
  assert.ok(page.includes('data-testid="note-verdict"'), '结论句须可被测试定位');
});

test('★② 样本不足时不给结论句（拿噪音当结论是最要防的误读）', () => {
  const fn = page.slice(page.indexOf('export function verdictText'), page.indexOf('export function verdictText') + 1200);
  assert.ok(fn.includes('!base.enough'), 'verdictText 必须判 enough=false 分支');
  assert.ok(/if \(!base\.enough\)[\s\S]{0,200}return/.test(fn),
    '★样本不足必须**提前 return 且不给结论**，不能落到最后那句"你比历史更…"');
  // 不足时的措辞不许含"乐观/保守"这种结论词
  const thin = /if \(!base\.enough\)[\s\S]*?return\s+'([^']+)'/.exec(fn);
  assert.ok(thin, '须有样本不足的返回文案');
  assert.equal(/乐观|保守/.test(thin[1]), false,
    '★样本不足的文案不得出现"乐观/保守"——那是结论词，样本不够时给不出结论');
});

test('③ rate 为 null 时显示「—」而不是 0', () => {
  assert.ok(page.includes("base.rate != null"), '须判 rate 是否为 null');
  assert.ok(page.includes("? Math.round(base.rate * 100) + '%' : '—'"),
    '★无历史时显示「—」，绝不显示 0%（null 是"没有"，0 是"测了是 0"）');
  // 样式上也不要把 null 渲染成一个大红 0
  assert.ok(page.includes("is-thin"), '样本不足时数字须降对比（is-thin）');
});

test('④ 不足时必须显式警告「只记方向」', () => {
  assert.ok(page.includes('note-thin-warn'), '须有薄样本警告区');
  assert.ok(page.includes('只记方向'), '警告文案须含「只记方向」');
  assert.ok(page.includes('不当结论用'), '警告须说明「不当结论用」');
});
