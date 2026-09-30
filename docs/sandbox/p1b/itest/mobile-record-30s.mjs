#!/usr/bin/env node
// mobile-record-30s.mjs —— 30 秒竖屏录屏的**骨架**（2026-09-30 · SPEC-ci-landing-mobile 模块 3 第 3 条）
//
// 用法（三条子命令，可分开跑）：
//   node mobile-record-30s.mjs --prompts            打印 30 秒竖屏分镜提词器（零依赖、零前置，永远能跑）
//   node mobile-record-30s.mjs --self-test          自检：合成一段最小 MP4 头，验证下面的解析器不是空跑
//   node mobile-record-30s.mjs --verify <file.mp4>  核验录屏产物：容器 / 时长 / 尺寸方向
//   node mobile-record-30s.mjs --frames <outDir>    无头逐帧抓图 ＋ 打印 ffmpeg 合成命令（★见下方红字）
//
// ★★ 三条纪律（写这个文件的原因就是守住它们）：
//   ① **无头产物不是真机证据。** --frames 抓出来的每一张都带 `HEADLESS-NOT-REAL-` 前缀，
//      这是故意的：让文件名单独一个名字就说明它是什么，不给「以后被人当手机截图」留余地。
//      项目至今唯一一次自称「手机实测」的是 docs/sandbox/p1b/itest/p5-integration-report.md，
//      第 4 行写着「真浏览器 = Chrome headless CDP」——那不是真机。
//   ② **零新依赖。** 只用 node: 内置模块。**本脚本不自己编码 mp4**（无依赖做不到），
//      它只做三件事：给提词、核验产物、把帧序列拼成视频的**命令**打印出来。
//   ③ **自动化验不出「这是不是真手机」。** --verify 能验的只有客观量（容器、时长、竖屏）；
//      「这段是不是手机录的」只能由人看。脚本会把实测数字打出来，并明说它没验什么。
//
// 退出码：0=过；1=校验红；2=用法错。

import fs from 'node:fs';
import path from 'node:path';

// ── 参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const 说 = (s) => process.stdout.write(s + '\n');

function 用法(码) {
  说('用法：');
  说('  node mobile-record-30s.mjs --prompts');
  说('  node mobile-record-30s.mjs --self-test');
  说('  node mobile-record-30s.mjs --verify <file.mp4>');
  说('  node mobile-record-30s.mjs --frames <outDir>');
  process.exit(码);
}

// ── 30 秒竖屏分镜 ───────────────────────────────────────────────────────
// 节奏按「一屏一件事」排：30 秒里塞三个动作，每个 10 秒含 2 秒起手与 2 秒收尾。
// 时间点是**提词**，不是闸门：真人录屏会手抖，±2 秒不算失败（--verify 的时长窗口也放宽到 25–40s）。
const 分镜 = [
  { t: '00:00–00:02', 动作: '起手：停在首页顶栏，不动', 说明: '**别急着滑**——先让观众看清这排导航右边还有东西' },
  { t: '00:02–00:05', 动作: '手指横滑顶栏（从右往左）', 说明: '慢一点，让那根 3px 指示条在画面里被看见' },
  { t: '00:05–00:08', 动作: '点「记一笔」，输入一句判断并提交', 说明: '拇指单手够得到输入框' },
  { t: '00:08–00:11', 动作: '点「待落定」，把刚记的那条落定', 说明: '落定后应有明确反馈，不是静悄悄地成功' },
  { t: '00:11–00:14', 动作: '点「我在哪儿偏了」', 说明: '回声里看得见刚落定那条的偏差' },
  { t: '00:14–00:18', 动作: '停在回声页别动', 说明: '给观众读完的时间' },
  { t: '00:18–00:22', 动作: '返回顶栏，再次横滑顶栏', 说明: '第二次出现指示条＝观众才会记住它' },
  { t: '00:22–00:27', 动作: '进「现场」，停 3 秒（深色页）', 说明: '深色下指示条也要看得见' },
  { t: '00:27–00:30', 动作: '退出现场，静止收尾', 说明: '结尾不切黑，留 1 秒静帧' },
];

