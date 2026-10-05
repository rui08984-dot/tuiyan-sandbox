'use strict';
/**
 * p1b/gates/flakeGate.cjs —— 「这次偶发红**够不够格**进证据目录」的机械判据
 *
 * ── 为什么要把它抽成一个件 ──────────────────────────────────────────────────
 *   判据本身只有一行（`max(首跑用时, 复跑用时) >= 1s`），但它住在 `gates.cjs` 的
 *   `if (首跑红 && 复跑绿)` 分支里 —— 那条分支**在测试里跑不到**（要先让某道闸红、
 *   再让它复跑转绿），所以判据写在原地就等于**没有测试**：谁把它删了、把 1 改成 0、
 *   或者改成只看首跑，绿灯不会有任何反应。
 *   抽出来之后，`p1b/test/gate-flake-guard.test.cjs` 能**用真值**把四种边界全测一遍，
 *   而闸门脚本的行为逐位不变（它只多了一行 require ＋ 一次调用）。
 *
 * ── 判据本身（2026-09-30，起点是那份假现场）────────────────────────────────
 *   `.scratch/gate-flakes/` 混着真现场与打桩产物，而**最新那份是假的**：
 *   `flake-20260930T08-23-28-601Z-backend.log` 记「首跑 exit=1 / 0.00s，复跑 exit=0 / 0.00s」，
 *   而同目录另三份真现场是 78s／112s／123s。后端道**单段**就要 100s+
 *   （`node --test` 跑 119 个文件），0.00s 的现场在本机物理上不可能是真的：
 *   那是修闸门时在沙箱里把 `spawnSync` 打桩的验证产物，误进了证据目录。
 *   ⇒ 谁按「看最新一份」的惯性去读它，会得出「后端道今天又红了」的错误结论。
 *
 * ── 三条取法上的讲究 ────────────────────────────────────────────────────────
 *   ① **取两次里较慢的那次**，不是首跑：复跑才是「真跑一遍」的那次（首跑偶尔确实很快，
 *     例如 build 命中缓存）。只看首跑会让一次「0.2s 红、98s 绿」的真现场被误杀。
 *   ② **阈值 1 秒而不是 0**：0 会把「计时器分辨率不够」的真实现场也误杀。
 *     本仓最快的那道闸单段也 >10s，1 秒留了两三个数量级余量。
 *   ③ **拒收不是静默**：调用方必须打一行说明「为什么不落盘」，否则下一个人会以为
 *     记录丢了。本件只回判据，说明由 `gates.cjs` 打（它手里有闸名与两个用时）。
 *
 * 零依赖、零副作用：不 require 任何东西，不读文件。
 */

/** 现场记录的最低可信用时（秒）。见文件头②。 */
const MIN_SECS = 1;

/**
 * @param {number} firstSecs  首跑用时（秒）
 * @param {number} retrySecs  复跑用时（秒）
 * @returns {{record:boolean, slowest:number, min:number}}
 */
function decide(firstSecs, retrySecs) {
  const a = Number(firstSecs);
  const b = Number(retrySecs);
  // ★非数/负数一律按 0 参与比较（打桩产物正是这种形状），不要让 NaN 静默通过比较：
  //   `NaN < 1` 是 false ⇒ 不加这道防御的话，一个 NaN 会**放行**一份不可信的现场。
  const slowest = Math.max(Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0);
  return { record: slowest >= MIN_SECS, slowest, min: MIN_SECS };
}

module.exports = { MIN_SECS, decide };
