'use strict';
/**
 * ★跨文件守卫：README 的「上手承诺」必须与**盘上真实状态**一致。
 *
 * 为什么要有这条（2026-09-29 独立复核抓到的实例）：
 *   README 写「★30 秒上手：1. 下载发行包（Windows x64 绿色包）」，
 *   同批的 .github/landing/index.html 却明写「现在没有可下载的压缩包……所以这一项放一个
 *   「下载」按钮就是骗人」，而仓库里**确实没有 zip**。
 *   ⇒ 两个同批交付的文件对同一件事给出**相反陈述**，陌生人照 README 第一步走当场失败。
 *
 *   ★单文件守卫抓不到这类问题：README 自己的断言全绿，落地页自己的断言也全绿。
 *   只有**把 README 的承诺与盘上事实对起来**才看得见。
 *
 * 判据：README 若出现「下载发行包 / 下载 zip」这类**祈使句**，
 *      则必须满足二者之一——
 *        ① 仓库里真的有可下载的 zip（排除 .scratch 下与本项目无关的那些）
 *        ② README **自己**明说它尚未发布（出现「尚未 / 待定 / 没有可下载」之一）
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const README = path.join(ROOT, 'README.md');

/** 递归找 zip，排除与本项目无关的目录 */
function 找发行zip() {
  const 出 = [];
  const 跳过 = new Set(['node_modules', '.git', '.scratch', 'out', 'dist', '.sessionrelay']);
  const 走 = (d, 深) => {
    if (深 > 3) return;
    let 条目;
    try { 条目 = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of 条目) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!跳过.has(e.name)) 走(p, 深 + 1); continue; }
      if (/\.zip$/i.test(e.name)) 出.push(path.relative(ROOT, p));
    }
  };
  走(ROOT, 0);
  return 出;
}

test('★跨文件：README 的上手承诺与盘上真实状态一致（不许承诺点不动的下载）', () => {
  const t = fs.readFileSync(README, 'utf8');

  // 取「30 秒上手」那一节——矛盾就发生在那里
  const s = t.indexOf('30 秒上手');
  assert.ok(s > 0, '★README 里找不到「30 秒上手」节');
  const 节 = t.slice(s, t.indexOf('\n## ', s) > 0 ? t.indexOf('\n## ', s) : t.length);

  // ★★只判**编号步骤**里有没有下载指令，不判整节。
  //   第一版判的是「整节含『下载』二字」⇒ 连那句诚实的说明（"下载链接今天必然点不动"）
  //   都会算作「有承诺」，而同一节里又有「尚未」⇒ **自证通过、永远绿**。
  //   这正是变异注入当场抓出来的那类松守卫：它测的是「文本里有没有某个词」，
  //   不是「读者照做会不会失败」。
  const 步骤行 = 节.split('\n').filter((l) => /^\s*\d+\.\s/.test(l)).join('\n');
  const 有下载承诺 = /下载/.test(步骤行);
  if (!有下载承诺) return;   // 步骤里不承诺下载就无需对账

  const 真有zip = 找发行zip().length > 0;

  // ★★★ 关键：只要**编号步骤里写了下载**，它就是一条对读者的承诺 ——
  //   同一节里别处的「尚未发布」说明**不能替它开脱**。
  //   第一版留了「节里有『尚未/待定』就放过」的口子，于是把矛盾放回去测时它照样绿：
  //   诚实说明（"下载链接今天必然点不动"）把那条假承诺遮住了。
  //   ⇒ 规则收紧为：**步骤承诺下载 ⇒ 必须真有 zip**，无例外。
  assert.ok(真有zip,
    '★README 的「30 秒上手」**步骤 1 就是下载指令**，但仓库里没有 zip ⇒ 陌生人第一步当场失败。\n'
    + '  修法二选一：① 真的把发行包挂上去（进 Releases）② 把那一步改成今天走得通的路'
    + '（拿到源码 → npm install → npm start），并把"发行包尚未发布"放到**说明区**而不是步骤里。\n'
    + '  找到的 zip：' + JSON.stringify(找发行zip()));

  // 真有 zip 时，那一节**必须**给解压之类的实操指引，而不是只说一句「下载」
  assert.ok(/解压/.test(节), '★真有发行包时，上手段落里必须出现「解压」这类实操指引');
});

test('★跨文件：落地页与 README 对「有没有可下载包」的说法一致', () => {
  const 落地 = path.join(ROOT, '.github', 'landing', 'index.html');
  if (!fs.existsSync(落地)) return;   // 落地页不在就不对账
  const 页面 = fs.readFileSync(落地, 'utf8');
  const t = fs.readFileSync(README, 'utf8');
  const s = t.indexOf('30 秒上手');
  const 节 = t.slice(s, t.indexOf('\n## ', s) > 0 ? t.indexOf('\n## ', s) : t.length);

  const 页面说有 = /没有可下载|尚未|还没有/.test(页面);
  const README说有 = /尚未|待定|没有可下载|未发布/.test(节);
  assert.ok(页面说有 === README说有,
    '★落地页与 README 对「有没有可下载的包」说法不一致（页面说=' + 页面说有
    + '，README 说=' + README说有 + '）⇒ 两个同批交付对同一件事给出相反陈述');
});

test('★跨文件：README 的平台支持表只写已验过的', () => {
  const t = fs.readFileSync(README, 'utf8');
  // 出现「已验 / 支持」字样的平台才算声称支持
  const 声称 = ['Windows', 'macOS', 'Linux'].filter((p) =>
    new RegExp('\\|\\s*' + p + '\\s*\\|[^|]*\\|?\\s*[^|]*(已验|✅|支持)').test(t));
  assert.ok(声称.every((p) => p === 'Windows'),
    '★平台表声称支持了未验过的平台：' + 声称.join('、')
    + '（本轮只做了 win-x64；mac/linux 归 P2，写上去就是撒谎）');
});