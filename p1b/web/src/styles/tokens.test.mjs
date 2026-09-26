import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const { CHECKS, readTokens, ratio } = require('./contrast-check.cjs');

test('观测台语义层变量齐备', () => {
  for (const v of ['--grid-line', '--panel-3', '--shadow-4', '--space-section', '--font-size-micro']) {
    assert.ok(css.includes(v + ':'), '缺变量 ' + v);
  }
});

/** 2026-09-22 全方面重构：身份色由暖棕羊皮纸换为抹茶绿观测台。
 *  ★2026-09-27 八轮：底色再由「墨绿黑」换为「中性石墨」——
 *  动机不是好不好看（不可测），是三处可测的结构问题：
 *   ① 原底色带绿味（#1A1F1C 的 R<G<B），面板层级只能靠「继续加绿」区分 ⇒ 整站一个色相
 *      ⇒ 撞「近黑底＋单一亮点」AI 味清单，也丧失「不同层/不同域用不同色」的辨识度；
 *   ② 强调色由「全站唯一光源」降为「仪器指示灯」，色相让位给语义；
 *   ③ 三层径向光晕 + 星座粒子零信息承载 ⇒ 删除（glow-* 全部 transparent）。
 *  ★ 不是删闸，是换锁：新值同样逐字锁定，且下面增补了自动对比度闸（更强的守卫）。 */
test('★冷白记录台身份变量值未被改动', () => {
  assert.ok(css.includes('--bg: #F4F4F1;'), '--bg 被改（应为冷白 #F4F4F1）');
  assert.ok(css.includes('--accent: #0F6E63;'), '--accent 被改（应为深青 #0F6E63）');
  assert.ok(css.includes('--panel: #FFFFFF;'), '--panel 被改（应为纯白 #FFFFFF）');
  assert.ok(css.includes('--text: #1A1A1A;'), '--text 被改（应为近纯黑 #1A1A1A）');
});

/** ★八轮第二轮（冷白记录台）新增两道闸：
 *  ① 现场深色主题必须在场且自带合格的层色——浅底版的低彩度色在深底上只有 ~2.3:1（实测不合格）。
 *  ② 未测斜纹工具类必须在场：本轮的核心机制是「已落定一律灰、颜色/纹理只给还没落定的」，
 *     若 .is-unmeasured 消失，19 个薄格会退回纯空白，被读成「没数据」而非「已知不足」。 */
test('★现场深色主题自带合格层色（浅底层色在深底不合格）', () => {
  const live = css.slice(css.indexOf('[data-mode="live"]'));
  assert.ok(live.length > 0, '缺 [data-mode="live"] 深色主题块');
  for (const v of ['--layer-l1', '--layer-l2', '--layer-l3', '--layer-l4', '--layer-l5', '--layer-l6']) {
    assert.ok(live.includes(v + ':'), '现场主题缺 ' + v);
  }
  assert.ok(css.includes('[data-mode="live"]'), '缺现场模式选择器');
});

test('★未测＝斜纹的工具类在位（核心机制不得退化）', () => {
  assert.ok(css.includes('.is-unmeasured'), '缺 .is-unmeasured（未测格斜纹）');
  assert.ok(css.includes('--unmeasured-ink'), '缺 --unmeasured-ink');
  assert.ok(css.includes('repeating-linear-gradient'), '斜纹须用 repeating-linear-gradient');
});

test('★全站不得有写死的强调色 rgba（换色板会静默降级）', () => {
  // 病象：旧色板时代遗留 20+ 处 rgba(143,175,123,α) 写死值，换成浅底后会显脏且不受主题控制。
  const offenders = [];
  for (const f of ['app.css', 'charts.css', 'input.css', 'intake.css', 'mystic.css', 'oracle.css', 'p1b4.css', 'p1b6.css', 'ui.css']) {
    const t = readFileSync(new URL('./' + f, import.meta.url), 'utf8');
    if (/143,\s*175,\s*123/.test(t)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], '仍有写死的旧强调色：' + offenders.join(','));
});

/** ★新增闸：装饰性背景必须为零。
 *  病象：三层径向光晕 + 暗角 + 星座粒子，全部不表达任何状态、不参与任何读数，
 *  只是在深底上制造「有东西在动」的错觉，并让面板边界更难分辨。
 *  本闸把「装饰不得回来」固化，防后续以「加氛围」为名重新引入。 */
test('★装饰性背景层已归零（防氛围装饰回流）', () => {
  for (const v of ['--glow-1', '--glow-2', '--glow-3', '--vignette']) {
    // v 自带前导 --，故模式里不要再拼 '--'（否则会拼成 '---glow-1' 而永不匹配）
    const m = new RegExp(v + ':\\s*([^;]+);').exec(css);
    assert.ok(m, '缺变量 ' + v);
    assert.equal(m[1].trim(), 'transparent', v + ' 应为 transparent（装饰已删除），实得 ' + m[1].trim());
  }
});

test('L1-L6 层色六色全在', () => {
  for (const v of ['--layer-l1', '--layer-l2', '--layer-l3', '--layer-l4', '--layer-l5', '--layer-l6']) {
    assert.ok(css.includes(v + ':'), '缺 ' + v);
  }
});

/** ★八轮第二轮：`.app-surface` 双层网格**已整体删除**，本闸随之换锁。
 *  病象：网格在深底上是「坐标系」；换浅底后它变成**纸纹**，与正文打架，
 *  而全站其实没有一处真正挂过 .app-surface（实测 grep 零命中）——即一个从未生效的装饰。
 *  新锁：reduced-motion 仍在（交付底线），且「未测斜纹」在场（见上）。 */