function prompts() {
  说('═══ 30 秒竖屏录屏 · 分镜提词器 ═══');
  说('');
  说('规格：竖屏（高 > 宽）｜ 约 30 秒（25–40 秒都收）｜ 全程不切黑、不加字幕、不加音乐');
  说('机位：手机**竖着拿**，屏幕正对镜头；不要横过来录。');
  说('★录制方式二选一：');
  说('  A（推荐，真机证据）：用手机自带录屏，边照着下面的分镜操作边录。');
  说('  B（不算真机证据）：用 --frames 抓无头帧序列。★**这一条产出的东西不算真机记录**，');
  说('     文件名带 HEADLESS-NOT-REAL- 前缀，用到任何对外材料里都必须原样带上这个标注。');
  说('');
  for (const s of 分镜) {
    说(`  ${s.t}  ${s.动作}`);
    说(`                 ${s.说明}`);
  }
  说('');
  说('录完先核验：node mobile-record-30s.mjs --verify <你的录屏文件>');
}

// ── MP4 盒子解析（零依赖，只为 --verify 服务）─────────────────────────────
/**
 * 逐个列出 [start,end) 区间内的同级盒子。
 * size=1 ⇒ 后面 8 字节是 largesize；size=0 ⇒ 本盒子到区间末尾。
 */
function 列盒子(buf, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let head = 8;
    if (size === 1) {
      if (p + 16 > end) break;
      const big = buf.readBigUInt64BE(p + 8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(big);
      head = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < head || p + size > end) break;
    out.push({ type, start: p, bodyStart: p + head, end: p + size });
    p += size;
  }
  return out;
}

function 找子盒(buf, 盒, type) {
  return 列盒子(buf, 盒.bodyStart, 盒.end).find((b) => b.type === type);
}

/** mvhd → { timescale, durationSec } */
function 读时长(buf, moov) {
  const mvhd = 找子盒(buf, moov, 'mvhd');
  if (!mvhd) return null;
  const b = mvhd.bodyStart;
  const version = buf[b];
  let p = b + 4;
  if (version === 1) { p += 16; const ts = buf.readUInt32BE(p); const du = Number(buf.readBigUInt64BE(p + 4)); p += 12; return ts ? du / ts : null; }
  p += 8;
  const ts = buf.readUInt32BE(p);
  const du = buf.readUInt32BE(p + 4);
  return ts ? du / ts : null;
}

/** 全部 tkhd → 取画面最大的那一条的 16.16 定点宽高 */
function 读画面尺寸(buf, moov) {
  const 候选 = [];
  for (const trak of 列盒子(buf, moov.bodyStart, moov.end).filter((b) => b.type === 'trak')) {
    const tkhd = 找子盒(buf, trak, 'tkhd');
    if (!tkhd) continue;
    const version = buf[tkhd.bodyStart];
    let p = tkhd.bodyStart + 4;
    p += version === 1 ? 16 + 4 + 4 + 8 : 8 + 4 + 4 + 4;   // 创建/修改/轨道号/保留/时长
    p += 8 + 2 + 2 + 2 + 2;                                 // 保留/层/组/音量/保留
    p += 36;                                                // 变换矩阵
    if (p + 8 > tkhd.end) continue;
    const w = buf.readUInt32BE(p) / 65536;
    const h = buf.readUInt32BE(p + 4) / 65536;
    if (w > 0 && h > 0) 候选.push({ w: Math.round(w), h: Math.round(h) });
  }
  if (!候选.length) return null;
  候选.sort((a, b) => b.w * b.h - a.w * a.h);
  return 候选[0];
}

/** 探容器：要求顶层存在 ftyp（mp4/mov 家族），据此把 webm/mkv 挡在外面 */
function 读容器(buf) {
  const top = 列盒子(buf, 0, buf.length);
  const ftyp = top.find((b) => b.type === 'ftyp');
  if (!ftyp) return null;
  return buf.toString('latin1', ftyp.bodyStart, Math.min(ftyp.bodyStart + 4, ftyp.end));
}

const 时长窗口 = [25, 40];   // 秒。30 秒是目标值，窗口是给真人录屏的手抖留的余量，不是闸门放宽

