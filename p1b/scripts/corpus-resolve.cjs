'use strict';
// 语料库题目机械 resolve（corpus 棒 2026-09-12）：零 LLM，按 evidence_json[0].resolve 参数
// 拉公开源真值后回填 outcome/resolve_note。真值未到的题（预报日未入 archive/月值未发布/期未开奖）
// 保持 unresolved 跳过；网络失败跳过不写。账本不可变：已 resolve 拒改（resolvePrediction 守卫）。
// 用法：node scripts/corpus-resolve.cjs [--confirm] [--db <path>]
// 2026-09-14 补 --db（新纪律：db/路径参数须显式传，禁依赖默认值——原实现硬编码生产库，
//   导致无法对临时库做回归测试；本条纪律见 commit 3384eba 留痕）。
const { db } = require('../src/deps');
const { resolvePrediction } = require('../src/db/predictionsStore');
const { klineClosed } = require('../src/evidence/klineClosed'); // 日 K「已收盘」单一真源（2026-09-28）
const CONFIRM = process.argv.includes('--confirm');
const DB_ARG = (() => { const i = process.argv.indexOf('--db'); return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : null; })();
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
  // bug-28 护栏（2026-09-14）：kind 与参数不匹配时**拒判**，不得静默给出 false。
  // 病象：cwl_ssq_red_contains 在 ball=null 时 `indexOf(null)` 恒 -1 ⇒ **恒判 false**。
  //   实测 id=732/734/736（「蓝球为奇数」题被 v1 写入器硬编码成 red_contains + ball=null）会踩中。
  //   若放行，会把错误真值写进账本（账本不可变 ⇒ 污染不可逆）。故此处硬拒并要求改 kind。
  async cwl_ssq_red_contains(r) {
    if (r.ball === null || r.ball === undefined || r.ball === '') {
      return { reject: 'cwl_ssq_red_contains 缺 ball 参数（ball=' + JSON.stringify(r.ball) + '）——'
        + '拒判（防 indexOf(null) 恒 -1 静默判 false）。请校验写入器是否把 kind 写错（如 blueodd 误标为 red_contains）。' };
    }
    return cwlEval(r, (d) => d.red.split(',').indexOf(r.ball) !== -1, 'red 含 ' + r.ball);
  },
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
    // ★2026-09-21（四十三）批：显式传 Referer——修 38 条全未解（诊断见 .scratch/p36/dlt专项诊断-20260921.md）
    //   根因：daemon 强制注入浏览器 UA，而 sporttery 对「浏览器 UA」要求完整浏览器头上下文
    //   ⇒ 裸浏览器 UA 判爬虫（HTTP 567）。实测：浏览器 UA+Referer → 200；非浏览器 UA → 200。
    //   本 resolver 显式给 Referer（最小改动；不改 daemon 全局默认值——那会影响全部 61 kind）。
    const j = await getJson(u, { Referer: 'https://static.sporttery.cn/' });
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
  // ══ B3/WIDE/B4 批：Open-Meteo 家族（air hourly 日均 / archive+forecast daily 单值）══
  async _omHourlyMean(r) {
    if (futureDay(r.date)) return { pending: r.date + ' 尚未到（前瞻事件未发生，不结算）' };
    const u = subst(r.url_template || r.url, r);
    const vn = varOf(u, 'hourly');
    if (!vn) return { pending: 'url 未带 hourly= 变量' };
    let j;
    try { j = await getJson(u); } catch (e) { if (String(e.message).indexOf('HTTP 400') !== -1) return { pending: 'open-meteo 400（该日无数据）' }; throw e; }
    const t = (j.hourly && j.hourly.time) || [], a = (j.hourly && j.hourly[vn]) || [];
    const vals = [];
    t.forEach((ts, i) => { if (String(ts).slice(0, 10) !== r.date) return; const v = a[i]; if (v === null || v === undefined || !isFinite(v)) return; vals.push(Number(v)); });
    if (!vals.length) return { pending: r.date + ' ' + vn + ' 尚无小时值（未入库/未发生）' };
    if (vals.length < 20) return { pending: r.date + ' ' + vn + ' 仅 ' + vals.length + ' 小时值（未满当日，不结算）' };
    const m = vals.reduce((x, y) => x + y, 0) / vals.length;
    return finish(r, m, 'Open-Meteo hourly.' + vn + ' ' + r.date + ' 日均=' + m.toFixed(4) + '（' + vals.length + ' 小时）');
  },
  async _omDaily(r) {
    let tpl = r.url_template || r.url;
    if (tpl.indexOf('api.open-meteo.com/v1/forecast') !== -1) {
      if (futureDay(r.date)) return { pending: r.date + ' 尚未到（前瞻事件未发生，不结算）' };
      tpl = tpl.split('api.open-meteo.com/v1/forecast').join('archive-api.open-meteo.com/v1/archive');
    }
    if (futureDay(r.date)) return { pending: r.date + ' 尚未到（前瞻事件未发生，不结算）' };
    const u = subst(tpl, r);
    const vn = varOf(u, 'daily');
    if (!vn) return { pending: 'url 未带 daily= 变量' };
    let j;
    try { j = await getJson(u); } catch (e) { if (String(e.message).indexOf('HTTP 400') !== -1) return { pending: 'open-meteo 400（该日无数据）' }; throw e; }
    const t = (j.daily && j.daily.time) || [], a = (j.daily && j.daily[vn]) || [];
    const i = t.indexOf(r.date);
    const v = i >= 0 ? a[i] : null;
    if (v === null || v === undefined) return { pending: r.date + ' 的 daily.' + vn + ' 尚无值（ERA5/预报未入库）' };
    return finish(r, v, 'Open-Meteo daily.' + vn + ' ' + r.date + '=' + v);
  },
  // ══ DBnomics 家族（期值 / 月均值）══
  async _dbnPeriod(r) {
    const j = await getJson(subst(r.url_template || r.url, r));
    const doc = j && j.series && j.series.docs && j.series.docs[0];
    if (!doc) return { pending: 'DBnomics 序列不存在' };
    const key = r.period !== undefined ? String(r.period) : (r.month !== undefined ? String(r.month) : String(r.year));
    const i = doc.period.indexOf(key);
    if (i < 0) return { pending: 'DBnomics ' + (r.series_code || r.series) + ' ' + key + ' 观测未发布' };
    const v = doc.value[i];
    if (v === null || v === undefined || v === 'NA' || !isFinite(Number(v))) return { pending: key + ' 值为空/NA（不猜）' };
    return finish(r, Number(v), 'DBnomics ' + (r.series_code || r.series) + ' ' + key + '=' + v);
  },
  async _dbnMonthMean(r) {
    const j = await getJson(subst(r.url_template || r.url, r));
    const doc = j && j.series && j.series.docs && j.series.docs[0];
    if (!doc) return { pending: 'DBnomics 序列不存在' };
    const vs = [];
    doc.period.forEach((p, i) => {
      if (String(p).slice(0, 7) !== r.month) return;
      const v = doc.value[i];
      if (v === null || v === undefined || v === 'NA' || !isFinite(Number(v))) return;
      vs.push(Number(v));
    });
    if (!vs.length) return { pending: 'DBnomics ' + r.series + ' ' + r.month + ' 观测未发布' };
    const m = vs.reduce((x, y) => x + y, 0) / vs.length;
    return finish(r, m, 'DBnomics ' + r.series + ' ' + r.month + ' 月均=' + m.toFixed(4) + '（' + vs.length + ' 个日值）');
  },
  // ══ Eurostat 直连 JSON-stat（官方 dissemination API）══
  async _eurostatJsonstat(r) {
    const map = Object.assign({ last_n: '120' }, r);
    const u = subst(r.url_template || r.url, map);
    const j = await getJson(u);
    const ix = j && j.dimension && j.dimension.time && j.dimension.time.category && j.dimension.time.category.index;
    if (!ix) return { pending: 'Eurostat 返回无 time 维（参数不符）' };
    const key = r.month !== undefined ? String(r.month) : String(r.year);
    const ti = ix[key];
    if (ti === undefined) return { pending: 'Eurostat ' + key + ' 未发布（time 维无该期）' };
    const pos = (j.id || []).map((x) => (x === 'time' ? ti : 0));
    let flat = 0;
    for (let i = 0; i < j.size.length; i++) flat = flat * j.size[i] + pos[i];
    const v = j.value ? j.value[flat] : undefined;
    if (v === null || v === undefined || !isFinite(Number(v))) return { pending: 'Eurostat ' + key + ' 值为空' };
    return finish(r, Number(v), 'Eurostat ' + (r.geo || '') + ' ' + key + '=' + v);
  },
  // ══ Delphi Epidata（CDC FluView 周 ILI）══
  async _delphiFlu(r) {
    const j = await getJsonRetry(subst(r.url_template || r.url, r));
    const epi = (j && j.epidata) || [];
    const hit = epi.filter((x) => String(x.epiweek) === String(r.epiweek))[0];
    if (!hit) return { pending: 'FluView ' + r.epiweek + ' 周未发布' };
    if (hit.num_ili === null || hit.num_ili === undefined) return { pending: 'FluView ' + r.epiweek + ' num_ili 缺失' };
    return finish(r, Number(hit.num_ili), 'Delphi fluview ' + (r.region || 'nat') + ' ' + r.epiweek + ' num_ili=' + hit.num_ili);
  },
  // ══ 行情 / 汇率 ══
  async binance_daily_close(r) {
    // 2026-09-15 文案修：未来日应报「尚未到」（与其余 resolver 同款），不是「无该日 K 线」（听起来像数据缺失）
    if (futureDay(r.date)) return { pending: r.date + ' 尚未到（UTC 日未收盘）' };
    const j = await getJson(subst(r.url_template || r.url, r));
    if (!Array.isArray(j) || !j.length || !j[0] || j[0][4] === undefined) return { pending: 'Binance ' + r.date + ' 无该日 K 线' };
    // ★2026-09-28 修：取 close 前必须证明这根 K 线**已收盘**。
    //   病根不是预筛不够严，是**真值就在这一行写的**：上面那句 futureDay 用上海日历卡 UTC 日，
    //   北京时间 00:00–07:59（＝UTC 16:00–23:59）时上海日期大 1 ⇒ 预筛放行 ⇒ j[0] 是**当日那根还在长的**
    //   K 线 ⇒ 半日价格被当收盘价写进不可变账本。⚠ 只把 today()/shToday() 换成 UTC 不解决：
    //   那只是把 8 小时错窗挪到 UTC 侧，正确性仍寄生在一个「省 API 调用」的启发式上。
    //   判据取自数据自报的 closeTime（与时区无关），单一真源见 p1b/src/evidence/klineClosed.js。
    if (!klineClosed(j[0])) return { pending: 'Binance ' + r.date + ' K 线未收盘（closeTime 在当前时刻之后，半日价格不作收盘价）' };
    return finish(r, Number(j[0][4]), 'Binance ' + r.symbol + ' ' + r.date + ' close=' + j[0][4]);
  },
  async kraken_daily_close(r) {
    // 2026-09-15 文案修：同上
    if (futureDay(r.date)) return { pending: r.date + ' 尚未到（UTC 日未收盘）' };
    const j = await getJson(subst(specUrl(r), r));
    const res = (j && j.result) || {};
    const key = Object.keys(res).filter((k) => k !== 'last')[0];
    if (!key) return { pending: 'Kraken 无 OHLC 数据' };
    const row = (res[key] || []).filter((x) => new Date(Number(x[0]) * 1000).toISOString().slice(0, 10) === r.date)[0];
    if (!row) return { pending: 'Kraken ' + r.date + ' 无该日 K 线' };
    return finish(r, Number(row[4]), 'Kraken ' + r.pair + ' ' + r.date + ' close=' + row[4]);
  },
  async frankfurter_rate(r) {
    if (futureDay(r.date)) return { pending: r.date + ' 尚未到（ECB 未发布）' };
    let j;
    try { j = await getJson(subst(r.url_template || r.url, r)); } catch (e) { if (String(e.message).indexOf('HTTP 404') !== -1) return { pending: r.date + ' ECB 未发布' }; throw e; }
    if (String(j.date) !== String(r.date)) return { pending: 'Frankfurter 回退到 ' + j.date + '（非目标日 ' + r.date + '，不猜）' };
    const v = j.rates && j.rates[r.quote];
    return finish(r, v, 'Frankfurter ' + j.date + ' ' + r.base + '/' + r.quote + '=' + v);
  },
  async frankfurter_rate_range(r) {
    // 新形态字段改名归一（from/to → base/quote）：解析器体与标签读的是 base/quote
    if (!r.base && r.from) r.base = r.from;
    if (!r.quote && r.to) r.quote = r.to;
    if (futureDay(r.date)) return { pending: r.date + ' 尚未到（ECB 未发布）' };
    let j;
    try { j = await getJson(subst(specUrl(r), r)); } catch (e) { if (String(e.message).indexOf('HTTP 404') !== -1) return { pending: r.date + ' 区间未发布' }; throw e; }
    const ks = Object.keys(j.rates || {}).filter((d) => d >= r.date).sort();
    if (!ks.length) return { pending: r.date + '..' + (r.date_plus7 || '') + ' 内无发布日' };
    const v = j.rates[ks[0]][r.quote];
    return finish(r, v, 'Frankfurter ' + ks[0] + ' ' + r.base + '/' + r.quote + '=' + v);
  },
  // ══ 潮汐 / 气温 / 河流 / CO2 ══
  async _noaaTideDailyHigh(r) {
    if (futureDay(r.date)) return { pending: r.date + ' 尚未到' };
    const nod = String(r.date).replace(/-/g, '');
    const j = await getJson(subst(r.url_template || r.url, { date: nod, date_nodash: nod }));
    const vals = ((j && j.predictions) || []).filter((p) => String(p.t).slice(0, 10) === r.date).map((p) => Number(p.v)).filter((x) => isFinite(x));
    if (!vals.length) return { pending: 'NOAA ' + r.station + ' 无 ' + r.date + ' 预报' };
    const mx = Math.max.apply(null, vals);
    return finish(r, mx, 'NOAA ' + r.station + ' ' + r.date + ' 当日最高潮位=' + mx + 'm(MSL, ' + vals.length + ' 点)');
  },
  async ghcn_daily_tmax(r) {
    if (futureDay(r.date)) return { pending: r.date + ' 尚未到' };
    const j = await getJson(subst(r.url_template || r.url, r));
    const row = (Array.isArray(j) ? j : []).filter((x) => String(x.DATE) === r.date)[0];
    if (!row) return { pending: 'NCEI 尚无 ' + r.date + ' 记录' };
    return finish(r, Number(row.TMAX), 'NCEI ' + r.station + ' ' + r.date + ' TMAX=' + row.TMAX + 'F(units=standard)');
  },
  async usgs_nwis_daily_discharge(r) {
    if (futureDay(r.date)) return { pending: r.date + ' 尚未到' };
    const j = await getJson(subst(r.url_template || r.url, r));
    const ts = j && j.value && j.value.timeSeries && j.value.timeSeries[0];
    if (!ts) return { pending: 'USGS 无该站数据' };
    const row = ((ts.values[0] || {}).value || []).filter((x) => String(x.dateTime).slice(0, 10) === r.date)[0];
    if (!row) return { pending: 'USGS ' + r.site + ' 无 ' + r.date + ' 日值' };
    return finish(r, Number(row.value), 'USGS ' + r.site + ' ' + r.date + ' discharge=' + row.value + ' ft3/s');
  },
  async noaa_gml_co2_daily(r) {
    if (futureDay(r.date)) return { pending: r.date + ' 尚未到' };
    const t = await getText(r.url);
    const row = t.split('\n').filter((x) => x && x.charAt(0) !== '#').map((x) => x.split(','))
      .filter((c) => c.length >= 5 && c[0] + '-' + ('0' + c[1]).slice(-2) + '-' + ('0' + c[2]).slice(-2) === r.date)[0];
    if (!row) return { pending: 'NOAA GML 无 ' + r.date + ' 日值' };
    return finish(r, Number(row[4]), 'NOAA GML MLO ' + r.date + ' CO2=' + row[4] + 'ppm');
  },
  // ══ 周窗计数 ══
  async crossref_week_total(r) {
    const end = plusDays(r.week_start, 6);
    if (end >= shToday()) return { pending: '窗口 ' + r.week_start + '~' + end + ' 未结束' };
    const j = await getJson(subst(specUrl(r), { date: r.week_start, date_plus6: end }));
    const v = j && j.message && j.message['total-results'];
    if (v === undefined || v === null) return { pending: 'Crossref 未返回 total-results' };
    return finish(r, Number(v), 'Crossref ' + r.week_start + '~' + end + ' 新注册 DOI=' + v);
  },
  async nvd_cve_week_count(r) {
    const end = plusDays(r.week_start, 6);
    if (end >= shToday()) return { pending: '窗口 ' + r.week_start + '~' + end + ' 未结束' };
    const j = await getJson(subst(specUrl(r), { date: r.week_start, date_plus6: end }));
    if (j.totalResults === undefined || j.totalResults === null) return { pending: 'NVD 未返回 totalResults' };
    return finish(r, Number(j.totalResults), 'NVD ' + r.week_start + '~' + end + ' 新发 CVE=' + j.totalResults);
  },
  async github_weekly_commits(r) {
    const end = r.week_end || plusDays(r.week_start, 6);
    if (end >= shToday()) return { pending: '周 ' + r.week_start + '~' + end + ' 未结束' };
    const j = await getJson(r.url, { Accept: 'application/vnd.github+json' });
    if (!Array.isArray(j)) return { pending: 'GitHub stats 未就绪（可能 202 计算中）' };
    const row = j.filter((w) => w && w.week && new Date(w.week * 1000).toISOString().slice(0, 10) === r.week_start)[0];
    if (!row) return { pending: 'GitHub 无 ' + r.week_start + ' 周数据' };
    return finish(r, Number(row.total), 'GitHub ' + r.repo + ' ' + r.week_start + '~' + end + ' commits=' + row.total);
  },
  async openalex_works_count(r) {
    const end = r.end || plusDays(r.start, 6);
    if (end >= shToday()) return { pending: '窗口 ' + r.start + '~' + end + ' 未结束' };
    const j = await getJson(subst(r.url_template || r.url, r));
    const v = j && j.meta && j.meta.count;
    if (v === undefined || v === null) return { pending: 'OpenAlex 未返回 meta.count' };
    return finish(r, Number(v), 'OpenAlex ' + r.start + '~' + end + ' count=' + v);
  },
  async npm_downloads_window(r) {
    const wEnd = r.end || r.date, wStart = r.start || r.date;
    if (!wEnd || !wStart) return { pending: '窗口字段缺失（start/end 与 date 都没有）' };
    if (String(wEnd) >= shToday()) return { pending: '窗口 ' + wStart + '~' + wEnd + ' 未结束' };
    const j = await getJson(subst(specUrl(r), r));
    const ds = ((j && j.downloads) || []).filter((x) => x.day >= wStart && x.day <= wEnd);
    if (ds.length < windowDays(r)) return { pending: 'npm ' + (r.package || r.pkg) + ' 窗口仅 ' + ds.length + ' 天（需 ' + windowDays(r) + ' 天，不结算）' };
    const sum = ds.reduce((a, x) => a + Number(x.downloads || 0), 0);
    return finish(r, sum, 'npm ' + (r.package || r.pkg) + ' ' + wStart + '~' + wEnd + ' 下载=' + sum);
  },
  async wikimedia_pageviews(r) {
    if (futureDay(r.date)) return { pending: r.date + ' 尚未到' };
    const nod = String(r.date).replace(/-/g, '');
    const j = await getJsonRetry(subst(r.url_template || r.url, { date: nod }));
    const ymd = nod;
    const it = ((j && j.items) || []).filter((x) => String(x.timestamp).slice(0, 8) === ymd)[0];
    if (!it) return { pending: 'Wikimedia 无 ' + r.date + ' 数据' };
    return finish(r, Number(it.views), 'Wikimedia ' + r.article + ' ' + r.date + ' views=' + it.views);
  },
  // ══ 电力 / 体育 / 交通 / 票房 / 天文 ══
  async elexon_fuelhh_daily_mean(r) {
    if (futureDay(r.date)) return { pending: r.date + ' 尚未到' };
    const j = await getJson(subst(r.url_template || r.url, { date: r.date, date_plus1: plusDays(r.date, 1) }));
    const vals = ((j && j.data) || []).filter((x) => String(x.fuelType) === r.fuel && String(x.settlementDate).slice(0, 10) === r.date).map((x) => Number(x.generation)).filter((x) => isFinite(x));
    if (vals.length < 40) return { pending: 'Elexon ' + r.fuel + ' ' + r.date + ' 仅 ' + vals.length + ' 点（<40，未满当日）' };
    const m = vals.reduce((a, x) => a + x, 0) / vals.length;
    return finish(r, m, 'Elexon ' + r.fuel + ' ' + r.date + ' 均值=' + m.toFixed(4) + 'MW（' + vals.length + ' 点）');
  },
  // bug-29 修（2026-09-14）：原实现有两处口径错误 ——
  //   ① **用 UTC 日过滤**（`toISOString().slice(0,10) !== r.date`）：API 以 `start=end=<本地日>` 调用时
  //      返回的正是**该国本地日**（实测 es：2026-06-24T22:00Z ~ 2026-06-25T21:45Z ＝ 本地 06-25 全天）。
  //      按 UTC 日过滤会把本地 00:00–02:00 的 8 个点（15 分粒度）判到前一天而丢弃 ⇒ 均值偏差实测 **~8%**
  //      （fr/Solar −8.33%、es/Solar −7.96%）。已核 24 条存量行**零翻转**（均值离阈值远），但口径错误必须修。
  //   ② **完成度用硬阈值 n≥80**：该值按 15 分钟粒度标定；而部分国家（实测 Belgium）为**小时粒度**
  //      ⇒ 满日仅 24 点，永远 <80 ⇒ 4 行被永久误判「未满当日」而卡死。
  //   修为：直接采用 API 返回窗口（即本地日）+ **按实测步长自适应**算完成度（期望点数 = 86400/step）。
  async energycharts_daily_mean(r) {
    if (futureDay(r.date)) return { pending: r.date + ' 尚未到' };
    const j = await getJsonRetry(subst(r.url_template || r.url, r));
    const ts = j.unix_seconds || [];
    const tp = (j.production_types || []).filter((x) => x.name === r.type)[0];
    if (!tp) return { pending: 'Energy-Charts 无类型 ' + r.type };
    let sum = 0, n = 0;
    ts.forEach((sec, i) => { const v = tp.data[i]; if (v === null || v === undefined || !isFinite(v)) return; sum += Number(v); n++; });
    if (!n) return { pending: 'Energy-Charts ' + r.date + ' 无有效点' };
    // 实测步长（秒）→ 期望整日点数 → 完成度（缺 10% 以上视为未满当日）
    let step = null;
    for (let i = 1; i < ts.length; i++) { const d = ts[i] - ts[i - 1]; if (d > 0) { step = d; break; } }
    const expect = step ? Math.round(86400 / step) : null;
    const ratio = expect ? n / expect : null;
    if (expect && ratio < 0.9) {
      return { pending: 'Energy-Charts ' + r.date + ' 仅 ' + n + '/' + expect + ' 点（' + (ratio * 100).toFixed(0) + '%，未满当日；步长 ' + (step / 60) + ' 分）' };
    }
    const m = sum / n;
    return finish(r, m, 'Energy-Charts ' + r.country + ' ' + r.type + ' ' + r.date + ' 均值=' + m.toFixed(4) + 'MW'
      + '（' + n + ' 点' + (expect ? '，满日 ' + expect + ' 点·' + (step / 60) + ' 分粒度' : '') + '，本地日全窗口口径）');
  },
  async mlb_schedule_daily_total_runs(r) {
    if (futureDay(r.date)) return { pending: r.date + ' 尚未到' };
    const j = await getJson(subst(specUrl(r), r));
    const games = [];
    ((j && j.dates) || []).forEach((d) => (d.games || []).forEach((g) => games.push(g)));
    if (!games.length) return { pending: 'MLB ' + r.date + ' 无赛程' };
    const fin = games.filter((g) => g.status && g.status.abstractGameState === 'Final');
    if (fin.length !== games.length) return { pending: 'MLB ' + r.date + ' 有未终场（' + fin.length + '/' + games.length + '，不结算）' };
    let tot = 0;
    fin.forEach((g) => { tot += Number((g.teams.home.score) || 0) + Number((g.teams.away.score) || 0); });
    return finish(r, tot, 'MLB ' + r.date + ' ' + fin.length + ' 场总得分=' + tot);
  },
  async cta_daily_total_rides(r) {
    if (futureDay(r.date)) return { pending: r.date + ' 尚未到' };
    const j = await getJson(r.url);
    const row = (Array.isArray(j) ? j : []).filter((x) => String(x.service_date).slice(0, 10) === r.date)[0];
    if (!row) return { pending: 'CTA 无 ' + r.date + ' 数据（真值滞后约 2.5 月）' };
    const v = row.total_rides !== undefined ? row.total_rides : row.rides;
    if (v === undefined || v === null) return { pending: 'CTA ' + r.date + ' total_rides 缺失' };
    return finish(r, Number(v), 'CTA ' + r.date + ' total_rides=' + v);
  },
  async bom_weekend_top10_gross(r) {
    const y = String(r.week).slice(0, 4);
    const t = await getText('https://www.boxofficemojo.com/weekend/by-year/' + y + '/');
    const trs = t.split('<tr').slice(1);
    for (const row of trs) {
      const m = row.match(/\/weekend\/(\d{4}W\d{2})\//);
      if (!m || m[1] !== r.week) continue;
      const ds = (row.match(/\$[\d,]+/g) || []).map((x) => Number(x.replace(/[$,]/g, '')));
      if (!ds.length) continue;
      return finish(r, ds[0], 'BoxOfficeMojo ' + r.week + ' Top10 Gross=$' + ds[0]);
    }
    return { pending: 'BOM ' + r.week + ' 未发布（页面无该期行）' };
  },
  async jpl_cad_monthly_count(r) {
    if (monthEndOf(r.month) >= shToday()) return { pending: r.month + ' 月未结束' };
    const j = await getJson(r.url);
    const M = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const n = ((j && j.data) || []).filter((x) => { const p = String(x[3]).split('-'); return p[0] + '-' + M[p[1]] === r.month; }).length;
    return finish(r, n, 'JPL CAD ' + r.month + ' 近地接近事件数=' + n);
  },
  async swpc_solar_cycle_monthly(r) {
    if (monthEndOf(r.month) >= shToday()) return { pending: r.month + ' 月未结束' };
    const j = await getJson(r.url);
    const row = (Array.isArray(j) ? j : []).filter((x) => String(x['time-tag']) === r.month)[0];
    if (!row) return { pending: 'SWPC ' + r.month + ' 月值未发布' };
    const key = (r.field_name === 'f107' || r.field_name === 'f10.7') ? 'f10.7' : 'ssn';
    const v = row[key];
    if (v === null || v === undefined || !isFinite(Number(v)) || Number(v) < 0) return { pending: 'SWPC ' + key + ' 缺失/占位（' + v + '）' };
    return finish(r, Number(v), 'SWPC ' + r.month + ' ' + key + '=' + v);
  },
  /**
   * 英超 1X2 赔率题（**2026-09-17 新增**；依据 `docs/specs/第二期广域普查-体育赔率接入草案-20260917.md` ＋ 用户拍板「赔率题落库」）。
   * 题面＝「主队获胜」二值题；真值源＝The Odds API `/v4/sports/<league>/scores`（**免费层可用，实测 HTTP 200**）。
   * 1X2 判定规则＝**单一实现**（require 出题器 `odds-questions.cjs::h2hOutcome`，禁写两份）。
   * key 读 gitignored 配置（铁律⑤：key 不出服务端；**任何输出都不回显 key**）；缺 key ⇒ pending（不崩、不写）。
   * 配额：每结算轮 1 次请求（`daysFrom=3` 窗覆盖「开赛后 ≤3 日到期」的题；daemon 按日跑 ⇒ 必在窗内）。
   */
  async oddsapi_h2h(r) {
    const fsx = require('fs'); const pathx = require('path');
    const cfgP = pathx.resolve(__dirname, '..', '..', 'p1a-terminal', 'config', 'odds.json');
    let key = null;
    try { const cfg = JSON.parse(fsx.readFileSync(cfgP, 'utf8')); key = cfg.apiKey || cfg.key || Object.values(cfg).find((v) => typeof v === 'string' && v.length > 20) || null; } catch (e) { key = null; }
    if (!key) return { pending: '缺 The Odds API key（p1a-terminal/config/odds.json，gitignored）⇒ 不结算' };
    const lg = r.league || 'soccer_epl';
    const j = await getJson('https://api.the-odds-api.com/v4/sports/' + lg + '/scores/?daysFrom=3&apiKey=' + key);
    const m = (Array.isArray(j) ? j : []).filter((x) => String(x.id) === String(r.match_id))[0];
    if (!m) return { pending: 'scores 窗内（近 3 日）未见 ' + r.match_id };
    if (!m.completed) return { pending: '未完赛（' + String(m.commence_time) + '）' };
    const sc = {}; for (const s of (m.scores || [])) sc[String(s.name)] = Number(s.score);
    const { h2hOutcome } = require(pathx.join(__dirname, 'odds-questions.cjs'));
    const v = h2hOutcome(sc[m.home_team], sc[m.away_team], r.pick);
    if (!v) return { pending: '比分缺失/非数（' + JSON.stringify(m.scores) + '）' };
    return { outcome: v.outcome, note: '机检:英超 ' + m.home_team + ' ' + v.detail + ' ' + m.away_team + '（The Odds API scores）' };
  },
  // ── sim 域（狼人局）：放逐座位机检（2026-09-21 · U 型路径题用）──
  // ★与其余 resolver 的区别：真值**不在网络**，在本地账本同库的 events/games 表。
  //   本函数经 getJson 之外的通道取数——由调用方（sim 结算批）注入 db 句柄；此处若未注入则如实 reject（不猜）。
  //   口径：events 表 type='death' 且 raw_text 含『计票』⇒ 其 JSON 的键即被放逐座位；
  //   另核 games.meta.truth 里该座位的角色（供角色复核，不参与判定）。
  async sim_exile_seat(r) {
    if (!r || r.game_id === undefined || r.seat === undefined) {
      return { reject: 'sim_exile_seat 缺 game_id/seat 参数 ⇒ 拒判（防静默判 false）' };
    }
    const sdb = (r.__db || null);
    if (!sdb) return { reject: 'sim_exile_seat 需注入 db 句柄（r.__db）；本 resolver 真值在本地库非网络' };
    const row = sdb.prepare(
      "SELECT raw_text FROM events WHERE game_id = ? AND type = 'death' AND raw_text LIKE '%计票%' ORDER BY seq LIMIT 1"
    ).get(r.game_id);
    if (!row) return { pending: 'sim 局 ' + r.game_id + ' 无计票事件（未跑完或数据缺失）' };
    const m = /计票：({[^}]*})/.exec(String(row.raw_text));
    if (!m) return { reject: '计票事件格式不符（无法解析 JSON）：' + String(row.raw_text).slice(0, 80) };
    let tally; try { tally = JSON.parse(m[1]); } catch (e) { return { reject: '计票 JSON 不可解析：' + m[1] }; }
    const seats = Object.keys(tally).map((x) => Number(x));
    if (!seats.length) return { reject: '计票为空 ⇒ 无被放逐者（异常局面，拒判）' };
    const exiled = seats[0];
    const isExiled = exiled === Number(r.seat);
    return { outcome: isExiled ? 'true' : 'false',
      note: 'sim 局 ' + r.game_id + ' 计票 ' + JSON.stringify(tally) + ' ⇒ 被放逐 ' + exiled + ' 号'
        + '（本题问 ' + r.seat + ' 号；机检·本地 events 表）' };
  },
};

