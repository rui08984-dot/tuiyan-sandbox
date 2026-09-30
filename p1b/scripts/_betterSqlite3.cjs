'use strict';
/**
 * p1b/scripts/_betterSqlite3.cjs —— 原生模块的**多候选解析**（模块 deps-fix · SPEC-deps-fix）
 *
 * ── 它替掉的那一行，以及为什么要替 ──────────────────────────────────────────
 *   const D = require(path.join(ROOT, 'p1a-terminal', 'node_modules', 'better-sqlite3'));
 * 这行在源码树里能跑，但它是**猜布局**：假定 node_modules 一定在 p1a-terminal 底下。
 * 而打包有不止一种合理布局（按包放 / 上提到 app/node_modules/ / npm install 落到上提位置），
 * 猜中一种就够用，猜不中就炸，★而且是**运行时才炸**——用户双击启动器才看见。
 *
 *   今天的实际分布（2026-09-30 实测）：better-sqlite3 **只**装在 p1a-terminal/node_modules，
 *   仓库根与 p1b/node_modules 都没有 ⇒ 标准 `require('better-sqlite3')` 在 p1b/scripts/ 下
 *   **必然失败**（MODULE_NOT_FOUND）。所以「先试候选、最后才退标准解析」这个顺序不能反。
 *
 * ── 候选顺序（第一项＝今天那一行，开发态行为逐字节不变）────────────────────
 *   ① <root>/p1a-terminal/node_modules/<name>   源码树 · zip 的「按包放」布局
 *   ② <root>/node_modules/<name>                上提布局：zip 里的 app/node_modules/
 *   ③ <root>/p1b/node_modules/<name>             p1b 自带一份
 *   ④ 标准 require 解析（以 `from` 为起点走 node_modules 链）  ← npm install 布局
 * 每一次尝试都记进 `tried`（谁赢了 / 为什么输），成功与失败都有凭据，不靠猜。
 *
 * ── 失败时的错误信息必须**列出试过哪几个位置** ──────────────────────────────
 * 否则用户只看见一句 MODULE_NOT_FOUND，无从下手。第一行给**相对路径**的紧凑清单
 * （`exp-health.cjs` 既有的一行输出只有 120 字符，相对形式才活得下来），
 * 后面逐条给绝对路径与失败原因。错误对象另挂 `code`/`tried`/`candidates`，
 * 调用方要判就别去 match 文案。
 *
 * ── 本件的边界 ────────────────────────────────────────────────────────────
 *   · **只管「怎么找到」**：`new D(dbPath, {readonly:true})` 一字不动，调用方自己开库。
 *   · **绝不静默兜底**：全都不命中就抛错（spec Boundaries 的 Never 条）。
 *   · 顶层零副作用、零第三方依赖、零写盘 ⇒ 可以被 require 而不改变任何进程状态。
 *   · 导出的 `resolveNativeModule(name, opts)` 是**通用**的（模块名是参数），
 *     另 64 处硬编码/拼接路径等 P1 迁到 node:sqlite 时可一行改完；
 *     清单见 `docs/原生模块路径登记表-deps-fix.md`（登记不修）。
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

/** 本文件在 `<repo>/p1b/scripts/` ⇒ 仓库根 = 上溯两级（与各脚本的 `ROOT` 口径一致）。 */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** 抛错时挂在 `err.code` 上的值。调用方判失败请只认这个，别 match 文案。 */
const NATIVE_MODULE_NOT_FOUND = 'ERR_P1B_NATIVE_MODULE_NOT_FOUND';

/** 本项目里最常被这样猜路径的那个包名。 */
const DEFAULT_MODULE = 'better-sqlite3';

/**
 * 默认候选表。**顺序即优先级**，不要随手重排——
 * 第 ① 项必须与改造前那一行逐字符相同，否则「开发态行为零变化」这条就破了。
 * @param {string} name 模块名（如 `better-sqlite3`）
 * @param {string} root 仓库根
 * @returns {string[]} 绝对路径候选
 */
function defaultCandidates(name, root) {
  return [
    path.join(root, 'p1a-terminal', 'node_modules', name),
    path.join(root, 'node_modules', name),
    path.join(root, 'p1b', 'node_modules', name),
  ];
}

/**
 * 候选表（不含「标准 require 解析」那一项——那不是一个路径，是一次解析）。
 *
 * @param {string} name 模块名
 * @param {object} [opts]
 *   `root`             仓库根，缺省 REPO_ROOT（测试注入用）
 *   `candidates`       ★**全量覆盖**候选表（反向锁与自定义布局走这条）
 *   `extraCandidates`  追加在默认表之后
 * @returns {string[]}
 */
function candidatePaths(name, opts) {
  const o = opts || {};
  const n = String(name || '').trim();
  if (!n) throw new TypeError('[p1b] candidatePaths 需要一个模块名');
  if (Array.isArray(o.candidates)) return o.candidates.slice();
  const list = defaultCandidates(n, o.root || REPO_ROOT);
  return Array.isArray(o.extraCandidates) ? list.concat(o.extraCandidates) : list;
}

/** 试一次，返回 {ok, mod|reason}。**不吞异常语义**：失败原因原样带出去。 */
function attempt(loader) {
  try {
    return { ok: true, mod: loader() };
  } catch (e) {
    const msg = String((e && e.message) || e).split('\n')[0];
    const code = String((e && e.code) || '');
    return { ok: false, reason: (code ? code + '：' : '') + msg };
  }
}

/** 把绝对路径压成相对本次解析所用 root 的形式（压不动就原样返回）——只为让首行尽量短。 */
function shorten(p, root) {
  const r = path.relative(root, p);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p;
}

/** 组装那条「说人话」的错误。★它必须逐条列出试过哪几个位置与失败原因。 */
function notFoundError(name, from, allowStandard, tried, candidates, root) {
  const compact = candidates.length
    ? candidates.map((p) => shorten(p, root)).join('、')
    : '（候选表是空的）';
  const L = [];
  L.push('[p1b] 找不到原生模块 ' + name + '。试过：' + compact
    + (allowStandard ? '、标准 require 解析' : '') + '（全部失败）。');
  L.push('逐个位置与失败原因：');
  tried.forEach((t, i) => {
    L.push('  ' + (i + 1) + '. [' + t.via + '] ' + t.spec + ' —— ' + (t.reason || '失败'));
  });
  L.push('修法（任选其一）：① 在上面任一位置放上该模块；'
    + '② 解发行版 zip（tools/pack.mjs 把它放到 app/node_modules/）；'
    + '③ 在仓库根跑 npm install，让标准 require 解析命中。');
  if (!allowStandard) L.push('（本次调用显式关掉了标准 require 解析，只试了上面列出的候选。）');

  const e = new Error(L.join('\n'));
  e.code = NATIVE_MODULE_NOT_FOUND;
  e.module = name;
  e.tried = tried;            // [{via, spec, ok, reason}]，含成功那一条
  e.candidates = candidates.slice();
  e.from = from;
  e.allowStandard = allowStandard;
  return e;
}

/**
 * ★核心：多候选解析一个原生模块，并**给出过程凭据**。
 *
 * @param {string} name 模块名（通用：本函数不绑定 better-sqlite3）
 * @param {object} [opts]
 *   `root`            仓库根，缺省 REPO_ROOT
 *   `candidates`      全量覆盖候选表
 *   `extraCandidates` 追加候选
 *   `from`            标准 require 解析的起点文件，缺省本文件
 *   `allowStandard`   是否允许最后退回标准 require 解析，缺省 true
 * @returns {{name:string, mod:any, via:'candidate'|'standard', candidate:string|null,
 *            from:string, allowStandard:boolean, tried:Array}}
 * @throws {Error & {code:'ERR_P1B_NATIVE_MODULE_NOT_FOUND'}} 全都不命中时
 */
function resolveNativeModuleTrace(name, opts) {
  const o = opts || {};
  const n = String(name || '').trim();
  if (!n) throw new TypeError('[p1b] resolveNativeModule 需要一个模块名');
  const from = o.from || __filename;
  const allowStandard = o.allowStandard !== false;
  const candidates = candidatePaths(n, o);
  const tried = [];

  for (const spec of candidates) {
    if (!fs.existsSync(spec)) {
      tried.push({ via: 'candidate', spec, ok: false, reason: '该位置不存在' });
      continue;
    }
    const r = attempt(() => require(spec));
    tried.push({ via: 'candidate', spec, ok: r.ok, reason: r.reason });
    if (r.ok) {
      return { name: n, mod: r.mod, via: 'candidate', candidate: spec, from, allowStandard, tried };
    }
  }

  if (allowStandard) {
    const r = attempt(() => createRequire(from)(n));
    tried.push({ via: 'standard', spec: n, ok: r.ok, reason: r.reason, from });
    if (r.ok) {
      return { name: n, mod: r.mod, via: 'standard', candidate: null, from, allowStandard, tried };
    }
  }

  throw notFoundError(n, from, allowStandard, tried, candidates, o.root || REPO_ROOT);
}

/**
 * 只要模块本体（`better-sqlite3` 的构造函数等）。要过程凭据用 `resolveNativeModuleTrace`。
 * @param {string} name
 * @param {object} [opts] 同上
 * @returns {any} 被 require 出来的模块导出
 */
function resolveNativeModule(name, opts) {
  return resolveNativeModuleTrace(name, opts).mod;
}

/** 本项目那一个：better-sqlite3。★调用方拿它去 `new D(dbPath, {readonly:true})`，用法一字不动。 */
function betterSqlite3(opts) {
  return resolveNativeModule(DEFAULT_MODULE, opts);
}

/** 同上，但带过程凭据（谁赢了 / 试过哪几个 / 为什么输）。 */
function betterSqlite3Trace(opts) {
  return resolveNativeModuleTrace(DEFAULT_MODULE, opts);
}

module.exports = {
  REPO_ROOT,
  NATIVE_MODULE_NOT_FOUND,
  DEFAULT_MODULE,
  defaultCandidates,
  candidatePaths,
  resolveNativeModule,
  resolveNativeModuleTrace,
  betterSqlite3,
  betterSqlite3Trace,
};
