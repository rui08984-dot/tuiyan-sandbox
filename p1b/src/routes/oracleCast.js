'use strict';
/**
 * p1b/src/routes/oracleCast.js —— 独立玄学排盘 API（p9 W1，与对局彩蛋判词路由解耦的增量模块）：
 *   POST /api/oracle/cast     → 三法起卦（method=numbers|time|random + params）+ 落档 + 返回 201
 *   GET  /api/oracle/readings → 分页历史档案（新→旧；回看抽屉数据源）
 *
 * 边界铁律（P8 拍板③，写死）：本路由只做排盘（纯数学）与历史留档，恒挂
 * DISCLAIMER「娱乐参考」；绝不接入任何游戏研判功能；本路由返回值禁止被
 * 参谋/研判类模块引用——「正经」指排盘工程完整度，不是研判能力
 * （梅花查狼实验 docs/sandbox/p2-yijing/oracle-experiment-result.md 已证判词无研判效力）。
 *
 * 形态拍板（2026-09-10）：独立玄学页 + 既有彩蛋弹层共存（纯增量）——本路由服务
 * 独立玄学页（W2 建 #/mystic），不改动 /api/games/:id/oracle 彩蛋链路。
 *
 * 口径备注：
 *   - numbers：梅花传统任意正整数皆可起卦；服务端防滥用上限 MAX_MANUAL_NUMBER=999999。
 *   - time：params.date 缺省=服务器当前时刻；ISO 无时区后缀按服务器本地时区解析
 *     （ES 规范 date-only 'YYYY-MM-DD' 落 UTC 零点 → 东八区当日 08:00，农历日不变）。
 *   - random：params 忽略（两数由 CSPRNG 派生，口径见 lib/oracleCast.js 头注释）。
 */
const { db } = require('../deps');
const { castByNumbers, castByTime, castByRandom, DISCLAIMER } = require('../lib/oracleCast');
const { ensureOracleReadingsTable, saveOracleReading, listOracleReadings } = require('../db/oracleStore');
const { getGameOr404 } = require('./games');
const { httpError, requireInt, requireEnum } = require('../util');

const METHODS = ['numbers', 'time', 'random'];
/** 数字起卦防滥用上限（梅花传统任意正整数皆可起卦；服务端只挡天文数字） */
const MAX_MANUAL_NUMBER = 999999;
const LIST_LIMIT_MAX = 100;

function register(app, ctx) {
  // p1b 私有表（additive、幂等）。挂在本 register（buildServer 内调用）与 botc 私有表同时机，
  // 换取 server.js 的单次原子编辑（require+register 同一条语句）。
  ensureOracleReadingsTable(db.getConnection());

  app.post('/api/oracle/cast', async (req, reply) => {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const method = requireEnum('method', body.method, METHODS);
    const params = (body.params && typeof body.params === 'object') ? body.params : {};

    let casting, inputs;
    if (method === 'numbers') {
      const n1 = requireInt('params.n1', params.n1, 1);
      const n2 = requireInt('params.n2', params.n2, 1);
      if (n1 > MAX_MANUAL_NUMBER || n2 > MAX_MANUAL_NUMBER) {
        throw httpError(400, 'params.n1/n2 不得超过 ' + MAX_MANUAL_NUMBER + '（防滥用上限）');
      }
      inputs = { n1: n1, n2: n2 };
      casting = castByNumbers(n1, n2);
    } else if (method === 'time') {
      let date = new Date();
      if (params.date !== undefined && params.date !== null && params.date !== '') {
        date = new Date(params.date);
        if (Number.isNaN(date.getTime())) {
          throw httpError(400, 'params.date 无法解析为日期: ' + JSON.stringify(params.date)
            + '（ISO 字符串；无时区后缀按服务器本地时区）');
        }
      }
      inputs = { date: params.date === undefined || params.date === null ? null : String(params.date) };
      casting = castByTime(date);
    } else {
      // random：params 忽略（起卦数由 CSPRNG 派生，口径见 lib/oracleCast.js 头注释）
      inputs = {};
      casting = castByRandom();
    }

    let gameId = null;
    if (body.game_id !== undefined && body.game_id !== null) {
      gameId = requireInt('game_id', body.game_id, 1);
      getGameOr404(gameId); // 必须是真实存在的局（404 兜底）；自由排盘不传则存 NULL
    }

    reply.code(201); // 201 Created：POST 新建排盘档案（REST 语义）
    const row = saveOracleReading({
      method: method,
      inputs: inputs,
      hexagram: casting,
      verdict: null, // 断语属推断层（LLM），排盘档案先留结构位（见 db/oracleStore.js 头注释）
      disclaimer: DISCLAIMER,
      gameId: gameId,
    });
    return {
      id: row.id,
      method: row.method,
      inputs: row.inputs,
      casting: row.casting,
      verdict: row.verdict,
      disclaimer: row.disclaimer,
      created_at: row.created_at,
      game_id: row.game_id,
    };
  });

  app.get('/api/oracle/readings', async (req) => {
    const q = req.query || {};
    const limit = q.limit === undefined ? 20 : Math.min(requireInt('limit', q.limit, 1), LIST_LIMIT_MAX);
    const offset = q.offset === undefined ? 0 : requireInt('offset', q.offset, 0);
    const gameId = q.game_id === undefined ? null : requireInt('game_id', q.game_id, 1);
    return listOracleReadings({ limit: limit, offset: offset, gameId: gameId });
  });
}

module.exports = { register, METHODS, MAX_MANUAL_NUMBER, LIST_LIMIT_MAX };
