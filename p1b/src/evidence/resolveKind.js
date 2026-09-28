'use strict';
/**
 * p1b/src/evidence/resolveKind.js —— 「真值锚 kind 支持表」的**单一真源**（派生，不另立）。
 *
 * 【为什么需要它】
 * 落注端点此前只收事件 id 数组，于是走 HTTP 建出来的行没有真值锚、没有基率；
 * 而基率读数与真值锚端点一律用 `json_extract(evidence_json,'$[0].resolve.kind')` 检索
 * ⇒ 那类行查不到历史频率。补上结构化写入口之后，"什么 kind 算数"就必须有**一个**说了算的地方，
 * 否则校验口径与读端口径迟早漂移（写端放进来一种、读端查不到，又回到今天这个病）。
 *
 * 【为什么是"派生"而不是"抄一份"】
 * 本项目对 kind 的真源是**既有的两张注册表**，不是谁在本文件里敲出来的字面量：
 *   ① 冻结契约表 `p1b/sim/out/g2-contract-frozen-r4.json`（已入库、sha 锁）
 *      · `contracts` ＝逐 kind 的取数契约（`_` 开头的是内部辅助函数名，不是 kind）
 *      · `aliases`   ＝**与 contracts 互不覆盖**的一批别名 kind（实测 25 个）
 *   ② 揭晓分流表 `src/evidence/revealClass.js` 的 REVEAL_CLASS（kind 的取数能力登记）
 * 支持表＝①contracts ∪ ①aliases ∪ ②REVEAL_CLASS。
 *
 * ★**为什么必须带上 aliases**：实测（只读探针，见交付说明）真库在用的 52 种 kind 里，
 *   有 26 种**不在 contracts 里**（如 openmeteo_air_daily_mean 128 行、noaa_tide_daily_high 15 行），
 *   它们全在 aliases 里。只按 contracts 收 ⇒ 会把真库正在用的 715 行锚判成非法，
 *   那不是校验，是把已经跑通的题拦在门外。三表取并集后对真库 52 种**零漏**。
 *
 * 纪律：零新依赖（只用 node 内建 fs/path）；不碰 db、不发网络；
 *   表读不到时**不静默放行**——放行等于把今天的病原样留在库里（写入不可信锚的账本不可改），
 *   故一律显式抛错，由调用方转成 500 并说清缺哪个文件。
 */

const fs = require('fs');
const path = require('path');
const revealClass = require('./revealClass');

/** 冻结契约表路径（与 routes/disclosure.js 门面读的是同一个文件——两处必须同源，否则口径会漂）。 */
const CONTRACT_PATH = path.join(__dirname, '..', '..', 'sim', 'out', 'g2-contract-frozen-r4.json');

/** `_` 开头的是契约表内部的辅助函数名（如 _omDaily），不是可写入的 kind。 */
function realContractKinds(contracts) {
  return Object.keys(contracts || {}).filter((k) => k.charAt(0) !== '_');
}

/**
 * 支持表派生（**纯函数**：只吃已解析好的表，不读文件、不缓存）。
 * 三表取并集，理由见文件头「为什么必须带上 aliases」。
 * @param {object|null} contract 冻结契约表解析结果（可为 null ⇒ 该来源缺席）
 * @param {object|null} revealClassTable REVEAL_CLASS 解析结果
 * @returns {string[]} 去重后按字典序排好的 kind 列表
 */
function deriveSupportedKinds(contract, revealClassTable) {
  const out = new Set();
  const c = (contract && contract.contracts) || {};
  realContractKinds(c).forEach((k) => out.add(k));
  Object.keys((contract && contract.aliases) || {}).forEach((k) => out.add(k));
  Object.keys(revealClassTable || {}).forEach((k) => out.add(k));
  return Array.from(out).sort();
}

/**
 * 读并校验冻结契约表。读不到/坏掉就抛错，**绝不返回空表**。
 * @param {string} filePath
 * @returns {object} 契约表解析结果（已确认含 contracts 字段）
 */
function readContract(filePath) {
  let raw = null;
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch (e) {
    throw new Error('真值锚支持表不可读（缺件或不可读）：' + filePath
      + ' —— 已冻结入库的契约表读不到 ⇒ 无法判定 kind 合法性，'
      + '此时放行等于把写不出来的锚写进不可改的账本，故一律拒绝。原始错误：' + e.message);
  }
  let contract = null;
  try { contract = JSON.parse(raw); } catch (e) {
    throw new Error('真值锚支持表不可解析：' + filePath + ' —— ' + e.message);
  }
  if (!contract.contracts || typeof contract.contracts !== 'object') {
    throw new Error('真值锚支持表结构异常（缺 contracts 字段）：' + filePath);
  }
  return contract;
}

let cached = null;

/**
 * 取支持表（进程内缓存一次）。
 * @returns {string[]}
 */
function supportedKinds() {
  if (cached) return cached;
  cached = deriveSupportedKinds(readContract(CONTRACT_PATH), revealClass.REVEAL_CLASS);
  return cached;
}

/**
 * 从指定契约表派生支持表（**不走缓存**）。
 * 用途：校验"表读不到会怎样"这类行为时，不必去改动模块内部常量——
 * 早前版本只能在测试里 redefine 导出属性，而 supportedKinds 闭包引用的是模块内私有的常量，
 * 改导出根本改不动它 ⇒ 那种测法只能测出一个假的绿。
 * @param {string} filePath
 * @returns {string[]}
 */
function supportedKindsFrom(filePath) {
  return deriveSupportedKinds(readContract(filePath), revealClass.REVEAL_CLASS);
}

/** kind 是否在支持表内。不抛错——判断权交给调用方的校验器（本项目枚举校验统一走 util.js 的 requireEnum）。 */
function isSupportedKind(kind) {
  if (typeof kind !== 'string' || !kind) return false;
  return supportedKinds().indexOf(kind) !== -1;
}

module.exports = {
  CONTRACT_PATH, deriveSupportedKinds, readContract, supportedKinds, supportedKindsFrom,
  isSupportedKind,
};