test('reduced-motion 仍在场（交付底线）且底纹网格已退役', () => {
  assert.ok(css.includes('prefers-reduced-motion'), '缺 reduced-motion（交付底线，不可删）');
  assert.equal(css.includes('.app-surface'), false, '.app-surface 已退役（浅底上只是纸纹，且从未挂载）');
});

/** ★ 新增闸：换色板后「好不好看」不可测，「看不看得清」可测。
 *  初版 --matcha/#6E8B5E(3.90) 与 --layer-l6/#C4705E(4.12) 肉眼看着没问题，实测不达标
 *  ⇒ 本闸把「改色必跑对比度」固化进测试，防止后续换色静默降级可读性。 */
test('全部前景色对比度达标（WCAG 4.5:1；图表轴线 3:1）', () => {
  const T = readTokens(new URL('./tokens.css', import.meta.url));
  const bad = [];
  for (const [fg, bg, min, note] of CHECKS) {
    const r = ratio(T[fg], T[bg]);
    if (r < min) bad.push(note + ' 实测 ' + r.toFixed(2) + ' <' + min);
  }
  assert.deepEqual(bad, [], '对比度不合格:\n' + bad.join('\n'));
});

test('刻度网格为双层（主+次）且为抹茶色相', () => {
  assert.ok(css.includes('--grid-line-fine'), '缺次网格变量');
  assert.ok(css.includes('--grid-size-fine'), '缺次网格尺寸变量');
  assert.ok(css.includes('--grid-size'), '缺主网格尺寸变量');
});

/** ★八轮第二改：禁「全大写拉丁」eyebrow 回流。
 *  病象：`.plate-tail` / `.chart-eyebrow` / `.tb-label` / `.page-side-title` /
 *   `.ov-hero-eyebrow` 五处都带 `text-transform: uppercase` + 大字距，
 *   在中文标题旁贴一串全大写拉丁字母——独立 critic 判为「AI 破绽·全中·最严重」档，
 *   且 critic 指出它们「光学重量几乎等于标题」，两者在互抢。
 *  处置：尾字**信息保留**（英文名仍显示），只去掉全大写与大字距。
 *  本闸把它锁死，防以「排版规范」为名加回。 */
test('★禁全大写拉丁 eyebrow（AI 破绽，防回流）', () => {
  const offenders = [];
  for (const f of ['app.css','charts.css','input.css','intake.css','mystic.css','motion.css','oracle.css','p1b4.css','p1b6.css','shell.css','ui.css']) {
    const t = readFileSync(new URL('./' + f, import.meta.url), 'utf8');
    if (/text-transform:\s*uppercase/.test(t)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], '仍有 text-transform:uppercase：' + offenders.join(','));
});

/** ★八轮第二改：DeviationBar 必须在场且语义正确。
 *  病象：旧 MiniGauge 把「弧越长」画成「越好」，而 Brier 是误差（越小越好）——
 *   弧长 0.192/0.25 看着「快满格」，实际是「比无信息线好 0.058」。图形替数字说反话。
 *   且同一仪表在一页画了 7 次。本闸锁「偏差条已取代仪表」。 */
test('★偏差条在位（禁半圆仪表回流：弧长语义与误差相反）', () => {
  assert.ok(css.length > 0);
  const charts = readFileSync(new URL('../charts/DeviationBar.tsx', import.meta.url), 'utf8');
  assert.ok(charts.includes('baseline'), 'DeviationBar 须以基准为零轴');
  assert.ok(charts.includes("'better'") && charts.includes("'worse'"), '须区分优于/劣于基准两种状态');
  assert.ok(charts.includes('aria-label'), '须有无障碍完整读法（不靠颜色单独承载）');
  const readout = readFileSync(new URL('../charts/ReadoutCard.tsx', import.meta.url), 'utf8');
  assert.equal(/<MiniGauge value=\{value\}/.test(readout), false, 'ReadoutCard 仍用 MiniGauge');
});

/** ★八轮第二改：动效须守 find-animation-opportunities 的四道门。
 *  门①频率：核心导航属「每天 100+ 次」档 ⇒ 原文判定「Reject. No animation. Ever.」
 *  门②目的：六项合法目的之外（"仪器自检感"不在其中）⇒ 删。
 *  病象：page-power-on（340ms 通电仪式）+ scanline 每次开页必播，频次门违规。
 *  本闸锁「不得回流」。 */
test('★动效守频次门（禁页面通电仪式与扫描线回流）', () => {
  // ★只查代码区：注释里说明「为何删除」是必要留痕，不得被当成回流
  const raw = readFileSync(new URL('./motion.css', import.meta.url), 'utf8');
  const m = raw.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('/*') && !l.trim().startsWith('//')).join('\n');
  assert.equal(/page-power-on/.test(m), false, 'page-power-on 已删（核心导航属 100+/day 档，永不动效）');
  assert.equal(/scan-sweep/.test(m), false, '扫描线已删（每次开页必播的纯装饰）');
  assert.ok(m.includes('page-settle'), '应保留近乎无感的 120ms 落定（属「防突兀变化」）');
  // 留存的动效必须都尊重 reduced-motion
  assert.ok(m.includes('prefers-reduced-motion'), '缺 prefers-reduced-motion（交付底线）');
});