// ── 同口径 kind 别名（字段描述一致才共用；纯新增，不改既有 7 种）──
Object.assign(RESOLVERS, {
  openmeteo_air_daily_mean: RESOLVERS._omHourlyMean,
  openmeteo_air_pm2_5_daily_mean: RESOLVERS._omHourlyMean,
  openmeteo_air_pm10_daily_mean: RESOLVERS._omHourlyMean,
  openmeteo_air_ozone_daily_mean: RESOLVERS._omHourlyMean,
  openmeteo_marine_sst_daily: RESOLVERS._omHourlyMean,
  openmeteo_wx_daily: RESOLVERS._omDaily,
  openmeteo_archive_daily_precipitation_sum: RESOLVERS._omDaily,
  openmeteo_archive_daily_sunshine_duration: RESOLVERS._omDaily,
  openmeteo_archive_daily_wind_speed_10m_max: RESOLVERS._omDaily,
  openmeteo_forecast_daily_precipitation_sum: RESOLVERS._omDaily,
  openmeteo_forecast_daily_sunshine_duration: RESOLVERS._omDaily,
  openmeteo_forecast_daily_wind_speed_10m_max: RESOLVERS._omDaily,
  dbnomics_eurostat_tertiary_attain: RESOLVERS._dbnPeriod,
  dbnomics_eurostat_unemployment_monthly: RESOLVERS._dbnPeriod,
  dbnomics_wb_commodity_annual: RESOLVERS._dbnPeriod,
  dbnomics_bis_monthly_mean: RESOLVERS._dbnMonthMean,
  eurostat_demo_pjan_annual: RESOLVERS._eurostatJsonstat,
  eurostat_live_tertiary_attain: RESOLVERS._eurostatJsonstat,
  eurostat_live_unemployment_monthly: RESOLVERS._eurostatJsonstat,
  delphi_fluview_ili: RESOLVERS._delphiFlu,
  delphi_fluview_num_ili: RESOLVERS._delphiFlu,
  noaa_tide_daily_high: RESOLVERS._noaaTideDailyHigh,
  noaa_tide_daily_max: RESOLVERS._noaaTideDailyHigh,
  energycharts_public_power_daily_mean: RESOLVERS.energycharts_daily_mean,
  noaa_solar_cycle_ssn_monthly: RESOLVERS.swpc_solar_cycle_monthly,
});

