'use strict';
/**
 * p1b/src/protocol/intakeSource.js —— 冻结判据的**只读投影读取器**（协议层第一块砖，2026-09-29）
 *
 * 【为什么要有这个文件】
 *   `p1b/src/routes/intake.js` 是 PREREG 冻结件：判据契约、拒收门、决策树、gate 状态机一个字不许动。
 *   而本项目的病根被反复记下过：**同一个口径被手抄成两份，半年后两份不一样，谁也说不清哪份对**
 *   （现存实例：`web/src/lib/noteChecklist.ts:36` 手抄了一份 QUESTION_COUNT，
 *     与 `intake.js:116` 并排躺着；两边今天还一致，纯属没漂过，不是因为有机制拦着）。
 *   所以协议层**不许自己再写一份数字**——它必须在运行时从冻结件里**读**出来。
 *
 * 【投影 = 读，不是抄】
 *   本文件只做两件事，且两件都失败即抛（fail loud），绝不「读不到就退回内置默认值」：
 *     ① 从 `p1b/src/routes/intake.js` **源码文本**里扫出冻结常量（判定/决策/取值域/计数）；
 *     ② 从 `docs/specs/万物分类清单-v2.md` **冻结清单**里扫出 22+3 问的**题面原文**。
 *   题面**不在代码里**（代码里只有 Q0 三问的短 label 与各层问数），题面的权威出处是清单；
 *   两边一旦对不上（代码说 4 问、清单说 3 问），**加载即抛错**，而不是让模型拿到一份自相矛盾的问卷。
 *
 * 【为什么不直接 require('./routes/intake') 取常量】
 *   两条硬理由：
 *     · `QUESTION_COUNT` **根本没有导出**（intake.js:485 的 module.exports 里没有它）——
 *       要 require 出来就得改冻结件，而冻结件不许改。
 *     · require 那个文件会把 `../deps` → p1a 的 db/llm/engine 整条链拖进来（intake.js:40-52）。
 *       协议层必须是**零副作用**的：一个只想读一份问卷的模块，不该顺带开数据库、更不该顺带连 LLM。
 *   ⇒ 读源码文本是这里唯一既能拿到数、又不碰运行时的办法。
 *   ★代价与对冲：源码文本可能被改写成非字面量（例如 `const QUESTION_COUNT = buildCounts();`）。
 *     对冲是 `assertPureLiteral()` —— 白名单外的字符一律抛错，`vm` 沙箱不给任何外部标识符，
 *     解析结果再 JSON 往返克隆回本 realm（跨 realm 对象原型不同，克隆也顺手掐掉 getter/代理）。
 *     `test/intake-protocol.test.cjs` 另有一条**同源锁**：把本文件读出的 8 个常量与
 *     **活模块真导出**逐字比对——静态读法一旦读歪，红的是测试，不是模型手里的问卷。
 *
 * 铁律：零新依赖（只用 node: 内建）· 零写库 · 零网络 · 零 LLM · 只读，不改任何既有文件。
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** 工作区根 —— 本文件位于 <root>/p1b/src/protocol/。
 *  ★此处**不写死任何绝对路径**：那会把打包人的盘符与目录名发到发行包里（发行闸 C2 专查这个）。 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
/** 冻结判据实现件（PREREG 冻结，只读）。 */
const INTAKE_PATH = path.join(ROOT, 'p1b', 'src', 'routes', 'intake.js');
/** 冻结清单（v2 冻结 2026-09-12 + v3 注记 2026-09-13；「本清单任何改动=新版本号」）。 */
const SPEC_PATH = path.join(ROOT, 'docs', 'specs', '万物分类清单-v2.md');
/** 拒收门三问的**可执行判据**（2026-09-18 第 3 期票 A 件；只登记，不复制其规则）。 */
const ANCHOR_GATE_PATH = path.join(ROOT, 'p1b', 'scripts', 'anchor-gate.cjs');
/** 拒收原因枚举与落库枚举的出处（intakeStore 私表契约件）。 */
const INTAKE_STORE_PATH = path.join(ROOT, 'p1b', 'src', 'db', 'intakeStore.js');
/** 从 intakeStore 投影的枚举：原因、层、结果、gate。 */
const STORE_CONSTANTS = ['REASONS', 'INTAKE_LAYERS', 'OUTCOMES', 'GATES'];

