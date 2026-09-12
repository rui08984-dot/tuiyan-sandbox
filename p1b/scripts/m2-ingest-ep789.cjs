'use strict';
/* m2-ingest-ep789.cjs — M2 第7/8/9局（PandaKill S1E6 三局）公开层入库
 * 只入 slots.json 的 streams.public；streams.truth（夜刀/验/毒/守）禁入公开 events。
 * 用法：node m2-ingest-ep789.cjs --dry-run   # 内存库全流程演练（零真写）
 *       node m2-ingest-ep789.cjs             # 真写 p1a-terminal/data/p1a.db
 * 纪律：只 require p1a-terminal/src/db.js，绝不改 p1a-terminal/**；不动 31 局 sim 与既有真人局；零 8787 接触。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..');
const DB_JS = path.join(REPO, 'p1a-terminal', 'src', 'db.js');
const POOL = path.join(REPO, 'docs', 'sandbox', 'p0-replay');
const DRY = process.argv.includes('--dry-run');
const dbo = require(DB_JS);

const JOBS = [
  { file: 'replay-werewolf-pandakill-s1e6.slots.json',   name: 'PandaKill S1E6 第1局·公开层', players: 12 },
  { file: 'replay-werewolf-pandakill-s1e6p2.slots.json', name: 'PandaKill S1E6 第2局·公开层', players: 12 },
  { file: 'replay-werewolf-pandakill-s1e6p3.slots.json', name: 'PandaKill S1E6 第3局·公开层', players: 12 },
];

// 真相层动作：一旦出现在 public 即判泄漏（硬中止）
const TRUTH_ACTIONS = new Set(['night_kill', 'witch_poison', 'witch_save', 'seer_check', 'guard_protect']);

// 公开动作 -> 事件类型 / 死后是否允许（遗言·开枪）/ 可落 actions 表的动作枚举
const MAP = {
  speak:        { type: 'statement',     deadOk: false },
  claim:        { type: 'claim',         deadOk: false },
  vote:         { type: 'vote',          deadOk: false, kind: 'vote',        needsTarget: true },
  abstain:      { type: 'vote',          deadOk: false, kind: 'abstain' },
  death:        { type: 'death',         deadOk: true  },
  system:       { type: 'system',        deadOk: true  },
  shoot:        { type: 'action_reveal', deadOk: true,  kind: 'kill_target', result: 'shoot', needsTarget: true },
  self_explode: { type: 'action_reveal', deadOk: false, kind: 'self_explode', result: 'wolf_king_explode' },
  surrender:    { type: 'action_reveal', deadOk: false },
};
const PHASE = { night: 'night', day: 'day', vote: 'dusk' };   // slots 的 vote 相位 -> db 枚举 dusk
const PH_ORDER = { night: 0, day: 1, vote: 2 };
const seatOf = (s) => (typeof s === 'string' && /^[0-9]+号$/.test(s)) ? parseInt(s, 10) : null;
const short = (h) => h.slice(7, 7 + 16);

function loadJob(job) {
  const p = path.join(POOL, job.file);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const pub = j.streams && j.streams.public;
  const tru = j.streams && j.streams.truth;
  if (!Array.isArray(pub) || !Array.isArray(tru)) throw new Error(job.file + ': streams 结构缺失');
  const bad = pub.filter((r) => TRUTH_ACTIONS.has(r.action));
  if (bad.length) throw new Error(job.file + ': 公开层出现真相层动作 ' + JSON.stringify(bad.slice(0, 3)));
  // 公开层不得含夜间数据（唯一例外：法官 system = 天黑/天亮宣告）
  const nightPublic = pub.filter((r) => r.time.phase === 'night' && !(r.action === 'system' && r.actor === 'judge'));
  if (nightPublic.length) throw new Error(job.file + ': public 出现夜间非公开记录 ' + JSON.stringify(nightPublic.slice(0, 3)));
  // 真相层夜间动作（夜刀/验/毒/守）不得与公开层同座同夜同相出现
  const nightClash = tru.filter((r) => TRUTH_ACTIONS.has(r.action)
    && pub.some((p) => p.time.phase === r.time.phase && p.time.day === r.time.day && p.actor === r.actor));
  if (nightClash.length) throw new Error(job.file + ': 真相层夜间动作与公开层重叠 ' + nightClash.length);
  const hash = 'sha256:' + crypto.createHash('sha256').update(Buffer.from(JSON.stringify(pub), 'utf8')).digest('hex');
  return { j, pub, tru, hash };
}

// 公开动作 -> 忠实中文表述（仅转述 record 槽位，不补剧情）
function rawTextFor(r) {
  const a = r.actor;
  const t = r.target;
  switch (r.action) {
    case 'speak':        return a + ' 公开发言';
    case 'claim':        return a + ' 公开发言（阵营/身份声称）' + (t ? '；关联 ' + t : '');
    case 'vote':         return a + ' 投票 → ' + t;
    case 'abstain':      return a + ' 弃票';
    case 'death':        return a + ' 出局（死亡宣告）';
    case 'system':       return '法官宣布' + (t ? '（' + t + '）' : '');
    case 'shoot':        return a + ' 开枪 → ' + t;
    case 'self_explode': return a + ' 白狼王自爆' + (t ? '，带走 ' + t : '');
    case 'surrender':    return a + ' 交牌认输';
    default:             return a + ' ' + r.action + (t ? ' → ' + t : '');
  }
}

function buildRecords(job, pub) {
  const rows = pub.map((r, i) => {
    const m = MAP[r.action];
    if (!m) throw new Error(job.file + ': 未知公开动作 ' + r.action);
    const actorSeat = seatOf(r.actor);            // judge/其他非座位 -> null
    if (r.actor !== 'judge' && actorSeat === null) throw new Error(job.file + ': 非身份 actor ' + r.actor);
    const targetSeat = seatOf(r.target);          // 非座位 target -> null
    if (m.needsTarget && targetSeat === null) throw new Error(job.file + ': 缺 target ' + JSON.stringify(r));
    return { r, i, m, actorSeat, targetSeat, phase: PHASE[r.time.phase], type: m.type };
  });
  rows.sort((x, y) => (x.r.time.day - y.r.time.day)
    || (PH_ORDER[x.r.time.phase] - PH_ORDER[y.r.time.phase])
    || (x.r.time.seq - y.r.time.seq) || (x.i - y.i));
  return rows;
}

function findExisting(db, name) {
  return db.prepare('SELECT * FROM games WHERE name=? AND game_type=?').get(name, 'werewolf');
}
function purgeGame(db, gid) {
  const evIds = db.prepare('SELECT id FROM events WHERE game_id=?').all(gid).map((x) => x.id);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM contradictions WHERE game_id=?').run(gid);
    db.prepare('DELETE FROM hypotheses WHERE game_id=?').run(gid);
    for (const eid of evIds) {
      db.prepare('DELETE FROM claims WHERE event_id=?').run(eid);
      db.prepare('DELETE FROM actions WHERE event_id=?').run(eid);
    }
    db.prepare('DELETE FROM events WHERE game_id=?').run(gid);
    db.prepare('DELETE FROM players WHERE game_id=?').run(gid);
    db.prepare('DELETE FROM games WHERE id=?').run(gid);
  });
  tx();
}

/** 入库一局；返回 {game_id, events, claims, actions, purge, hash, pub_n} */
function ingestOne(job, dry) {
  const { pub, tru, hash } = loadJob(job);
  const rows = buildRecords(job, pub);
  const conn = dbo.getConnection();
  let purged = null;
  if (!dry) {
    const ex = findExisting(conn, job.name);
    if (ex) { purgeGame(conn, ex.id); purged = ex.id; }
  }
  const game = dbo.createGame(job.name, 'werewolf', job.players);
  const gid = game.id;
  let nClaims = 0, nActions = 0;
  for (const row of rows) {
    const r = row.r;
    const ev = dbo.addEvent({
      game_id: gid, day: r.time.day, phase: row.phase, type: row.type,
      actor_seat: row.actorSeat, raw_text: rawTextFor(r),
    });
    if (r.action === 'claim') {
      dbo.addClaim({
        event_id: ev.id, seat: row.actorSeat,
        subject_seat: row.targetSeat === null ? row.actorSeat : row.targetSeat,
        predicate: 'claims_role', object: rawTextFor(r),
        extracted_by: 'm2-slots', confirmed_by_user: 1,
      });
      nClaims++;
    } else if (r.action === 'vote') {
      dbo.addClaim({
        event_id: ev.id, seat: row.actorSeat, subject_seat: row.targetSeat,
        predicate: 'voted', object: 'vote:' + row.targetSeat,
        extracted_by: 'm2-slots', confirmed_by_user: 1,
      });
      nClaims++;
    } else if (r.action === 'self_explode') {
      dbo.addClaim({
        event_id: ev.id, seat: row.actorSeat, subject_seat: row.actorSeat,
        predicate: 'is_wolf', object: 'self_explode',
        extracted_by: 'm2-slots', confirmed_by_user: 1,
      });
      nClaims++;
    }
    if (row.m.kind) {
      dbo.addAction({
        event_id: ev.id, seat: row.actorSeat, action: row.m.kind,
        target_seat: row.m.needsTarget ? row.targetSeat : null,
        result: row.m.result || null,
      });
      nActions++;
    }
  }
  return { game_id: gid, events: rows.length, claims: nClaims, actions: nActions, purge: purged, hash, pub_n: pub.length, tru_n: tru.length };
}

