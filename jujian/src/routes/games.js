'use strict';
/**
 * p1b/src/routes/games.js —— 局管理路由（P1B-SPEC §3）：
 *   GET /api/games ｜ POST /api/games ｜ GET /api/games/:id ｜ GET /api/games/:id/state?uptoDay=N
 *   ｜ GET /api/games/:id/export
 * 数据全部来自 p1a store.js（契约 v1）；游戏列表 db 层无现成函数 → 服务端补一条只读 SQL（additive，零侵入）。
 */
const store = require('../db/store');
const botcClaims = require('../game/botcClaims'); // B2：botc 局剧本挂 p1b 私有表 botc_games
const { SCRIPTS } = require('../kernel/botc/roles');
const { httpError, requireInt, requireEnum, requireNonEmptyString, GAME_TYPES, toInt } = require('../http/util');
const { listAdapters } = require('../http/adapters'); // 通用化：可用类型 = 内置三型 ∪ adapters/ 目录登记 id
const { idempotent, ensureIdempotencyTables } = require('../http/idempotency'); // 2026-09-30 建局写口幂等（发行阻断项）

function publicGame(row, currentDay) {
  return {
    id: row.id,
    name: row.name,
    type: row.game_type,
    game_type: row.game_type,
    player_count: row.player_count,
    status: 'active',
    created_at: row.created_at,
    current_day: currentDay === undefined ? 0 : currentDay,
  };
}

function getGameOr404(gameId) {
  const game = store.getGame(gameId);
  if (!game) throw httpError(404, '局不存在: ' + gameId);
  return game;
}

function currentDayOf(gameId) {
  const row = store.getConnection().prepare('SELECT MAX(day) AS d FROM events WHERE game_id=?').get(gameId);
  return row && row.d ? row.d : 0;
}

/** 可用游戏类型 = 内置 GAME_TYPES ∪ adapters/ 目录登记 id（加新游戏只需落适配器文件，前后端零改）*/
let _allowedTypes = null;
function allowedGameTypes() {
  if (!_allowedTypes) {
    _allowedTypes = GAME_TYPES.slice();
    for (const a of listAdapters()) if (_allowedTypes.indexOf(a.id) === -1) _allowedTypes.push(a.id);
  }
  return _allowedTypes;
}