async function cwlEval(r, predicate, what) {
  const u = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=30';
  const j = await getJson(u);
  const hit = (j.result || []).find((d) => d.code === r.issue);
  if (!hit) return { pending: '第 ' + r.issue + ' 期未开奖' };
  const ok = predicate(hit);
  return { outcome: ok ? 'true' : 'false', note: 'cwl 官方 ' + r.issue + ' 期 red=' + hit.red + ' blue=' + hit.blue + '（' + what + '，机检）' };
}

// ── B3/WIDE/B4 批新 kind 通用工具（2026-09-13 施工棒新增；既有 7 种逐字不改）──
// 注意：本段必须位于 daemon 抽取锚点（RESOLVE-B2 注释行）之前——daemon 运行时抽取该锚点以上的全部源码复用 RESOLVERS。
function shToday() { return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).slice(0, 10); }
function plusDays(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
function monthEndOf(ym) { return new Date(Date.UTC(Number(String(ym).slice(0, 4)), Number(String(ym).slice(5, 7)), 0)).toISOString().slice(0, 10); }
function subst(tpl, map) { let s = String(tpl || ''); Object.keys(map).forEach((k) => { s = s.split('{' + k + '}').join(String(map[k])); }); return s; }

// ── 规格归一化（2026-09-18）：出题器**新形态** spec 缺 url_template（个别字段还改名）⇒ 就地派生。
//    为什么需要：账本里同一 kind 存了**两代 spec**，而解析器一律读 `url_template || r.url` ⇒ 新形态
//    一路走到网络层才失败（`fetch('')` 抛 "Failed to parse URL"），且**每日复跑再 fail 一次、永久不可结**。
//    实测受影响 6 个 kind 共 31 条（详见 p1b/sim/out/resolve-routine-receipt-20260918.md §6.2-更正）。
//    ★本函数只补「取数地址」与「阅读位置」，**不触碰 threshold／cmp 语义** ⇒ 不改任何判据/口径。
//    旧形态原样返回（`url_template || url` 直通）⇒ 对既有行为零影响。
const URL_DERIVE = {
  kraken_daily_close: (r) => 'https://api.kraken.com/0/public/OHLC?pair=' + r.pair + '&interval=1440&since=' + (Date.parse(r.date + 'T00:00:00Z') - 86400000),
  frankfurter_rate_range: (r) => 'https://api.frankfurter.app/' + r.date + '..' + plusDays(r.date, 7) + '?from=' + (r.base || r.from) + '&to=' + (r.quote || r.to),
  npm_downloads_window: (r) => 'https://api.npmjs.org/downloads/range/' + (r.start || r.date) + ':' + (r.end || r.date) + '/' + (r.package || r.pkg),
  mlb_schedule_daily_total_runs: (r) => 'https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=' + r.date + '&endDate=' + r.date,
  crossref_week_total: (r) => 'https://api.crossref.org/works?filter=from-created-date:' + r.week_start + ',until-created-date:' + plusDays(r.week_start, 6) + '&rows=0',
  nvd_cve_week_count: (r) => 'https://services.nvd.nist.gov/rest/json/cves/2.0?pubStartDate=' + r.week_start + 'T00:00:00.000&pubEndDate=' + plusDays(r.week_start, 6) + 'T23:59:59.999&resultsPerPage=1',
};
/** 取数地址：旧形态直通；新形态（缺 URL）按 kind 派生；两者都无 ⇒ 返回空串（调用方照旧失败，但**不再有静默空 URL**）。 */
function specUrl(r) {
  const u = r.url_template || r.url;
  if (u) return u;
  const d = URL_DERIVE[r.kind];
  return d ? d(r) : '';
}
/** 窗口题的天数（npm 用；旧形态 7 天窗口 ⇒ 需 7 天；新形态单日 ⇒ 需 1 天）。 */
function windowDays(r) {
  const s = r.start || r.date, e = r.end || r.date;
  return Math.round((Date.parse(e + 'T00:00:00Z') - Date.parse(s + 'T00:00:00Z')) / 86400000) + 1;
}
function cmpOk(v, cmp, th) { return cmp === '<' ? v < th : cmp === '<=' ? v <= th : cmp === '>' ? v > th : v >= th; }
function varOf(url, key) { const m = String(url).match(new RegExp('[?&]' + key + '=([a-zA-Z0-9_]+)')); return m ? m[1] : null; }
function finish(r, v, label) {
  if (v === null || v === undefined || !isFinite(Number(v))) return { pending: label + '（值为空，不猜）' };
  const ok = cmpOk(Number(v), r.cmp, Number(r.threshold));
  return { outcome: ok ? 'true' : 'false', note: label + '（阈值 ' + r.cmp + ' ' + r.threshold + '，机检）' };
}
function futureDay(d) { return String(d) >= shToday(); }
// 限量宿主（Wikimedia / Energy-Charts）实测连发会 429 → 仅新 kind 使用带退避重试的取数
async function getJsonRetry(url, headers, tries) {
  const n = tries || 4;
  let last = null;
  for (let a = 0; a < n; a++) {
    try { return await getJson(url, headers); }
    catch (e) {
      last = e;
      const m = String(e && e.message || '');
      const retriable = m.indexOf('429') !== -1 || m.indexOf('fetch failed') !== -1 || m.indexOf('abort') !== -1;
      if (!retriable || a === n - 1) throw e;
      await new Promise((s) => setTimeout(s, 1500 * (a + 1)));
    }
  }
  throw last;
}
async function getText(url, headers) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: Object.assign({ 'User-Agent': 'corpus-resolve/1.1 (+node)', Accept: '*/*' }, headers || {}) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally { clearTimeout(t); }
}