/** 从 intake.js 投影的常量名清单。少一个即抛——协议宁可加载失败，不发半份问卷。 */
const INTAKE_CONSTANTS = [
  'CHECKLIST_HASH',      // 清单版本号（intake.js:55）
  'GATE_QUESTIONS',      // 拒收门三问 key/reason/label（intake.js:58-62）
  'DECISION_ORDER',      // 决策树顺序（intake.js:114）
  'QUESTION_COUNT',      // 各层二元问数（intake.js:116）★未导出，只能静态读
  'PRIMARY_LAYERS',      // primary 合法取值（intake.js:118）
  'ALL_LAYERS',          // secondary 合法取值（intake.js:119）
  'ENGINE_TABLE',        // 层→引擎位（intake.js:127-135）
  'G2',                  // G2 状态（intake.js:138）
  'SCORABLE_LAYERS',     // 可 scored 的层（intake.js:140）
  'GATE_TRANSITIONS',    // gate 允许转移（intake.js:142-146）
  'TRUE_WORDS',          // 三态归一·真（intake.js:223）
  'FALSE_WORDS',         // 三态归一·假（intake.js:224）
  'UNKNOWN_WORDS',       // 三态归一·未知（intake.js:225）
];

// ────────────────────────────────────────────────────────────────────────────
// 一、源码字面量扫描器（字符串/注释感知；找不到或形状不对 ⇒ 抛）
// ────────────────────────────────────────────────────────────────────────────

/** 跳到当前行行尾（行注释用）。 */
function endOfLine(src, i) {
  const e = src.indexOf('\n', i);
  return e === -1 ? src.length : e + 1;
}

/** 跳过一段字符串（单/双/反引号皆支持，带转义）。 */
function endOfString(src, i, quote) {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === quote) return j + 1;
    j++;
  }
  throw new Error('intakeSource: 源码在第 ' + (lineOf(src, i)) + ' 行有未闭合的字符串字面量');
}

/** 取源码第 index 处所在行号（1 起）。 */
function lineOf(src, index) {
  let n = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') n++;
  return n;
}

/**
 * 从源码里扫出 `const <name> = <字面量>` 的字面量文本。
 * 逐字符走，**跳过注释与字符串**——否则文件头注释里一句 `const FOO = ...` 就会被当成真声明。
 * @returns {{text:string, line:number}}
 */
function scanConst(src, name) {
  return scanAssignment(src, new RegExp('^const[ \\t]+' + name + '[ \\t]*='), 'const ' + name);
}

/**
 * 扫出任意 `<声明头> = <字面量>` 的字面量文本。
 * 注释/字符串感知（见 scanConst）；找到后按括号配平或引号收尾，返回字面量原文。
 * @param {string} src 源码
 * @param {RegExp} head 锚在语句开头的声明头正则
 * @param {string} label 出错时给人看的名字
 * @returns {{text:string, line:number}}
 */
function scanAssignment(src, head, label) {
  const look = 40;
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = endOfLine(src, i); continue; }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      if (e === -1) throw new Error('intakeSource: 源码有未闭合的块注释');
      i = e + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { i = endOfString(src, i, c); continue; }
    if (head.test(src.slice(i, i + look))) {
      const declLine = lineOf(src, i);
      const eq = src.indexOf('=', i);
      let j = eq + 1;
      while (j < n && /\s/.test(src[j])) j++;
      const start = j;
      const open = src[j];
      if (open === '{' || open === '[') {
        // 括号配平扫描（字符串感知：字面量里的 '}' 不算配平）
        let depth = 0;
        while (j < n) {
          const ch = src[j];
          if (ch === '"' || ch === "'" || ch === '`') { j = endOfString(src, j, ch); continue; }
          if (ch === '{' || ch === '[') depth++;
          else if (ch === '}' || ch === ']') { depth--; if (depth === 0) { j++; break; } }
          j++;
        }
        if (depth !== 0) throw new Error('intakeSource: ' + label + ' 的字面量括号不配平（源码第 ' + declLine + ' 行）');
      } else if (open === '"' || open === "'") {
        j = endOfString(src, j, open);
      } else {
        // 原始值（字符串/数字/true/false/null），到分号或行尾为止
        while (j < n && src[j] !== ';' && src[j] !== '\n') j++;
      }
      return { text: src.slice(start, j).trim(), line: declLine };
    }
    i++;
  }
  throw new Error('intakeSource: 源码里找不到 `' + label + ' = `（' + INTAKE_PATH + '）——'
    + '声明被改名或被删了？协议加载失败是故意的：宁可不加载，也不发一份对不上的问卷。');
}

/**
 * 字面量白名单校验：只许 JSON 味的写法，标识符只许 true/false/null。
 * 这是「读源码」这条路的安全阀——若有人把常量改写成表达式，这里当场拒绝执行。
 */
function assertPureLiteral(text, name) {
  // 标点白名单：字面量可能跨行排版（intake.js 的 GATE_QUESTIONS 就是三行一项），
  //   所以**任何**空白都放行；`(` `)` `=` `?` `+`(作运算符) 等一律不放行。
  const PUNCT = new Set(['{', '}', '[', ']', ',', ':', '.', '-', '+']);
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") { i = endOfString(text, i, c); continue; }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_$]/.test(text[j])) j++;
      const word = text.slice(i, j);
      if (word === 'true' || word === 'false' || word === 'null') { i = j; continue; }
      // 对象**键**位（如 `{ key: 'Q0_1' }` 的 key）：后随 `:` ⇒ 只是属性名，不构成引用，求值安全。
      // 键位之外的标识符一律拒绝——那才是「把源码当代码执行」的口子。
      let k = j;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (text[k] === ':') { i = j; continue; }
      throw new Error('intakeSource: 常量 ' + name + ' 的字面量里出现非常量关键字 `' + word
        + '`（值位，非键位）——拒绝求值（协议只读字面量，不执行代码）。');
    }
    if (PUNCT.has(c) || /[0-9]/.test(c)) { i++; continue; }
    throw new Error('intakeSource: 常量 ' + name + ' 的字面量里出现非字面量字符 `' + c
      + '`——拒绝求值。');
  }
}

/** 字面量 → 本 realm 的普通对象（JSON 往返：跨 realm 原型不同，顺便掐掉 getter/代理）。 */
function literalValue(text, name) {
  assertPureLiteral(text, name);
  const raw = vm.runInNewContext('(' + text + ')', Object.create(null), { timeout: 1000 });
  return JSON.parse(JSON.stringify(raw));
}

// ────────────────────────────────────────────────────────────────────────────
// 二、公开读取函数
// ────────────────────────────────────────────────────────────────────────────

/** 读一次源码文本（进程内按路径缓存：这些是冻结件，一个进程里读一次足够）。 */
const _fileCache = new Map();
function readFileText(p) {
  if (_fileCache.has(p)) return _fileCache.get(p);
  let text;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch (e) {
    throw new Error('intakeSource: 读不到 ' + p + '（' + e.message + '）');
  }
  _fileCache.set(p, text);
  return text;
}

/** 读一次 intake.js 源码文本。 */
function intakeSourceText() { return readFileText(INTAKE_PATH); }

/**
 * 从任意源码文件里投影一个 `const <name> = <字面量>`。
 * 与 intake.js 同源的第三处引用（intakeStore 的拒收原因枚举、anchor-gate 的导出名）也走这条，
 * 免得那些值在协议里被手抄一遍。
 * @returns {{value:*, line:number}}
 */
function readConstFrom(filePath, name) {
  const hit = scanConst(readFileText(filePath), name);
  return { value: literalValue(hit.text, name), line: hit.line };
}

/**
 * 从冻结件投影出一份常量表。**协议层唯一的数字来源**。
 * @returns {{constants:Object, lines:Object<string,number>, path:string}}
 */
function readIntakeConstants() {
  const constants = {};
  const lines = {};
  for (const name of INTAKE_CONSTANTS) {
    const got = readConstFrom(INTAKE_PATH, name);
    constants[name] = got.value;
    lines[name] = got.line;
  }
  return { constants, lines, path: INTAKE_PATH };
}

/** 读一次冻结清单文本。 */
let _specLines = null;
function specLines() {
  if (_specLines === null) {
    let text;
    try {
      text = fs.readFileSync(SPEC_PATH, 'utf8');
    } catch (e) {
      throw new Error('intakeSource: 读不到冻结清单 ' + SPEC_PATH + '（' + e.message + '）');
    }
    _specLines = text.split(/\r?\n/);
  }
  return _specLines;
}

/** 定位一行（1 起）匹配 re 的第一条；找不到返回 null。 */
function findLine(lines, re, from) {
  for (let i = from || 0; i < lines.length; i++) if (re.test(lines[i])) return i;
  return null;
}

/** 从 start 行起，找下一条同级标题（`## `）；找不到则到文件尾。 */
function sectionEnd(lines, start) {
  for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) return i;
  return lines.length;
}

/**
 * 从冻结清单投影出 22+3 问的题面原文。
 *
 * ★本函数**不产生任何数字**：问数一律由调用方拿 `QUESTION_COUNT` 来对账，
 *   对不上就在下面 throw。清单自己写着「任何改动=新版本号」，代码与清单不同步是**版本事故**，
 *   不是可以「就近取一个」的小出入——所以让它响。
 *
 * @returns {{gate:Array, layers:Object<string,{title:string,declared_count:number,items:Array}>}}
 */
