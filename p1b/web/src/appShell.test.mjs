import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const mystic = readFileSync(new URL('./pages/mystic/MysticPage.tsx', import.meta.url), 'utf8');
/* ★2026-09-30：旧接题页 `pages/intake/IntakePage.tsx` 源码已删（`git status` 里是 ` D`）。
 * 原这一行在**模块顶层**读它 ⇒ 一次 ENOENT 就让本文件 8 条用例**全部不执行**
 * （实测 `node --test src/appShell.test.mjs` → tests 1 / pass 0 / fail 1 / exit 1）。
 * 下面两条接题页 Term 闸改锚到**当前真正渲染的那一页** NotePage（`/intake` 已重定向到
 * `/note`），守的仍是同一件事，不降低强度。改锚理由逐条写在用例旁的留痕注释里。 */
const note = readFileSync(new URL('./pages/NotePage.tsx', import.meta.url), 'utf8');

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

/* ══════════ 2026-09-30：接题动作的 Term 闸改锚（死页源码已删） ══════════
 * 原两条用例读的是 `pages/intake/IntakePage.tsx`。那一页的**组件自八轮起就不再渲染**
 * （App.tsx `/intake` → `<Navigate to="/note">`），2026-09-30 源码从盘上删除。
 *
 * ★为什么不直接删掉这两条：删掉＝闸门消失，后面谁把真值锚那一栏的术语入口摘了，
 *   没有任何一条断言会红。⇒ 改锚到**当前真正渲染的那一页**（记一笔 NotePage）。
 *
 * 两条原断言各自的去向（不藏）：
 *   ① `termId: 'truthAnchor' / 'cutoff' / <Term id={q.termId}`（拒收门三问逐问接术语）
 *     —— 这三问本身在**八轮第七改**就随「25 个复选框」一起从界面撤掉了（记一笔页
 *     只答两件事：题面 + 答案去哪里查），活代码里已无 per-question termId 机制。
 *     它的**意图**——「用户选真值锚这一栏必须有术语表兜底」——落在下面这条上。
 *   ② `<Term id="truthAnchor" plain={REASON_LABEL…}`（拒收原因接术语）
 *     —— 活页面 NotePage 的拒收理由是 `REASON_TEXT` 人话常量（NotePage.tsx:73-78、
 *     渲染在 :474），**不再包 <Term>**；这句文案本身已由 note-form.test.mjs ⑤ 闸住
 *     （是系统拒了你 / 没有能事后核对的地方 / 四种原因齐）。此处不重复设闸。
 */
test('★记一笔页「答案去哪里查」已接入术语（接题页减负版）', () => {
  // ★选错真值锚正是后端 no_anchor 拒收的主因，这一栏接术语表不是装饰。
  assert.ok(/<Term id="truthAnchor"/.test(note), '「答案去哪里查」未接真值锚术语（truthAnchor）');
  assert.ok(note.includes('note-kind'), '缺真值锚类型选择（答案去哪里查）');
  assert.ok(/from '\.\.\/components\/ui'/.test(note), '未导入 ui');
});

/* ★新事实的断言：旧路径是书签与外部链接的入口，删了会断；断言的是**重定向路由仍在**，
 * 不是「死页面仍在盘上」。同一对断言 note-form.test.mjs ④ 也有一份（双保险）。 */
test('★旧接题页 /intake 仍重定向到 /note（书签不断）', () => {
  assert.ok(app.includes('path="/intake"'), '/intake 旧路径消失（书签会断）');
  assert.ok(/path="\/intake" element=\{<Navigate to="\/note"/.test(app), '/intake 须重定向到 /note');
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

test('★导航由 9 项收成 5 项，且写成动词/问句（八轮第六改）', () => {
  assert.ok(app.includes('appbar-group'), '缺导航分组容器');
  assert.ok(app.includes('appbar-sep'), '缺分组分隔线');
  assert.ok(app.includes('path="/live"'), '/live 应是实页（现场）');
  // 题线三动作，全部是**动词/问句**而非名词
  assert.ok(app.includes('>待落定<'), '缺「待落定」（今天该干的）');
  assert.ok(app.includes('>记一笔<'), '缺「记一笔」（写新的）');
  assert.ok(app.includes('>我在哪儿偏了<'), '缺「我在哪儿偏了」（回声）');
  // ★旧五页路径必须仍可直达（书签不断）——全部重定向到合并体
  for (const p of ['/overview', '/audit', '/calendar', '/compiler']) {
    assert.ok(app.includes('path="' + p + '"'), '旧路径 ' + p + ' 消失（书签会断）');
  }
  assert.ok(app.includes('to="/where-off"'), '旧页须重定向到合并体');
});

test('★入口页是 HomePage（不再是狼人杀选局）', () => {
  assert.ok(app.includes('element={<HomePage />}'), '`/` 未挂 HomePage');
  assert.ok(app.includes("from './pages/HomePage'"), '未导入 HomePage');
  // ★旧别名必须仍在：改路由不能让书签与外部链接断掉（八轮曾误删 /games，已修回）
  assert.ok(app.includes('path="/games"'), '/games 旧别名被删（会破书签）');
  assert.ok(app.includes('Navigate to="/manage"'), '/games 应仍重定向到 /manage');
});