function register(app) {
  // 幂等键私有表（additive、幂等；与 events/oracle 路由同一时机建，省 server.js 的一次原子编辑）
  ensureIdempotencyTables(store.getConnection());
  app.get('/api/games', async () => {
    const conn = store.getConnection();
    const rows = conn.prepare(
      'SELECT g.*, (SELECT COUNT(*) FROM events e WHERE e.game_id = g.id) AS event_count,'
      + ' (SELECT MAX(day) FROM events e WHERE e.game_id = g.id) AS max_day,'
      + ' bg.script AS script' // B2：botc 局剧本（LEFT JOIN p1b 私有表，非 botc 局为 null）
      + ' FROM games g LEFT JOIN botc_games bg ON bg.game_id = g.id ORDER BY g.id DESC'
    ).all();
    return { games: rows.map((r) => Object.assign(publicGame(r, r.max_day || 0), { event_count: r.event_count, max_day: r.max_day || 0, script: r.script || null })) }; // P1b-4 列表需历史局标记：补 SQL 已算字段
  });

  // ★2026-09-30：建局写口加幂等包装（发行阻断项，见 routes/idempotency.js 文件头）。
  //   键由调用方给（HTTP 头 Idempotency-Key 或 body.idempotency_key）；没带键的调用方**照写**，
  //   只在响应里如实回报"这次没带键"并在 idempotency_keys 留一行 keyed=0 证据。
  //   带同一个键重发 ⇒ 建局一次、返回同一个局 id（超时重试不再多出一局）。
  app.post('/api/games', idempotent('POST /api/games', async (req, reply) => {
    const body = req.body || {};
    const name = requireNonEmptyString('name', body.name === undefined ? '' : String(body.name));
    const gt = body.type !== undefined ? body.type : body.game_type;
    requireEnum('game_type', gt, allowedGameTypes());
    const pc = requireInt('player_count', body.player_count, 1);
    if (pc > 99) throw httpError(400, 'player_count 上限 99');
    // B2：botc 局支持挂剧本（tb|bmr|snv，给了就强校验枚举），落 p1b 私有表 botc_games
    //（games 表既有结构零改动）。script 可选（兼容既有无剧本 botc 局的建局路径，
    // 基线 49 用例 gameB 即此形态）；无剧本的 botc 局录角色/阵营/状态声称时 400（见 events/confirm）。非 botc 局忽略 script 字段（werewolf 路径零改动）。
    let script = null;
    if (gt === botcClaims.BOTC_GAME_TYPE && body.script !== undefined && body.script !== null && body.script !== '') {
      script = requireEnum('script', String(body.script), SCRIPTS);
    }
    const game = store.createGame({ name: name, game_type: gt, player_count: pc }); // 事务内自动建席 1..N（名=座位号+「号」）
    if (script) botcClaims.setGameScript(game.id, script);
    const players = store.getPlayers(game.id);
    reply.code(201);
    return { game: Object.assign(publicGame(game, 0), { script }), players };
  }));

  app.get('/api/games/:id', async (req) => {
    const id = requireInt('game id', req.params.id, 1);
    const game = getGameOr404(id);
    return { game: Object.assign(publicGame(game, currentDayOf(id)), { script: botcClaims.getGameScript(id) }), players: store.getPlayers(id) };
  });

  app.get('/api/games/:id/state', async (req) => {
    const id = requireInt('game id', req.params.id, 1);
    getGameOr404(id);
    let uptoDay;
    if (req.query.uptoDay !== undefined && req.query.uptoDay !== '') {
      const n = toInt(req.query.uptoDay);
      if (n === null || n < 1) throw httpError(400, 'uptoDay 必须是 ≥1 的整数');
      uptoDay = n;
    }
    const state = store.loadGameState(id, uptoDay);
    if (!state) throw httpError(404, '局不存在: ' + id);
    // game 行补前端 Game 形状字段（type/status/current_day），事件/声称/行动行保持 db 原样（契约 v1）
    state.game = Object.assign({}, state.game, {
      type: state.game.game_type,
      status: 'active',
      current_day: currentDayOf(id),
    });
    return state;
  });

  app.get('/api/games/:id/export', async (req) => {
    const id = requireInt('game id', req.params.id, 1);
    getGameOr404(id);
    const data = store.exportGame(id);
    if (!data) throw httpError(404, '局不存在: ' + id);
    return data;
  });

  // ── P1b-4 增补：座位名单改名通道（仅 UPDATE players.name，零 DDL；db 层无现成函数 → additive SQL 走 store.getConnection()，与局列表 SQL 同模式）──
  app.put('/api/games/:id/seats', async (req) => {
    const id = requireInt('game id', req.params.id, 1);
    getGameOr404(id);
    const body = req.body || {};
    if (!Array.isArray(body.seats) || body.seats.length === 0) throw httpError(400, 'seats 必须是非空数组');
    const updates = body.seats.map((s, i) => {
      if (!s || typeof s !== 'object') throw httpError(400, 'seats[' + i + '] 必须是对象');
      const seat = requireInt('seats[' + i + '].seat', s.seat, 1);
      const name = requireNonEmptyString('seats[' + i + '].name', s.name === undefined ? '' : String(s.name));
      if (!store.seatExists(id, seat)) throw httpError(400, 'seats[' + i + '].seat=' + seat + ' 不在局 ' + id + ' 的座位名单中');
      return { seat, name };
    });
    const conn = store.getConnection();
    store.tx(conn, () => {
      const upd = conn.prepare('UPDATE players SET name=? WHERE game_id=? AND seat=?');
      for (const u of updates) upd.run(u.name, id, u.seat);
    });
    return { ok: true, players: store.getPlayers(id) };
  });
}

module.exports = { register, publicGame, getGameOr404, currentDayOf };
