'use strict';
/**
 * p1b/test/landing.test.cjs —— 落地页与 MCP 描述文件守卫（landing 模块 · 2026-09-30）
 * 规格：docs/specs/SPEC-ci-landing-mobile.md「模块 2 · landing」
 *
 * 不变量（每条都是**行为**，不是行数、不是字节数、不是魔数窗口）：
 *   ① 纯静态：无 <script>、无内联事件、无 fetch/XHR、无表单与按钮、无 iframe
 *   ② 无死链：页面每条 href/src 要么命中本页某个 id，要么落在仓库内且**在盘上真实存在**
 *   ③ 零外链：外链离线无法核验是否还活着，所以本页一条都不许有（要加必须同改本条）
 *   ④ 不承诺在线试用：可见文案里不许出现试用/立即上手类话术，且必须自述「静态」
 *   ⑤ UI 禁词：全页（含 HTML 注释）不出现那两个字（口径照 p1b/web/dist.test.mjs 的同名断言）
 *   ⑥ server.json 三必需字段齐全；name 是反向 DNS ＋ **恰好一个斜杠**；version 是版本号形态
 *   ⑦ 两个新文件都是 UTF-8 无 BOM ＋ 纯 LF ＋ 无行尾空白 ＋ **不含 U+FFFD**（乱码当场红）
 *
 * ★为什么要把判据写成导出函数：正向断言会随改动一起被改掉，反向锁不会。
 *   ⑨ 对每个判据都做**双向**验证：喂负例必须红，喂正例必须绿 ——
 *   只测负例的判据可能恒红，只测正例的判据可能恒真，两种都不算闸门。
 *
 * ★本件只在内存里喂合成 HTML 给判据，**不写盘、不改动任何被测文件**：
 *   与收尾阶段的「变异注入」是两件事（那个改的是盘上的真件，本件只测判据函数本身）。
 *   真文件全程只读。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const 页面路径 = path.join(ROOT, '.github', 'landing', 'index.html');
const 页面目录 = path.dirname(页面路径);
const 描述路径 = path.join(ROOT, 'docs', 'mcp', 'server.json');
const 根README路径 = path.join(ROOT, 'README.md');

// ══════════════════════════════════════════════════════════════════════
// 判据（纯函数：只吃字符串/对象，不碰盘，除显式传入的解析函数外无副作用）
// ══════════════════════════════════════════════════════════════════════

/** 抽 href/src。双引号与单引号都认 —— 只认一种的话，换个引号写法就能整条绕过。 */
function 抽链接(html) {
  const out = [];
  const re = /\s(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push({ 属性: m[1], 值: m[2] !== undefined ? m[2] : m[3] });
  return out;
}

/** 抽 id（片段判据用）。 */
function 抽id(html) {
  const out = [];
  const re = /\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

/** 可见文案：去 HTML 注释与标签。★判「不许承诺」只看人看得见的字，注释里写反例不算。 */
function 可见文本(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 反链判据。返回 {ok, why, 清单, 片段数, 相对数, 外链数, 非法数}。
 * 页面目录/根都由调用方传入 ⇒ 同一判据能对真实页面与合成样本用同一套口径。
 */
function 判链接(html, 页面目录, 根, 存在性 = (p) => fs.existsSync(p)) {
  const ids = new Set(抽id(html));
  const 清单 = [];
  const why = [];
  let 片段数 = 0, 相对数 = 0, 外链数 = 0, 非法数 = 0;

  for (const { 属性, 值 } of 抽链接(html)) {
    const 条 = { 属性, 值, 归一: '', 说明: '' };
    if (值 === '') {
      条.归一 = '非法'; 条.说明 = '空链接';
    } else if (值.startsWith('#')) {
      条.归一 = '片段';
      const frag = 值.slice(1);
      if (!frag) { 条.说明 = '空片段（href="#"）'; 非法数++; }
      else if (!ids.has(frag)) { 条.说明 = '片段 #' + frag + ' 在本页没有对应 id'; 非法数++; }
      else 片段数++;
    } else if (/^https?:/i.test(值) || 值.startsWith('//')) {
      条.归一 = '外链';
      条.说明 = '外链离线无法核验是否还活着';
      外链数++;
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(值)) {
      条.归一 = '非法'; 条.说明 = '非常规协议（' + 值.split(':')[0] + '），本仓只收 http/https 与相对路径'; 非法数++;
    } else {
      条.归一 = '相对';
      let 目标 = 值.split('#')[0].split('?')[0];
      if (!目标) { 条.说明 = '只有片段/查询串，没有路径'; 非法数++; 相对数++; }
      else {
        let 解码 = 目标;
        try { 解码 = decodeURIComponent(目标); } catch { 条.说明 = '百分号编码解不开：' + 目标; }
        const abs = path.resolve(页面目录, 解码);
        const rel = path.relative(根, abs);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          // ★2026-09-29 补记账：越界与死链两个分支原先只写 说明，**不累加任何计数器**，
          //   也不改 归一 ⇒ 计数不变式（四者和 === 清单长度）先炸，报出的是**误导性的**
          //   「每条链接必须恰好归一类」，而判据其实已经算对了（ok=false、why 说清死链）。
          //   ⇒ 真·死链永远以「记账不一致」的面貌出现；若日后有人把不变式放宽成 >=，
          //   死链信息就彻底露不出来了。
          条.归一 = '非法';
          条.说明 = '越出仓库根：' + abs;
          非法数++; 相对数++;
        } else if (!存在性(abs)) {
          条.归一 = '非法';
          条.说明 = '死链：' + rel + ' 在盘上不存在';
          非法数++; 相对数++;
        } else {
          相对数++;
        }
      }
    }
    清单.push(条);
  }

  for (const 条 of 清单) {
    if (条.归一 === '非法' || (条.归一 !== '外链' && 条.说明)) {
      why.push('[' + 条.属性 + '] ' + JSON.stringify(条.值) + ' —— ' + 条.说明);
    }
  }
  if (外链数 > 0) {
    why.push('本页刻意零外链（' + 外链数 + ' 条）：离线无法核验外链是否还活着。要加外链须同改本条与页内注释。');
  }
  return { ok: why.length === 0, why, 清单, 片段数, 相对数, 外链数, 非法数 };
}

/**
 * 纯静态判据：静态页不许有任何能跑、能提交、能跳转的东西。
 * ★扫的是**整份文件，含 HTML 注释** —— 这是有意的严格，不是漏判：
 *   注释里贴一个 script 标签会被照红（本仓的真实页头就因为这个红过一次，见页内注释）。
 *   要在注释里举例子，请写「script 标签」这类不含尖括号的说法。
 */
function 判静态(html) {
  const why = [];
  const 禁 = [
    [/<script[\s>]/i, '含 <script>'],
    [/\son[a-z]+\s*=/i, '含内联事件属性（on*=）'],
    [/\bjavascript\s*:/i, '含 javascript: 协议'],
    [/\b(fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource)\b/, '含后端调用或长连接'],
    [/<\s*(form|input|button|select|textarea)[\s>]/i, '含表单或按钮 —— 静态页没有后端，点了没反应就是骗人'],
    [/<\s*(iframe|embed|object)[\s>]/i, '含内嵌框架'],
    [/http-equiv\s*=\s*["']?refresh/i, '含 meta refresh 跳转'],
    [/\bdata-(href|src)\s*=/i, '含 data-href/data-src（绕过 href 抽取的藏链接写法）'],
  ];
  for (const [re, 说明] of 禁) if (re.test(html)) why.push(说明);
  if (!/<!doctype\s+html>/i.test(html)) why.push('缺 <!doctype html>（会进怪异模式，排版不可控）');
  if (!/<meta\s+charset\s*=\s*["']?utf-8/i.test(html)) why.push('缺 <meta charset="utf-8">（中文会靠猜）');
  return { ok: why.length === 0, why };
}

/** 「不许承诺在线试用」判据。入参应当是**可见文本**。 */
const 试用话术 = [
  '在线试用', '免费试用', '在线运行', '在线部署', '云端运行', '云端托管',
  '立即开始', '立刻开始', '开始体验', '一键试用', '点此体验', '注册体验',
];
function 判无在线试用(文案) {
  const why = [];
  for (const 词 of 试用话术) if (文案.includes(词)) why.push('出现试用承诺词：' + 词);
  if (!文案.includes('静态')) why.push('没有自述「静态」——不承诺的另一种写法是沉默');
  return { ok: why.length === 0, why };
}

/** UI 禁词判据（铁律：界面不许出现那两个字）。入参是**整份文件**，注释也算。 */
const UI禁词 = ['预测'];
function 判禁词(全文) {
  const why = [];
  for (const 词 of UI禁词) if (全文.includes(词)) why.push('含 UI 禁词：' + 词);
  return { ok: why.length === 0, why };
}

/** server.json 判据。 */
function 判ServerJson(j) {
  const why = [];
  if (j === null || typeof j !== 'object' || Array.isArray(j)) {
    return { ok: false, why: ['server.json 顶层不是对象'] };
  }
  for (const k of ['name', 'description', 'version']) {
    if (typeof j[k] !== 'string' || j[k].trim() === '') why.push('缺必需字段或不是非空字符串：' + k);
  }
  if (typeof j.name === 'string') {
    const 段 = j.name.split('/');
    if (段.length !== 2) {
      why.push('name 必须**恰好一个斜杠**，现在 ' + (段.length - 1) + ' 个：' + j.name);
    } else {
      const [域名, 服务] = 段;
      const 标签 = 域名.split('.');
      const 标签合法 = 标签.length >= 2 && 标签.every(
        (t) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(t)
      );
      if (!标签合法) why.push('name 的域名段不是反向 DNS 形态（至少两段、每段只能是字母数字与连字符）：' + 域名);
      if (标签.length >= 2 && /^[0-9.]+$/.test(标签[标签.length - 1])) {
        why.push('反向 DNS 末段是数字：' + 标签[标签.length - 1] + '（那是 IP，不是域名）');
      }
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(服务)) why.push('name 的服务名段不合法：' + 服务);
    }
  }
  if (typeof j.description === 'string' && (j.description.length < 10 || j.description.length > 1024)) {
    why.push('description 长度 ' + j.description.length + ' 不在 10–1024 之间');
  }
  if (typeof j.version === 'string' && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(j.version)) {
    why.push('version 不是版本号形态：' + j.version);
  }
  // 描述文件是会被贴到公共 registry 的：里面绝不许有凭据字段
  (function 扫键(值, 路径) {
    if (值 === null || typeof 值 !== 'object') return;
    for (const [k, v] of Object.entries(值)) {
      if (/(key|secret|token|password|credential|cookie)/i.test(k)) why.push('描述文件里出现凭据字段：' + 路径 + k);
      扫键(v, 路径 + k + '.');
    }
  })(j, '');
  return { ok: why.length === 0, why };
}

/**
 * U+FFFD 替换字符本身**不能直接写进源文件**：判据 ① 也会用在本测试文件自己身上，
 * 那样它会被自己判红（这正是它该抓的乱码）。所以用码点构造，全文保持可打印字符。
 */
const 替换字符 = String.fromCharCode(0xfffd);

/** 文件卫生判据：UTF-8 无 BOM ＋ 纯 LF ＋ 无行尾空白 ＋ 无 U+FFFD。 */
function 判文件卫生(buf) {
  const why = [];
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) why.push('含 UTF-8 BOM');
  const s = buf.toString('utf8');
  if (s.includes('\r')) why.push('含 CR（CRLF 会让 git diff --check 逐行报 trailing whitespace）');
  if (s.includes(替换字符)) why.push('含 U+FFFD 替换字符 —— 文件里有乱码字节，UTF-8 解码失败');
  const 行尾空 = s.split('\n').map((l, i) => (/[ \t]+$/.test(l) ? i + 1 : 0)).filter(Boolean);
  if (行尾空.length) why.push('第 ' + 行尾空.join(',') + ' 行有行尾空白');
  if (s.trim() === '') why.push('空文件');
  return { ok: why.length === 0, why };
}

// ══════════════════════════════════════════════════════════════════════
// 真实文件（只读）
// ══════════════════════════════════════════════════════════════════════

const HTML = fs.readFileSync(页面路径, 'utf8');
const 文案 = 可见文本(HTML);
const SRV = JSON.parse(fs.readFileSync(描述路径, 'utf8'));

// ══════════════════════════════════════════════════════════════════════
// 断言
// ══════════════════════════════════════════════════════════════════════

test('① 前置：两个交付件都在盘上、非空、卫生达标（空文件会让后面所有断言空跑绿灯）', () => {
  for (const p of [页面路径, 描述路径, __filename]) {
    assert.ok(fs.existsSync(p), '缺文件：' + path.relative(ROOT, p));
    const buf = fs.readFileSync(p);
    assert.ok(buf.length > 0, '空文件：' + path.relative(ROOT, p));
    const 卫生 = 判文件卫生(buf);
    assert.equal(卫生.ok, true, path.relative(ROOT, p) + '：' + 卫生.why.join('；'));
  }
  assert.ok(fs.statSync(页面路径).size > 2000, '落地页只有 ' + fs.statSync(页面路径).size + ' 字节 —— 空壳页会让反链检查空跑');
  // 抽取器本身先自证：能抽到、能区分
  assert.equal(抽链接('<a href="a.md">x</a>').length, 1);
  assert.equal(抽链接("<a href='b.md'>x</a>").length, 1, '单引号写法也必须抽得到，否则换个引号就能绕过反链检查');
  assert.equal(抽链接('<a data-href="c.md">x</a>').length, 0);
  assert.equal(抽id('<h2 id="z">a</h2>').length, 1);
  // 可见文本：注释里的字不算文案，正文里的算
  assert.equal(可见文本('<!-- 在线试用 --><p>正文</p>').includes('在线试用'), false, '注释必须被剥掉');
  assert.equal(可见文本('<!-- c --><p>正文</p>').includes('正文'), true);
});

test('② 反链检查：每条 href/src 要么命中本页 id，要么落在仓库内且真实存在', () => {
  const r = 判链接(HTML, 页面目录, ROOT);
  // —— 循环非空前置：先证明这一条真跑到了 N 条、且没有漏判
  const 抽到 = 抽链接(HTML);
  assert.ok(抽到.length >= 8, '只抽到 ' + 抽到.length + ' 条链接 —— 反链检查会空跑');
  assert.equal(抽到.filter((l) => l.值 === '').length, 0, '页面里有空链接');
  assert.equal(r.清单.length, 抽到.length, '判据漏判了：抽到 ' + 抽到.length + ' 条，判了 ' + r.清单.length + ' 条');
  assert.equal(r.片段数 + r.相对数 + r.外链数 + r.非法数, r.清单.length, '每条链接必须恰好归一类');
  assert.ok(r.片段数 >= 3, '片段类只判到 ' + r.片段数 + ' 条 —— 片段分支可能空过');
  assert.ok(r.相对数 >= 4, '仓库相对类只判到 ' + r.相对数 + ' 条 —— 死链检查可能空过');
  // —— 正判
  assert.equal(r.ok, true, r.why.join('；'));
});

test('③ 纯静态：没有脚本、内联事件、后端调用、表单按钮与内嵌框架', () => {
  const r = 判静态(HTML);
  assert.equal(r.ok, true, r.why.join('；'));
});

test('④ 不承诺在线试用：可见文案里没有试用/上手话术，且自述了「静态」', () => {
  const r = 判无在线试用(文案);
  assert.equal(r.ok, true, r.why.join('；'));
  assert.ok(文案.length > 200, '可见文案只有 ' + 文案.length + ' 字 —— 文案判据可能空跑');
});

test('⑤ UI 禁词：整份文件（含注释）不出现那两个字', () => {
  const r = 判禁词(HTML);
  assert.equal(r.ok, true, r.why.join('；'));
});

test('⑥ server.json：三必需字段齐全，name 是反向 DNS ＋ 恰好一个斜杠，version 是版本号', () => {
  const r = 判ServerJson(SRV);
  assert.equal(r.ok, true, r.why.join('；'));
  for (const k of ['name', 'description', 'version']) {
    assert.equal(typeof SRV[k], 'string', '必需字段缺失或类型不对：' + k);
  }
  assert.equal(SRV.name.split('/').length, 2, 'name 必须恰好一个斜杠');
  // 版本号须与根 package.json 同源，避免描述文件自己漂一个版本
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(SRV.version, pkg.version, 'server.json 的 version 与根 package.json 不一致');
});

test('⑦ 前向锁：根 README 在盘上就必须被链到（readme 轨道落盘后本条即生效）', () => {
  // 先自证「找得到 README 链接」这件事本身有效，否则这条条件锁是空壳
  const 样本 = 抽链接('<a href="../../README.md">r</a><a href="#a">a</a>');
  assert.equal(样本.length, 2);
  assert.ok(样本.some((l) => /(^|\/)README\.md$/i.test(l.值)), '抽取器找不到 README 链接 —— 条件锁会空过');
  const 有README = fs.existsSync(根README路径);
  const 已链 = 抽链接(HTML).some((l) => /(^|\/)README\.md$/i.test(l.值));
  console.log('    [landing] 根 README 存在 =', 有README, '· 落地页已链 =', 已链,
    有README ? '' : '（readme 轨道同批交付，落地后本条立即生效）');
  if (有README) {
    assert.ok(已链, '根 README.md 已在盘上，落地页却没链它 ⇒ 陌生人看不到上手路径');
  } else {
    assert.equal(已链, false, 'README.md 明明不存在，页面却链了它 —— 那是一条死链');
  }
});

test('⑨ 反向锁：每个判据都做过双向验证 —— 负例必红、正例必绿', () => {
  // —— 反链判据
  assert.equal(判链接('<a href="../../docs/绝对不存在的一件.md">x</a>', 页面目录, ROOT).ok, false, '死链必须红');
  assert.equal(判链接('<a href="../../../../Windows/win.ini">x</a>', 页面目录, ROOT).ok, false, '越出仓库根必须红');
  assert.equal(判链接('<a href="#nope">x</a><h2 id="yes">a</h2>', 页面目录, ROOT).ok, false, '无对应 id 的片段必须红');
  assert.equal(判链接('<a href="#">x</a><h2 id="yes">a</h2>', 页面目录, ROOT).ok, false, '空片段必须红');
  assert.equal(判链接('<a href="https://example.invalid/">x</a>', 页面目录, ROOT).ok, false, '零外链策略必须咬得住');
  assert.equal(判链接('<a href="mailto:a@b.c">x</a>', 页面目录, ROOT).ok, false, '非常规协议必须红');
  assert.equal(判链接('<a href="../../LICENSE">y</a><a href="#a">x</a><h2 id="a">a</h2>', 页面目录, ROOT).ok, true,
    '正例必须绿（否则这条判据只是恒红，不算闸门）');

  // —— 纯静态判据
  assert.equal(判静态(HTML).ok, true, '真实页面必须先过纯静态判据，否则负例无参照');
  assert.equal(判静态(HTML.replace('</main>', '<script>fetch("/api")</script></main>')).ok, false, '<script> 必须红');
  assert.equal(判静态(HTML.replace('</main>', '<button onclick="go()">开始</button></main>')).ok, false, '按钮＋内联事件必须红');
  assert.equal(判静态(HTML.replace('</main>', '<form action="x"><input></form></main>')).ok, false, '表单必须红');
  assert.equal(判静态(HTML.replace('</main>', '<iframe src="x"></iframe></main>')).ok, false, '内嵌框架必须红');
  assert.equal(判静态(HTML.replace('<meta charset="utf-8">', '')).ok, false, '缺 charset 必须红');
  // 注释里贴标签也要红，且必须是「script」这条理由红 —— 不能靠别的理由蒙对
  const 注释里的脚本 = 判静态('<!doctype html><meta charset="utf-8"><!-- <script> --><p>x</p>');
  assert.equal(注释里的脚本.ok, false, '注释里贴 script 标签必须红（判据注释里写明这是有意的严格）');
  assert.ok(注释里的脚本.why.some((w) => w.includes('script')), '必须是 script 这条判红，不能靠别的理由蒙对');

  // —— 试用话术判据
  assert.equal(判无在线试用('这是一个静态页').ok, true, '正例必须绿');
  assert.equal(判无在线试用('这是一个静态页，现在可以在线试用').ok, false, '试用话术必须红');
  assert.equal(判无在线试用('这是一个云端托管的页').ok, false, '云端话术必须红');
  assert.equal(判无在线试用('点此体验').ok, false, '没自述静态 + 出现上手话术，双错必红');

  // —— 禁词判据
  assert.equal(判禁词(HTML).ok, true, '真实页面必须先过禁词判据');
  assert.equal(判禁词('<p>模型给你' + UI禁词[0] + '</p>').ok, false, '禁词必须红');

  // —— server.json 判据
  assert.equal(判ServerJson(SRV).ok, true, '真实文件必须先过 schema 判据');
  assert.equal(判ServerJson({ name: SRV.name, description: SRV.description }).ok, false, '缺 version 必须红');
  assert.equal(判ServerJson({ ...SRV, name: 'p1b-ledger' }).ok, false, 'name 无斜杠必须红');
  assert.equal(判ServerJson({ ...SRV, name: 'a.b/c/d' }).ok, false, 'name 两个斜杠必须红');
  assert.equal(判ServerJson({ ...SRV, name: 'github/p1b' }).ok, false, 'name 域名只有一段必须红');
  assert.equal(判ServerJson({ ...SRV, name: 'io.github/p1b' }).ok, true,
    '两段域名是合法反向 DNS（github.io 的写法）—— 判据不能把合法形态也判红，否则就是乱红');
  assert.equal(判ServerJson({ ...SRV, name: '127.0.0.1/p1b' }).ok, false, '用 IP 冒充反向 DNS 必须红');
  assert.equal(判ServerJson({ ...SRV, version: 'latest' }).ok, false, 'version 非版本号必须红');
  assert.equal(判ServerJson({ ...SRV, description: '短' }).ok, false, 'description 过短必须红');
  assert.equal(判ServerJson({ ...SRV, apiKey: 'x' }).ok, false, '凭据字段必须红');

  // —— 文件卫生判据
  assert.equal(判文件卫生(fs.readFileSync(页面路径)).ok, true, '真实文件必须先过卫生判据');
  assert.equal(判文件卫生(Buffer.from('a\r\nb')).ok, false, 'CRLF 必须红');
  assert.equal(判文件卫生(Buffer.from([0xef, 0xbb, 0xbf, 0x61])).ok, false, 'BOM 必须红');
  assert.equal(判文件卫生(Buffer.from('a   \nb')).ok, false, '行尾空白必须红');
  assert.equal(判文件卫生(Buffer.from('a' + 替换字符 + 'b')).ok, false, '乱码字节必须红');
  assert.equal(判文件卫生(Buffer.from('   \n')).ok, false, '空文件必须红');
});
