'use strict';
// 语料库题目机械 resolve（corpus 棒 2026-09-12）：零 LLM，按 evidence_json[0].resolve 参数
// 拉公开源真值后回填 outcome/resolve_note。真值未到的题（预报日未入 archive/月值未发布/期未开奖）
// 保持 unresolved 跳过；网络失败跳过不写。账本不可变：已 resolve 拒改（resolvePrediction 守卫）。
// 用法：node scripts/corpus-resolve.cjs [--confirm]
const { db } = require('../src/deps');
const { resolvePrediction } = require('../src/db/predictionsStore');
const CONFIRM = process.argv.includes('--confirm');
const FETCH_MS = 30000;
async function getJson(url, headers) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_MS);
  try { const res = await fetch(url, { signal: ac.signal, headers: headers || {} }); if (!res.ok) throw new Error('HTTP ' + res.status); return await res.json(); } finally { clearTimeout(t); }
}

// ── 真值锚取数（每 kind 一个纯函数：入参 resolve 对象，出参 {pending?|outcome,note}）──
const RESOLVERS = {
  async openmeteo_daily_max(r) {
    const u = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + r.lat + '&longitude=' + r.lon + '&start_date=' + r.date + '&end_date=' + r.date + '&daily=temperature_2m_max&timezone=Asia%2FShanghai';
    let j;
    try { j = await getJson(u); } catch (e) { if (String(e.message).indexOf('HTTP 400') !== -1) return { pending: 'archive 尚无 ' + r.date + '（ERA5 未入库）' }; throw e; }
    const v = j.daily && j.daily.temperature_2m_max ? j.daily.temperature_2m_max[0] : null;
    if (v === null || v === undefined) return { pending: 'archive 尚无 ' + r.date + ' 日值' };
    return { outcome: v > r.threshold_c ? 'true' : 'false', note: 'Open-Meteo archive ' + r.date + ' max=' + v + 'C（阈值 ' + r.threshold_c + 'C，机检）' };
  },
  async dbnomics_series_value(r) {
    const u = 'https://api.db.nomics.world/v22/series/' + r.provider + '/' + r.dataset + '/' + r.series + '?observations=1';
    const j = await getJson(u);
    const doc = j.series && j.series.docs && j.series.docs[0];
    if (!doc) return { pending: '序列不存在' };
    const i = doc.period.indexOf(r.period);
    const v = i >= 0 ? doc.value[i] : null;
    if (v === null || v === undefined) return { pending: r.period + ' 观测值未发布' };
    return { outcome: v < r.threshold ? 'true' : 'false', note: 'DBnomics ' + r.series + ' ' + r.period + '=' + v + '（阈值 ' + r.threshold + '，机检）' };
  },
  async cwl_ssq_red_contains(r) { return cwlEval(r, (d) => d.red.split(',').indexOf(r.ball) !== -1, 'red 含 ' + r.ball); },
  async cwl_ssq_blue_odd(r) { return cwlEval(r, (d) => d.blue % 2 === 1, 'blue 为奇数'); },
  // ── forward 批专用 kind（2026-09-12 队长补：前瞻题的事件日多为未来，需 forecast/archive 双通道）──
  async openmeteo_forecast_daily_max(r) {
    const today = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).slice(0, 10);
    const isArchive = r.date <= today;
    const base = isArchive ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
    const u = base + '?latitude=' + r.lat + '&longitude=' + r.lon + '&daily=temperature_2m_max&timezone=Asia%2FShanghai&start_date=' + r.date + '&end_date=' + r.date;
    let j;
    try { j = await getJson(u); } catch (e) { if (String(e.message).indexOf('HTTP 400') !== -1) return { pending: 'archive 尚无 ' + r.date + '（ERA5 未入库）' }; throw e; }
    const v = j.daily && j.daily.temperature_2m_max ? j.daily.temperature_2m_max[0] : null;
    if (v === null || v === undefined) return { pending: '尚无 ' + r.date + ' 日值' };
    const ok = r.cmp === '<' ? v < r.threshold_c : v > r.threshold_c;
    return { outcome: ok ? 'true' : 'false', note: (isArchive ? 'Open-Meteo archive' : 'Open-Meteo forecast') + ' ' + r.date + ' max=' + v + 'C（阈值 ' + r.cmp + r.threshold_c + '，机检）' };
  },
  async cwl_ssq_blue_odd_forward(r) { return this.cwl_ssq_blue_odd(r); },
  // ── corpus-forward-b2 批新增 kind（2026-09-13 施工棒）：体彩大乐透前瞻题真值锚 ──
  // 口径：前区 5 号（01-35）+ 后区 2 号（01-12），球号为补零两位串；只读官方 lotteryDrawResult。
  // 设计约定（由 corpus-forward-b2.cjs 写入 evidence[0].resolve）：
  //   back_ball=两位串 → 后区是否含该号；front_max_ge=N → 前区最大号是否 >= N（同题只带一个字段）。
  async dlt_draw_result(r) {
    const u = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=85&provinceId=0&pageSize=60&isVerify=1&pageNo=1';
    const j = await getJson(u);
    const list = (j.value && j.value.list) || [];
    const hit = list.find((d) => String(d.lotteryDrawNum) === String(r.issue));
    if (!hit) return { pending: '第 ' + r.issue + ' 期未开奖' };
    const nums = String(hit.lotteryDrawResult).trim().split(/\s+/);
    const front = nums.slice(0, 5).map((x) => String(x));
    const back = nums.slice(5, 7).map((x) => String(x));
    if (r.back_ball !== undefined && r.back_ball !== null) {
      const ok = back.indexOf(String(r.back_ball)) !== -1;
      return { outcome: ok ? 'true' : 'false', note: '体彩官方 dlt ' + r.issue + ' 期 lotteryDrawResult=' + hit.lotteryDrawResult + '（后区含 ' + r.back_ball + '，机检）' };
    }
    if (r.front_max_ge !== undefined && r.front_max_ge !== null) {
      const mx = Math.max.apply(null, front.map(Number));
      const ok = mx >= Number(r.front_max_ge);
      return { outcome: ok ? 'true' : 'false', note: '体彩官方 dlt ' + r.issue + ' 期 lotteryDrawResult=' + hit.lotteryDrawResult + '（前区最大号 ' + mx + ' >= ' + r.front_max_ge + '，机检）' };
    }
    return { pending: 'resolve 参数未带 back_ball/front_max_ge（' + r.issue + '）' };
  },
};

