'use strict';
/**
 * p1b/src/evidence/klineClosed.js —— 「这根日 K 线确已收盘吗」单一真源（2026-09-28）
 *
 * 存在的理由：日 K 线的**收盘价**只有在它收盘之后才是真值。写账本的两条路径
 *   （`corpus-resolve.cjs` 的活路径、`corpus-resolve-daemon.cjs` 的 B3 兜底路径）
 *   历史上各写各的判据，且都用**本地日历**去卡 **UTC 日**语义的源 ⇒ 分叉过一次。
 *   本件是纯函数、零依赖、零 db、零网络；两个调用点都从这里取判据。
 *
 * ★**为什么判据取自数据自报的 `closeTime`，而不是比较日历**：
 *   预筛按日历猜只能把「8 小时错窗」挪到别处（上海 00:00–07:59 挪成 UTC 00:00–07:59），
 *   病根是「没在取 close 之前证明这根 K 线已收盘」。`closeTime` 是交易所自己给的收盘时刻，
 *   拿它和当前时刻比，**与任何时区无关**，也不受调用方时钟设置影响。
 *
 * ★**「时长 ≥ 24 小时」是错判据（本轮实测）**：Binance 日 K 的
 *   `closeTime = openTime + 24h − 1ms` ⇒ **已收盘**的 K 线时长是 86399999ms。
 *   拿它比 `≥ 86400000` 会把每一根已收盘 K 线都判成未收盘 ⇒ 整类题永久饿死。
 *
 * 兜底（不是猜）：`closeTime` 缺失/畸形时，退回「该 K 线的 UTC 日是否已早于当前 UTC 日」——
 *   日 K 在该 UTC 日 24:00 收口，所以「不是当前 UTC 日」**等价于**「已收盘」，这是可证的而非猜测。
 *   连开仓时间都读不出（连是哪一天都无从判断）⇒ 判**未收盘**，此时才是真猜不出来，宁缺毋滥：
 *   猜错的方向是「把没走完的 K 线当真值写进不可变账本」，那个错不可回滚。
 */

/** K 线字段序（Binance /api/v3/klines）：0=openTime 4=close 6=closeTime，单位毫秒。 */
const IDX_OPEN = 0, IDX_CLOSE = 6;

function num(v) { const n = Number(v); return isFinite(n) ? n : null; }

/** `closeTime`（ms）。字段缺失/非数 ⇒ null（调用方据此走兜底，不许当成 0 放行）。 */
function klineCloseMs(k) {
  if (!Array.isArray(k)) return null;
  const v = num(k[IDX_CLOSE]);
  return (v === null || v <= 0) ? null : v;
}

/** K 线跨度（ms）＝closeTime−openTime。**已收盘的日 K 是 86399999，不是 86400000**（见头注）。 */
function klineSpanMs(k) {
  if (!Array.isArray(k)) return null;
  const o = num(k[IDX_OPEN]), c = num(k[IDX_CLOSE]);
  return (o === null || c === null) ? null : (c - o);
}

/** 该 K 线所属的 UTC 日（'YYYY-MM-DD'）；开仓时间不可解析 ⇒ null。 */
function klineUtcDay(k) {
  if (!Array.isArray(k)) return null;
  const o = num(k[IDX_OPEN]);
  return o === null ? null : new Date(o).toISOString().slice(0, 10);
}

/**
 * 该 K 线是否**确已收盘**。`nowMs` 省略＝真实当前时刻（注入它＝可确定性测试）。
 * @returns {boolean}
 */
function klineClosed(k, nowMs) {
  const now = num(nowMs) === null ? Date.now() : num(nowMs);
  const c = klineCloseMs(k);
  if (c !== null) return c <= now;                     // 主判据：交易所自报的收盘时刻已过
  // 兜底（closeTime 缺失/畸形）：退回「该 K 线的 UTC 日是否已早于当前 UTC 日」——
  // 日 K 在该 UTC 日 24:00 收口，所以「不是当前 UTC 日」等价于「已收盘」。
  const day = klineUtcDay(k);
  if (day === null) return false;                      // 连开仓时间都读不出 ⇒ 不猜，判未收盘
  return day < new Date(now).toISOString().slice(0, 10);
}

module.exports = { klineCloseMs, klineSpanMs, klineUtcDay, klineClosed };
