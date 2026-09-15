import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const mystic = readFileSync(new URL('./pages/mystic/MysticPage.tsx', import.meta.url), 'utf8');
const intake = readFileSync(new URL('./pages/intake/IntakePage.tsx', import.meta.url), 'utf8');

test('App 顶栏有术语表入口且挂载抽屉', () => {
  assert.ok(app.includes('TermDrawer'), '未挂载 TermDrawer');
  assert.ok(app.includes('术语表'), '缺术语表入口');
  assert.ok(app.includes('termsOpen'), '缺开关状态');
});

test('App 结构完整（无重复闭合标签）', () => {
  const openMain = (app.match(/<main/g) ?? []).length;
  const closeMain = (app.match(/<\/main>/g) ?? []).length;
  assert.equal(openMain, closeMain, '<main> 开合不匹配: ' + openMain + '/' + closeMain);
});

test('玄学页横幅在位（铁律②）', () => {
  assert.ok(mystic.includes('娱乐参考'), '娱乐参考横幅丢失');
  assert.ok(mystic.includes('非游戏研判'), '非游戏研判标注丢失');
});

test('玄学页已清零装饰性 emoji 图标', () => {
  const emoji = mystic.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? [];
  // ✕ 是关闭按钮（功能），保留；☯ 属装饰性 emoji，须清零
  assert.equal(emoji.filter((c) => c !== '✕').length, 0, '仍有 emoji: ' + emoji.join(' '));
  assert.ok(mystic.includes('IconCompass'), '未换 SVG 图标');
});

test('接题页拒收门三问已接入术语', () => {
  assert.ok(intake.includes("termId: 'truthAnchor'"), 'Q0-1 未接真值锚术语');
  assert.ok(intake.includes("termId: 'cutoff'"), 'Q0-2 未接 cutoff 术语');
  assert.ok(intake.includes('<Term id={q.termId}'), '未渲染 Term');
  assert.ok(intake.includes("from '../../components/ui'"), '未导入 ui');
});

test('接题页拒收原因已接入术语', () => {
  assert.ok(intake.includes("<Term id=\"truthAnchor\" plain={REASON_LABEL"), '拒收原因未接术语');
});