async function cwlEval(r, predicate, what) {
  const u = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=30';
  const j = await getJson(u);
  const hit = (j.result || []).find((d) => d.code === r.issue);
  if (!hit) return { pending: '第 ' + r.issue + ' 期未开奖' };
  const ok = predicate(hit);
  return { outcome: ok ? 'true' : 'false', note: 'cwl 官方 ' + r.issue + ' 期 red=' + hit.red + ' blue=' + hit.blue + '（' + what + '，机检）' };
}
//RESOLVE-B2
async function main() {
  db.init();
  const conn = db.getConnection();
  const rows = conn.prepare('SELECT p.id, p.evidence_json FROM predictions p JOIN games g ON g.id = p.game_id WHERE g.game_type LIKE ? AND p.outcome IS NULL ORDER BY p.id').all('corpus%');
  console.log('corpus pending rows:', rows.length, 'confirm=' + CONFIRM);
  let resolved = 0, pending = 0, failed = 0;
  for (const row of rows) {
    let ev = null;
    try { ev = JSON.parse(row.evidence_json || '[]'); } catch (e) { ev = []; }
    const r = ev && ev[0] && ev[0].resolve;
    if (!r || !RESOLVERS[r.kind]) { console.log('skip id=' + row.id, '（无 resolve 参数，不机械回填）'); continue; }
    let out;
    try { out = await RESOLVERS[r.kind](r); } catch (e) { out = { error: e.message }; }
    if (out && out.pending) { pending++; console.log('pending id=' + row.id, r.kind, '—', out.pending); continue; }
    if (out && out.error) { failed++; console.log('fetch-fail id=' + row.id, r.kind, '—', out.error, '（跳过不写）'); continue; }
    if (CONFIRM) {
      const res = resolvePrediction(row.id, out.outcome, out.note);
      if (res.ok) { resolved++; console.log('resolved id=' + row.id, '->', out.outcome, '|', out.note); }
      else { console.log('resolve-refused id=' + row.id, res.reason); }
    } else {
      console.log('[dry] would resolve id=' + row.id, '->', out.outcome, '|', out.note);
    }
  }
  console.log('summary: resolved=' + resolved, 'pending=' + pending, 'fetch-fail=' + failed, 'confirm=' + CONFIRM);
  if (!CONFIRM) console.log('DRY-RUN：未写库。加 --confirm 执行机械回填。');
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });