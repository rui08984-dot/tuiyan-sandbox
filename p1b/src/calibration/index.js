'use strict';
/**
 * p1b/src/calibration/index.js —— 校准挑战者库汇出入口（2026-09-16 · P0-U4）。
 *
 * 成员：isotonic（PAVA，第二挑战者，只描述）/ betaCalibration（主挑战者）/ platt（参照臂）。
 * 共用夹断：CLAMP = [1e-6, 1−1e-6]（log/logit 域安全边界）。
 * 纪律（【13】U4②）：本目录**全新**；p1b/src/engines/ 现役管线零 require 零接触（l3_aci.js 不动）。
 */
const isotonic = require('./isotonic');
const betaCalibration = require('./betaCalibration');
const platt = require('./platt');

const CLAMP = [1e-6, 1 - 1e-6];
function clampProb(p) { const x = Number(p); return Math.max(CLAMP[0], Math.min(CLAMP[1], isFinite(x) ? x : 0.5)); }

module.exports = { isotonic: isotonic, betaCalibration: betaCalibration, platt: platt, clampProb: clampProb, CLAMP: CLAMP };