//RESOLVE-B2
async function main() {
  if (DB_ARG) db.init(DB_ARG); else db.init();
  const conn = db.getConnection();
  const rows = conn.prepare('SELECT p.id, p.evidence_json FROM predictions p JOIN games g ON g.id = p.game_id WHERE g.game_type LIKE ? AND p.outcome IS NULL ORDER BY p.id').all('corpus%');
  console.log('corpus pending rows:', rows.length, 'confirm=' + CONFIRM);
  let resolved = 0, pending = 0, failed = 0, noResolve = 0, unregistered = 0, rejected = 0;
  const stat = {};
  const bump = (kind, key) => { const s = stat[kind] || (stat[kind] = { resolved: 0, pending: 0, failed: 0 }); s[key]++; };
  const badKind = {};
  for (const row of rows) {
    let ev = null;
    try { ev = JSON.parse(row.evidence_json || '[]'); } catch (e) { ev = []; }
    const r = ev && ev[0] && ev[0].resolve;
    if (!r) { noResolve++; console.log('skip id=' + row.id, '（无 resolve 参数，不机械回填）'); continue; }
    if (!RESOLVERS[r.kind]) { unregistered++; badKind[r.kind] = (badKind[r.kind] || 0) + 1; console.log('skip id=' + row.id, '（kind 未注册，需实现：' + r.kind + '）'); continue; }
    let out;
    try { out = await RESOLVERS[r.kind](r); } catch (e) { out = { error: e.message }; }
    if (out && out.pending) { pending++; bump(r.kind, 'pending'); console.log('pending id=' + row.id, r.kind, '—', out.pending); continue; }
    if (out && out.reject) { rejected++; bump(r.kind, 'rejected'); console.log('REJECT id=' + row.id, r.kind, '—', out.reject); continue; }
    if (out && out.error) { failed++; bump(r.kind, 'failed'); console.log('fetch-fail id=' + row.id, r.kind, '—', out.error, '（跳过不写）'); continue; }
    if (CONFIRM) {
      const res = resolvePrediction(row.id, out.outcome, out.note);
      if (res.ok) { resolved++; bump(r.kind, 'resolved'); console.log('resolved id=' + row.id, '->', out.outcome, '|', out.note); }
      else { console.log('resolve-refused id=' + row.id, res.reason); }
    } else {
      bump(r.kind, 'resolved');
      console.log('[dry] would resolve id=' + row.id, '->', out.outcome, '|', out.note);
    }
  }
  console.log('summary: resolved=' + resolved, 'pending=' + pending, 'fetch-fail=' + failed, 'unregistered=' + unregistered, 'rejected=' + rejected, 'no-resolve=' + noResolve, 'confirm=' + CONFIRM);
  console.log('unregistered-kinds: ' + JSON.stringify(badKind));
  console.log('by-kind: ' + JSON.stringify(stat));
  if (!CONFIRM) console.log('DRY-RUN：未写库。加 --confirm 执行机械回填。');
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });