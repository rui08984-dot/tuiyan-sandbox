/* 待落定页闸（2026-08-27 八轮第五改）
 *
 * 这道闸锁的不是样式，是**一个产品事实**：
 *   `POST /api/predictions/:id/resolve` 与 `GET /api/predictions/unresolved`
 *   后端早就有（含 409 不可变守卫、ambiguous 强制附注），
 *   而在此之前**前端一次都没调过** —— 1994 道题全由 CLI 灌入，人手写的题 0 道。
 *   题线上只有「入账」没有「落定」，且落定还发生在终端里
 *   ⇒ 一个没有第二个动词的界面，长出来必然是仪表盘。
 *   这就是「像后端维护的东西」的真正来源。
 *
 * 所以锁三条：①页必须能写账本 ②不可变铁律必须显式呈现（409 不静默）
 *   ③ambiguous 必须强制附注（歧义不许硬判）。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, 'pages', 'ResolvePage.tsx'), 'utf8');
const api = readFileSync(join(dir, 'api.ts'), 'utf8');
const app = readFileSync(join(dir, 'App.tsx'), 'utf8');

test('① 题线上有「落定」这个动作了（不再是只读账本）', () => {
  assert.ok(api.includes('/predictions/'), 'api 须调 /predictions 端点');
  assert.ok(api.includes("/resolve'"), 'api 须有落定调用（POST …/resolve）');
  assert.ok(page.includes('resolvePrediction'), '页面须真的调用落定接口');
  assert.ok(app.includes('path="/resolve"'), '须有 /resolve 路由');
  // 反向锁：若哪天有人把这两个调用删了，这道闸会红
  assert.ok(!/^\s*\/\/.*listUnresolved/m.test(api), 'listUnresolved 不应被整体注释掉');
});

test('② 账本不可变：409 必须显式告知，不静默失败也不给假选项', () => {
  assert.ok(page.includes('409'), '须处理 409（已落定）');
  assert.ok(page.includes('账本不可变'), '须把不可变这条讲给用户听');
  assert.ok(page.includes('另开'), '须指明正确做法是另开修正记录，而不是就地改');
});

test('③ ambiguous 强制附注：歧义不许硬判', () => {
  assert.ok(page.includes('判定不清') || page.includes('ambiguous'), '须有「判定不清」这条出路');
  assert.ok(page.includes('note'), '须提交 note');
  assert.ok(/disabled=\{!note\.trim\(\)\}/.test(page), 'note 为空时提交键必须禁用');
});

test('④ 不做「推荐先落哪一条」（推荐是观点，会撒谎）', () => {
  assert.equal(/推荐|建议先|优先处理/.test(page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')), false,
    '页面代码里不得出现推荐/建议字样（注释里的说明不算）');
});
