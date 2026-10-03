#!/usr/bin/env node
'use strict';
/**
 * 局鉴 · bin/jujian.cjs —— 命令行入口
 *
 *   jujian doctor                      体检
 *   jujian games                       列局
 *   jujian new "名字" --type=werewolf --players=12
 *   jujian 1 claim 3 预言家 --day=1    3 号跳预言家
 *   jujian 1 check 3 1 --day=1         3 号查杀 1 号
 *   jujian 1 good 7 5 --day=1          7 号给 5 号发金水
 *   jujian 1 say 3 "我是预言家" --day=1  录一句话（走 AI 抽取，MOCK 或 LIVE）
 *   jujian 1 advise --day=1            天结算，等结果并打印矛盾清单
 *   jujian 1 card --day=1              回读已存档的参谋卡
 *   jujian 1 show                      整局状态
 *   jujian 1 export > game.json        导出
 *   jujian 1 rm-claim 12               撤回一条声称
 *   jujian games-types                 看支持哪些游戏
 *
 * ── 为什么要有它 ──────────────────────────────────────────────────────────
 *   局鉴的主要内容是「文本 → 结构化」，没有它是最好用的形态：
 *   饭桌上你只想敲一行 `jujian 3 check 1`，不想开浏览器。
 *   而对脚本和 agent 来说，它是比 HTTP 更省事的入口。
 *
 *   三条纪律：
 *   ① 直接调存储层，**不起子进程**（快的部分就别绕远路）。
 *   ② 默认只读。写命令（new/claim/check/good/say/advise/rm-claim）都明确列在帮助里，
 *      不搞「默认写」这种事。
 *   ③ 输出默认给人读；加 --json 给机器读。同一份数据，两种形状。
 */

const path = require('node:path');
const fs = require('node:fs');

const store = require('../src/db/store');
const { buildMacroCard } = require('../src/llm/macros');
const { createTaskQueue } = require('../src/taskQueue');
const { makeAdviseRunner } = require('../src/routes/advise');
const { splitBotcClaims, BOTC_GAME_TYPE } = require('../src/game/botcClaims');
const { listAdapters } = require('../src/http/adapters');

const args = process.argv.slice(2);
const flags = {};
const rest = [];
for (const a of args) {
  if (a.startsWith('--')) {
    const m = a.slice(2).split('=');
    flags[m[0]] = m.length > 1 ? m[1] : true;
  } else rest.push(a);
}
const asJson = !!flags.json;

/**
 * ★node:sqlite 的行是 **null 原型**对象（Object.create(null)）。
 *   对它们调 String()/模板字符串会抛 "Cannot convert object to primitive value" ——
 *   因为没有 toString 也没有 valueOf。
 *   CLI 几乎所有输出都经过渲染，所以这里统一先转成普通对象。
 *   （第一版没转，`jujian 1 export` 直接崩：Cannot convert object to primitive value。）
 */
function plain(v) {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = plain(v[k]);
    return o;
  }
  return v;
}

function out(obj) {
  const p = plain(obj);
  if (asJson) { process.stdout.write(JSON.stringify(p, null, 2) + '\n'); return; }
  if (Array.isArray(p)) { for (const r of p) process.stdout.write('  ' + render(r) + '\n'); return; }
  process.stdout.write(render(p) + '\n');
}
function render(o) {
  if (o === null || o === undefined) return '';
  if (typeof o !== 'object') return String(o);
  return Object.entries(o).map(([k, v]) => k + '=' + (Array.isArray(v) ? '[' + v.length + ']' : short(v))).join(' ');
}
/** 嵌套对象给个长度摘要而不是 [object Object]。 */
function short(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return Array.isArray(v) ? '[' + v.length + ']' : '{' + Object.keys(v).length + ' 字段}';
  const s = String(v);
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}
function die(msg, code = 1) {
  process.stderr.write('局鉴: ' + msg + '\n');
  process.exit(code);
}
function needInt(v, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) die(label + ' 必须是 ≥1 的整数，收到 ' + JSON.stringify(v));
  return n;
}