function wwCount(s) { const x = s.byType.find((y) => y.game_type === 'werewolf'); return x ? x.c : 0; }
function nReal(s) { return s.byType.filter((x) => x.game_type === 'werewolf' || x.game_type === 'botc').reduce((a, b) => a + b.c, 0); }
function snapshot(conn) {
  const games = conn.prepare('SELECT COUNT(*) c FROM games').get().c;
  const byType = conn.prepare('SELECT game_type, COUNT(*) c FROM games GROUP BY game_type ORDER BY c DESC').all();
  const ev = conn.prepare('SELECT COUNT(*) c FROM events').get().c;
  const cl = conn.prepare('SELECT COUNT(*) c FROM claims').get().c;
  const ac = conn.prepare('SELECT COUNT(*) c FROM actions').get().c;
  return { games, byType, events: ev, claims: cl, actions: ac };
}

// 公开层存证：对三局 events 计算内容指纹，并做真相词表泄漏扫描
function leakAudit(conn, gids) {
  const DENY = ['夜刀', '被刀', '验人', '查验', '毒杀', '下毒', '守卫', '守护', '保护', '狼刀', '首刀'];
  const found = [];
  let fp = crypto.createHash('sha256');
  for (const gid of gids) {
    const evs = conn.prepare('SELECT day,phase,seq,type,actor_seat,raw_text FROM events WHERE game_id=? ORDER BY day,seq').all(gid);
    for (const e of evs) {
      fp.update([gid, e.day, e.phase, e.seq, e.type, e.actor_seat, e.raw_text].join('|') + '\n');
      for (const d of DENY) if (e.raw_text.includes(d)) found.push({ gid, seq: e.seq, word: d, raw: e.raw_text });
    }
    const cls = conn.prepare('SELECT e.game_id,count(*) c FROM claims c JOIN events e ON e.id=c.event_id WHERE e.game_id=?').get(gid).c;
    const acs = conn.prepare('SELECT e.game_id,count(*) c FROM actions a JOIN events e ON a.event_id=e.id WHERE e.game_id=?').get(gid).c;
    found.push({ gid, claims: cls, actions: acs });
  }
  const nightEvents = [];
  for (const gid of gids) conn.prepare("SELECT day,phase,seq,type,actor_seat,raw_text FROM events WHERE game_id=? AND phase='night'").all(gid).forEach((e) => nightEvents.push(Object.assign({ gid }, e)));
  const truthTokens = ['night_kill', 'witch_save', 'witch_poison', 'seer_check', 'guard_protect'];
  let tokenLeak = 0;
  for (const gid of gids) tokenLeak += conn.prepare('SELECT raw_text FROM events WHERE game_id=?').all(gid).filter((e) => truthTokens.some((x) => e.raw_text.includes(x))).length;
  return {
    fingerprint: 'sha256:' + fp.digest('hex'),
    keyword_hits: found.filter((x) => x.word).length,
    night_events: nightEvents,
    night_non_system: nightEvents.filter((e) => e.type !== 'system').length,
    truth_token_leak: tokenLeak,
  };
}

(async () => {
  const outIdx = process.argv.indexOf('--out');
  const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : null;
  const dbPath = DRY ? ':memory:' : path.join(REPO, 'p1a-terminal', 'data', 'p1a.db');
  dbo.init(dbPath);
  const conn = dbo.getConnection();
  const before = snapshot(conn);
  const results = [];
  for (const job of JOBS) results.push(ingestOne(job, DRY));
  const after = snapshot(conn);
  const gids = results.map((r) => r.game_id);
  const audit = leakAudit(conn, gids);
  const payload = {
    mode: DRY ? 'dry-run(memory)' : 'write', db: dbPath,
    ingested_at: new Date().toISOString(),
    results, before, after, audit,
    werewolf_delta: wwCount(after) - wwCount(before), n_real_before: nReal(before), n_real_after: nReal(after),
  };
  dbo.closeCurrent();
  const pretty = JSON.stringify(payload, null, 1);
  if (OUT) fs.writeFileSync(OUT, pretty, 'utf8');
  console.log(pretty);
})().catch((e) => { console.error('INGEST-FAIL: ' + (e && e.stack ? e.stack : e)); process.exitCode = 1; });