function verify(file) {
  if (!fs.existsSync(file)) { 说('红：文件不存在 ' + file); return 1; }
  const buf = fs.readFileSync(file);
  const 行 = [];
  let 红 = 0;
  const 判 = (名, 过, 详情) => {
    行.push(`${过 ? '✔' : '✖'} ${名}${详情 ? '  —— ' + 详情 : ''}`);
    if (!过) 红++;
  };

  判('文件非空', buf.length > 0, buf.length + ' 字节');
  const 容器 = 读容器(buf);
  判('是 mp4/mov 家族（顶层有 ftyp）', !!容器, 容器 ? 'major brand = ' + 容器 : '未找到 ftyp（webm/mkv 不收）');

  const moov = 容器 ? 列盒子(buf, 0, buf.length).find((b) => b.type === 'moov') : null;
  判('有 moov（元数据盒子）', !!moov, moov ? '' : '文件可能没写完（录屏被掐断？）');

  if (moov) {
    const 秒 = 读时长(buf, moov);
    判(`时长在 ${时长窗口[0]}–${时长窗口[1]} 秒之间`, 秒 != null && 秒 >= 时长窗口[0] && 秒 <= 时长窗口[1],
      秒 == null ? '读不出 mvhd' : '实测 ' + 秒.toFixed(1) + ' 秒');
    const 尺寸 = 读画面尺寸(buf, moov);
    判('画面是竖屏（高 > 宽）', !!尺寸 && 尺寸.h > 尺寸.w, 尺寸 ? `${尺寸.w}x${尺寸.h}` : '读不出 tkhd');
  }

  说('═══ 录屏产物核验：' + path.basename(file) + ' ═══');
  for (const l of 行) 说('  ' + l);
  说('');
  说('★本脚本**没有**验、也验不了的一件事：这段录像是不是真手机录的。');
  说('  上面只验了容器、时长、方向。要判「是不是真机」，得人看画面：');
  说('  有没有刘海/圆角/系统状态栏、有没有真手指的遮挡、是不是录的别人的屏。');
  说('  ★若这段来自 --frames（无头抓帧合成），它**不是**真机证据，');
  说('    在任何对外材料里都要带上 HEADLESS-NOT-REAL- 的标注。');
  return 红 ? 1 : 0;
}

// ── 自检：用合成 MP4 头证明解析器真的在解析（不许空跑绿灯）──────────────
/** 造一个最小可解析的 ftyp + moov(mvhd + trak(tkhd)) 结构 */
function 合成MP4({ 时长秒, 宽, 高 }) {
  const 盒 = (type, body) => {
    const b = Buffer.alloc(8 + body.length);
    b.writeUInt32BE(b.length, 0);
    b.write(type, 4, 'latin1');
    body.copy(b, 8);
    return b;
  };
  // mvhd（version 0）字段宽度：版本标志 4｜创建 4｜修改 4｜timescale 4｜duration 4｜其后固定 80
  const timescale = 600;
  const mvhdBody = Buffer.alloc(4 + 4 + 4 + 4 + 4 + 80);
  mvhdBody.writeUInt32BE(0, 0);          // version+flags
  mvhdBody.writeUInt32BE(timescale, 12);
  mvhdBody.writeUInt32BE(Math.round(时长秒 * timescale), 16);

  // tkhd（version 0）字段宽度：版本标志 4｜创建 4｜修改 4｜轨道号 4｜保留 4｜时长 4
  //                              ｜保留 8｜层 2｜组 2｜音量 2｜保留 2｜矩阵 36｜宽 4｜高 4
  // ★这 14 项加起来是 **84**（4+20+8+8+36+8）。初版写成 80，--self-test 当场把解析器判红——
  //   差 4 字节时 tkhd 尾部读不到，宽高返回 null。**别再靠手算，字段宽度就写在这一行。**
  const tkhdBody = Buffer.alloc(4 + 4 + 4 + 4 + 4 + 4 + 8 + 2 + 2 + 2 + 2 + 36 + 4 + 4);
  tkhdBody.writeUInt32BE(0, 0);
  tkhdBody.writeUInt32BE(Math.round(时长秒 * timescale), 20);
  tkhdBody.writeUInt32BE(宽 * 65536, tkhdBody.length - 8);
  tkhdBody.writeUInt32BE(高 * 65536, tkhdBody.length - 4);

  const moov = 盒('moov', Buffer.concat([盒('mvhd', mvhdBody), 盒('trak', 盒('tkhd', tkhdBody))]));
  return Buffer.concat([盒('ftyp', Buffer.from('isommp42', 'latin1')), moov]);
}

