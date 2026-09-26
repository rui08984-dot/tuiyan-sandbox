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

/* ══════════ 2026-09-27 八轮：防「装饰回流」闸 ══════════
 * 病象：壳层挂着装饰性 Canvas 粒子场（CanvasField），其组件头注宣称
 *   「密度随页面数据量变化」——实测密度公式是 min(MAX,(w*h)/100000*DENSITY)，
 *   **只跟视口面积有关，与页面数据无关**（接题页与校准总览的粒子场完全一致）。
 *   即：用一句没实现的语义，包装一段每帧重绘 + 鼠标避让的纯装饰动画，
 *   同时让面板边界更难分辨。八轮已从壳层移除。
 * 本闸把它锁死，防后续以「加氛围 / 动效层」为名重新挂回。 */
test('★壳层不挂装饰性粒子场（防氛围装饰回流）', () => {
  // ★只查**代码行**：注释里提到文件名是正常的（留痕说明为什么移除），不得误伤
  const code = app.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('{/*')).join('\n');
  assert.equal(/<CanvasField/.test(code), false, 'App.tsx 又挂上了 <CanvasField>（装饰已移除）');
  assert.equal(/components\/CanvasField/.test(code), false, 'App.tsx 又 import 了 CanvasField');
});

test('★导航按用途分组（入口/观测+工具｜现场）', () => {
  assert.ok(app.includes('appbar-group'), '缺导航分组容器');
  assert.ok(app.includes('appbar-sep'), '缺分组分隔线');
  assert.ok(app.includes('to="/" end'), '入口页路由缺失');
  assert.ok(app.includes('path="/live"'), '/live 应是实页（现场）');
});

test('★入口页是 HomePage（不再是狼人杀选局）', () => {
  assert.ok(app.includes('element={<HomePage />}'), '`/` 未挂 HomePage');
  assert.ok(app.includes("from './pages/HomePage'"), '未导入 HomePage');
  // ★旧别名必须仍在：改路由不能让书签与外部链接断掉（八轮曾误删 /games，已修回）
  assert.ok(app.includes('path="/games"'), '/games 旧别名被删（会破书签）');
  assert.ok(app.includes('Navigate to="/manage"'), '/games 应仍重定向到 /manage');
});