function readChecklistSpec() {
  const lines = specLines();

  // 第 0 步·拒收门：三问以 `- Q0-N ` 起头
  const s0 = findLine(lines, /^##\s*第 0 步/);
  if (s0 === null) throw new Error('intakeSource: 冻结清单里找不到「第 0 步」章节（' + SPEC_PATH + '）');
  const e0 = sectionEnd(lines, s0);
  const gate = [];
  for (let i = s0 + 1; i < e0; i++) {
    const m = /^-\s*(Q0-[123])\s*(.+)$/.exec(lines[i].trim());
    if (m) gate.push({ key: m[1], text: m[2].trim(), line: i + 1 });
  }
  if (gate.length !== 3) {
    throw new Error('intakeSource: 冻结清单第 0 步扫出 ' + gate.length + ' 问（应 3）——清单结构变了。');
  }

  // 第 1 步·按序判定：每个 `### Lx 标题（n 问全「是」）` 下跟 `1. ` `2. ` … 条目
  const s1 = findLine(lines, /^##\s*第 1 步/, e0);
  if (s1 === null) throw new Error('intakeSource: 冻结清单里找不到「第 1 步」章节');
  const e1 = sectionEnd(lines, s1);
  const layers = {};
  let cur = null;
  for (let i = s1 + 1; i < e1; i++) {
    const raw = lines[i];
    const hm = /^###\s*(L[1-6])\s*(.*)$/.exec(raw.trim());
    if (hm) {
      // 清单用的是全角括号「（3 问全「是」）」，半角一并收（不较真字形，只较真有没有这个数）
      const declared = /[（(]\s*(\d+)\s*问/.exec(hm[2]);
      if (!declared) {
        throw new Error('intakeSource: 清单第 ' + (i + 1) + ' 行 ' + hm[1]
          + ' 的标题里读不出问数（形如「（3 问全「是」）」）——问数不许猜。');
      }
      cur = { layer: hm[1], title: hm[2].trim(), declared_count: Number(declared[1]), items: [] };
      layers[hm[1]] = cur;
      continue;
    }
    if (!cur) continue;
    const im = /^(\d+)\.\s+(.+)$/.exec(raw.trim());
    if (im) cur.items.push({ index: Number(im[1]), text: im[2].trim(), line: i + 1 });
  }
  const got = Object.keys(layers);
  if (got.length !== 6) {
    throw new Error('intakeSource: 冻结清单第 1 步只扫到 ' + got.length + ' 层（应 6）：' + got.join(',') + '。');
  }
  for (const l of got) {
    const L = layers[l];
    if (L.items.length !== L.declared_count) {
      throw new Error('intakeSource: 清单 ' + l + ' 标题声明 ' + L.declared_count
        + ' 问、正文只有 ' + L.items.length + ' 条——清单自身不自洽，拒绝组装问卷。');
    }
    for (let k = 0; k < L.items.length; k++) {
      if (L.items[k].index !== k + 1) {
        throw new Error('intakeSource: 清单 ' + l + ' 条目编号不连续（期望 ' + (k + 1) + '，实得 ' + L.items[k].index + '）。');
      }
    }
  }
  return { gate, layers, path: SPEC_PATH };
}

/**
 * 从 intakeStore 投影落库侧枚举（拒收原因/层/结果/gate）。
 * 与 intake.js 的 GATE_QUESTIONS[].reason 对账：门里用到的 reason 必须在 REASONS 里，
 * 否则账本 CHECK 会拒掉一条本该留痕的拒收——这属于版本事故，响。
 */
function readStoreEnums() {
  const enums = {};
  const lines = {};
  for (const name of STORE_CONSTANTS) {
    const got = readConstFrom(INTAKE_STORE_PATH, name);
    enums[name] = got.value;
    lines[name] = got.line;
  }
  return { enums, lines, path: INTAKE_STORE_PATH };
}

/**
 * 从 anchor-gate.cjs 投影它导出的**名字**（拒收门三问的可执行判据，2026-09-18）。
 *
 * ★为什么这里不求值：`module.exports = { loadResolvers, q01, q02, q03, gate, summarize, PROD_BAND }`
 *   写的是**简写属性**——那是变量引用而非字面量，`assertPureLiteral` 会（并且应该）拒绝它。
 *   我们要的只是**名字清单**（用来登记「哪条判据是可执行的」），不关心它们的值，
 *   所以这里只切名字，不执行。
 * @returns {{names:string[], line:number, path:string}}
 */
function readAnchorGateExports() {
  const src = readFileText(ANCHOR_GATE_PATH);
  const hit = scanAssignment(src, /^module\.exports[ \t]*=/, 'module.exports');
  if (hit.text[0] !== '{' || hit.text[hit.text.length - 1] !== '}') {
    throw new Error('intakeSource: anchor-gate 的 module.exports 不是对象字面量（' + ANCHOR_GATE_PATH + '）。');
  }
  const body = hit.text.slice(1, -1);
  const names = [];
  let depth = 0;
  let cur = '';
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '"' || c === "'" || c === '`') {
      const end = endOfString(body, i, c);
      cur += body.slice(i, end);
      i = end;
      continue;
    }
    if (c === '/' && body[i + 1] === '/') { i = body.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '/' && body[i + 1] === '*') { const e = body.indexOf('*/', i + 2); i = e === -1 ? body.length : e + 2; continue; }
    if (c === '{' || c === '[' || c === '(') { depth++; cur += c; i++; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; cur += c; i++; continue; }
    if (c === ',' && depth === 0) { names.push(cur); cur = ''; i++; continue; }
    cur += c;
    i++;
  }
  if (cur.trim()) names.push(cur);
  const cleaned = names
    .map((s) => s.split(':')[0].trim())   // `名字: 值` 取名字；简写 `名字` 原样
    .map((s) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s) ? s : null))
    .filter((s) => s !== null);
  return { names: cleaned, line: hit.line, path: ANCHOR_GATE_PATH };
}

module.exports = {
  ROOT,
  INTAKE_PATH,
  SPEC_PATH,
  ANCHOR_GATE_PATH,
  INTAKE_STORE_PATH,
  INTAKE_CONSTANTS,
  STORE_CONSTANTS,
  readIntakeConstants,
  readChecklistSpec,
  readStoreEnums,
  readAnchorGateExports,
  readConstFrom,
  readFileText,
  scanConst,
  scanAssignment,
  assertPureLiteral,
  lineOf,
};