function selfTest() {
  const 样本 = [
    { 名: '30 秒竖屏 1080x1920', 时长秒: 30, 宽: 1080, 高: 1920 },
    { 名: '29.4 秒竖屏 1170x2532（真机常见分辨率档）', 时长秒: 29.4, 宽: 1170, 高: 2532 },
    { 名: '5 秒横屏 1920x1080（应判红：太短且不竖）', 时长秒: 5, 宽: 1920, 高: 1080 },
  ];
  let 红 = 0;
  说('═══ 解析器自检（合成 MP4 头，非真实录像）═══');
  for (const s of 样本) {
    const buf = 合成MP4({ 时长秒: s.时长秒, 宽: s.宽, 高: s.高 });
    const moov = 列盒子(buf, 0, buf.length).find((b) => b.type === 'moov');
    const 秒 = moov && 读时长(buf, moov);
    const 尺寸 = moov && 读画面尺寸(buf, moov);
    const 品牌 = 读容器(buf);
    // 四条判据各自独立判，不合并成一个「大概对」：
    //   时长回到毫秒级、宽高一字不差、竖屏判定方向正确、容器品牌认得出。
    //   任何一条只差 1 像素或 0.01 秒都算红——这个自检的用处就是抓「解析器悄悄读偏」。
    const 时长对 = 秒 != null && Math.abs(秒 - s.时长秒) < 0.05;
    const 宽高对 = !!尺寸 && 尺寸.w === s.宽 && 尺寸.h === s.高;
    const 竖屏对 = !!尺寸 && (尺寸.h > 尺寸.w) === (s.高 > s.宽);
    const 品牌对 = !!品牌;
    const 过 = 时长对 && 宽高对 && 竖屏对 && 品牌对;
    if (!过) 红++;
    说(`  ${过 ? '✔' : '✖'} ${s.名}  时长=${秒 == null ? '读不出' : 秒.toFixed(2) + 's'}(${时长对 ? '对' : '错'})` +
      `  尺寸=${尺寸 ? 尺寸.w + 'x' + 尺寸.h : '读不出'}(${宽高对 ? '对' : '错'})` +
      `  竖屏=${尺寸 ? (尺寸.h > 尺寸.w) : '读不出'}(${竖屏对 ? '对' : '错'})` +
      `  品牌=${品牌 || '无'}(${品牌对 ? '对' : '错'})`);
  }
  // 反向锁：不是 mp4（无 ftyp）必须判不出容器，否则 --verify 会对任何文件都绿
  const 非MP4 = Buffer.from('not an mp4 at all, just some bytes here', 'latin1');
  const 无容器 = 读容器(非MP4) === null;
  if (!无容器) 红++;
  说(`  ${无容器 ? '✔' : '✖'} 反向锁：非 mp4 数据被判不出容器`);
  const 空moov = Buffer.from([0, 0, 0, 0], 'binary');
  const 无moov = !列盒子(空moov, 0, 空moov.length).some((b) => b.type === 'moov');
  if (!无moov) 红++;
  说(`  ${无moov ? '✔' : '✖'} 反向锁：空数据里没有 moov（解析器没有空产出 moov）`);
  说('');
  if (红) { 说(`自检红：${红} 项不符。--verify 的判据不可信，先修解析器。`); return 1; }
  说('自检全过：--verify 的三条判据（容器 / 时长 / 竖屏）都能真的从字节里读出来。');
  return 0;
}

// ── 无头逐帧抓图（★产出不算真机证据）──────────────────────────────────
const 前端 = 'http://127.0.0.1:8787';   // 本机回环；换成局域网地址即构成 C3 判红的端点串，故此处写死回环
const 视口 = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const 前缀 = 'HEADLESS-NOT-REAL-';

async function frames(outDir) {
  说('═══ 无头逐帧抓图（★产出不是真机证据）═══');
  说('');
  说('本模式需要两个**已在运行**的前置（本脚本不负责起它们）：');
  说(`  ① 后端在 ${前端} 上可达`);
  说('  ② 一个开着远程调试端口的 Chrome（CDP 端口从环境变量 MOBILE_CDP 读，默认 9223）');
  说('');
  说('★产物文件名一律带 ' + 前缀 + ' 前缀：');
  说('  这不是谦虚，是**防误用**——一个不带标记的 mp4 很容易在半年后被当成手机录屏。');
  说('');

  const cdpPort = process.env.MOBILE_CDP || '9223';
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let 红 = 0;

  let target;
  try {
    const r = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' });
    target = await r.json();
  } catch (e) {
    说('红：连不上 Chrome 调试端口 http://127.0.0.1:' + cdpPort + '（' + e.message + '）');
    说('    ⇒ 先起一个带远程调试的 Chrome，或用 MOBILE_CDP 指定别的端口。');
    return 1;
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
  const send = (method, params) => new Promise((res) => {
    const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });

  fs.mkdirSync(outDir, { recursive: true });
  await send('Emulation.setUserAgentOverride', { userAgent: ua });
  await send('Emulation.setDeviceMetricsOverride', 视口);

  // 30 秒按 1fps 抓 ⇒ 30 张；1fps 够看清版式变化，不够看清动画（那正是本轨不靠它做证据的原因）
  const 总秒 = 30, 帧率 = 1;
  let 帧 = 0;
  说(`开始抓帧：${总秒} 秒 @ ${帧率}fps = ${总秒 * 帧率} 张 → ${outDir}`);
  for (let s = 0; s < 总秒; s++) {
    const now = new Date().toISOString().slice(11, 19);
    // 分镜只给到「第几秒该在哪个路由」，不代替真人操作：无头环境里页面是空的
    if (s === 0) await send('Page.navigate', { url: `${前端}/#/note` });
    if (s === 10) await send('Page.navigate', { url: `${前端}/#/resolve` });
    if (s === 20) await send('Page.navigate', { url: `${前端}/#/where-off` });
    if (s === 27) await send('Page.navigate', { url: `${前端}/#/live` });
    await sleep(120);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (!shot.result || !shot.result.data) { 说('  ✖ ' + now + ' 抓帧失败（页面可能没起来）'); 红++; }
    else {
      const f = path.join(outDir, `${前缀}${String(帧).padStart(2, '0')}-${now.replace(/:/g, '')}.png`);
      fs.writeFileSync(f, Buffer.from(shot.result.data, 'base64'));
      说('  ✔ ' + path.basename(f));
    }
    帧++;
    await sleep(1000 / 帧率 - 120);
  }
  ws.close();
  说('');
  说(`抓了 ${帧} 张。合成命令（ffmpeg 是外部程序，**不是**本项目的依赖，机器上没有就先别合成）：`);
  说(`  ffmpeg -framerate ${帧率} -i "${outDir}/${前缀}%02d-*.png" -c:v libx264 -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" ${前缀}30s-竖屏.mp4`);
  说('');
  说('★再强调一次：上面产出的 mp4 **不是真机证据**。它的文件名、它的说明、它的回执都必须带着这句话。');
  说('  真机录屏请用手机自带录屏，录完用 --verify 核验，并把结果填进 mobile-真机实测回执-20260930.md。');
  return 0;
}

// ── 入口 ────────────────────────────────────────────────────────────────
const 子命令 = argv[0];
if (子命令 === '--prompts') prompts();
else if (子命令 === '--self-test') process.exit(selfTest());
else if (子命令 === '--verify') {
  if (!argv[1]) 用法(2);
  process.exit(verify(argv[1]));
} else if (子命令 === '--frames') {
  if (!argv[1]) 用法(2);
  process.exit(await frames(argv[1]));
} else 用法(2);