const HELP = `局鉴 · 社交推理游戏复盘台

  体检与信息
    doctor                 查五类安装事故（Node 版本/角色数据/依赖/端口…）
    games-types            支持哪些游戏

  局
    games                  列出全部局
    new <名字>             建局（--type=werewolf|botc|avalon --players=N --script=tb|bmr|snv）
    <局号> show            整局状态
    <局号> export          导出 JSON

  录入（跳身份 / 查杀 / 金水 都是宏，不走 AI）
    <局号> claim <席位> <角色>   跳身份     --day=N
    <局号> check <席位> <对象>   查杀       --day=N
    <局号> good  <席位> <对象>   发金水     --day=N
    <局号> say <席位> "<原话>"   自由文本抽取（走 AI）--day=N

  复盘
    <局号> advise --day=N   天结算，出矛盾清单
    <局号> card --day=N     回读已存档的参谋卡
    <局号> claims           列出全部声称

  改与撤
    <局号> rm-claim <声称号>

  通用
    --json                  输出 JSON（默认给人读）
    --db=<路径>             指定库（默认 data/jujian.db）
`;

async function main() {
  const cmd = rest[0];
  if (!cmd || cmd === 'help' || flags.help) { process.stdout.write(HELP); return 0; }
  if (cmd === 'doctor') {
    const { spawnSync } = require('node:child_process');
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'doctor.cjs')],
      { stdio: 'inherit' });
    return r.status === 0 ? 0 : 1;
  }

  store.init(flags.db !== undefined ? String(flags.db) : store.DEFAULT_DB_PATH);
  const day = flags.day !== undefined ? needInt(flags.day, '--day') : 1;

  if (cmd === 'games-types') { out(listAdapters().map((a) => ({ id: a.id, name: a.name, ready: a.ready, contract: a.contract }))); return 0; }

  if (cmd === 'games') {
    const rows = store.listGames();
    if (asJson) { out(rows); return 0; }
    if (!rows.length) { process.stdout.write('还没有局。用 `jujian new "名字" --players=12` 建一个。\n'); return 0; }
    process.stdout.write('局号  名字                类型       人数  天数  事件  声称  矛盾  假设\n');
    for (const g of rows) {
      const s = store.stats(g.id);
      process.stdout.write(String(g.id).padEnd(5)
        + String(g.name).padEnd(19)
        + String(g.game_type).padEnd(11)
        + String(g.player_count).padStart(3) + '  '
        + String(g.max_day || 0).padStart(3) + '  '
        + String(s.events).padStart(4) + '  '
        + String(s.claims).padStart(4) + '  '
        + String(s.contradictions).padStart(4) + '  '
        + String(s.hypotheses).padStart(4) + '\n');
    }
    return 0;
  }

  if (cmd === 'new') {
    const name = rest[1];
    if (!name) die('要给局起个名字：jujian new "周五饭桌局" --players=12');
    const type = flags.type ? String(flags.type) : 'werewolf';
    const pc = needInt(flags.players === undefined ? 12 : flags.players, '--players');
    const types = listAdapters().map((a) => a.id);
    if (!types.includes(type)) die('不认识的游戏类型 ' + type + '。可用：' + types.join(' | ') + '（jujian games-types）');
    const g = store.createGame({ name: name, game_type: type, player_count: pc });
    if (type === BOTC_GAME_TYPE && flags.script) store.setGameScript(g.id, String(flags.script));
    out({ 局号: g.id, 名字: g.name, 类型: g.game_type, 人数: g.player_count, 剧本: store.getGameScript(g.id) });
    return 0;
  }

  // 到这里必须带局号
  if (!/^\d+$/.test(cmd)) die('不认识的命令 ' + cmd + '。跑 `jujian help` 看用法。');
  const gid = needInt(cmd, '局号');
  const game = store.getGame(gid);
  if (!game) die('局 ' + gid + ' 不存在。用 `jujian games` 看看有哪些。');
  const sub = rest[1];

  if (sub === 'show') { out(store.loadGameState(gid)); return 0; }
  // export 的用途就是 `jujian 1 export > game.json`，所以**默认就是 JSON**，
  // 不必记得加 --json。（人读形态给 show，那条命令已经足够。）
  if (sub === 'export') {
    process.stdout.write(JSON.stringify(plain(store.exportGame(gid)), null, 2) + '\n');
    return 0;
  }
  if (sub === 'claims') { out(store.getClaims(gid)); return 0; }

  if (sub === 'claim' || sub === 'check' || sub === 'good') {
    const seat = needInt(rest[2], '席位');
    const arg = rest[3];
    if (arg === undefined) die(sub + ' 还要一个参数：' + (sub === 'claim' ? '角色名' : '对象席位'));
    const body = sub === 'claim'
      ? { kind: 'claim_role', seat, role: arg, day }
      : { kind: sub, seat, target_seat: needInt(arg, '对象席位'), day };
    const card = buildMacroCard(body);
    if (!store.seatExists(gid, card.event.actor_seat)) die('席位 ' + seat + ' 不在局 ' + gid + ' 的名单里（建局时定的 --players 是上限）');
    const rec = store.recordEvent(
      { game_id: gid, day: card.event.day, phase: card.event.phase, type: card.event.type,
        actor_seat: card.event.actor_seat, raw_text: card.event.raw_text },
      { claims: card.claims.map((c) => Object.assign({}, c, { extracted_by: 'macro', confirmed_by_user: 1 })) },
    );
    out({ 事件号: rec.event.id, 文字: card.event.raw_text, 落账声称: rec.claim_ids });
    return 0;
  }

  if (sub === 'say') {
    const seat = needInt(rest[2], '席位');
    const text = rest.slice(3).join(' ');
    if (!text) die('要给原话：jujian 1 say 3 "我是预言家，昨晚验的4号"');
    const llm = require('../src/llm/engine');
    const mock = process.env.JUJIAN_LLM_MOCK === '1';
    if (!mock && !(process.env.JUJIAN_LLM_API_KEY || process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY)) {
      process.stderr.write('提示：没找到 JUJIAN_LLM_API_KEY，本次走 MOCK 模式（零网络，措辞固定）。\n');
    }
    const state = store.loadGameState(gid, day);
    const r = await llm.extractEvent(text, {
      day, seats: state.players.map((p) => p.seat), events: state.events,
      claims: state.claims, actions: state.actions, actor_seat: seat,
    }, { mockMode: mock && !process.env.JUJIAN_LLM_API_KEY });
    out({ 模式: r.meta && r.meta.mode, 事件: r.event, 声称: r.claims, 说明: '★这是待确认卡，没落库。确认请用 confirm 接口。' });
    return 0;
  }

  if (sub === 'rm-claim') {
    const cid = needInt(rest[2], '声称号');
    const okv = store.retractClaim(cid);
    if (!okv) die('声称 ' + cid + ' 不存在');
    out({ 已撤回: cid, 提示: '★行仍在库里（账本不可变），只是从视图中消失' });
    return 0;
  }

  if (sub === 'advise') {
    const pre = store.loadGameState(gid, day);
    if (!pre.events.length) die('局 ' + gid + ' 第 ' + day + ' 天前没有任何事件，先录几句再说。');
    const queue = createTaskQueue({ runner: makeAdviseRunner({ store, llmMock: process.env.JUJIAN_LLM_MOCK === '1' }) });
    const task = queue.enqueue(gid, day);
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const t = queue.get(task.task_id);
      if (t.status !== 'running') {
        if (t.status === 'failed') die('天结算失败：' + (t.error || '未知原因'));
        const card = t.card || {};
        if (asJson) { out(card); return 0; }
        process.stdout.write('\n第 ' + day + ' 天 · 天结算\n');
        process.stdout.write('矛盾 ' + (card.contradictions || []).length + ' 条 ｜ 假设 '
          + (card.hypotheses || []).length + ' 条 ｜ 明日清单 ' + (card.checklist || []).length + ' 项\n');
        for (const c of (card.contradictions || [])) {
          process.stdout.write('\n  · ' + c.conflict_desc + '\n');
          process.stdout.write('    欠定度 ' + c.underdetermination + ' ｜ 无辜解释：\n');
          for (const ie of (c.innocent_explanations || [])) process.stdout.write('      - ' + ie + '\n');
        }
        const cl = card.checklist || [];
        if (cl.length) {
          process.stdout.write('\n  明天该盯：\n');
          for (const c of cl) process.stdout.write('    ' + c.n + '. ' + c.text + '\n');
        }
        return 0;
      }
    }
    die('天结算超时');
  }

  if (sub === 'card') {
    const cards = store.getHypotheses(gid).filter((h) => h.day === day);
    if (!cards.length) die('局 ' + gid + ' 第 ' + day + ' 天没有存档的参谋卡（先跑 advise）');
    out({ 假设: cards, 矛盾: store.getContradictions(gid) });
    return 0;
  }

  die('局 ' + gid + ' 下不认识的子命令 ' + JSON.stringify(sub) + '。跑 `jujian help` 看用法。');
  return 1;
}

main().then((c) => { store.closeCurrent(); process.exit(c || 0); })
  .catch((e) => {
    const msg = (e && e.message ? e.message : String(e)).replace(/^\[jujian-db\]\s*/, '');
    die(msg);
  });