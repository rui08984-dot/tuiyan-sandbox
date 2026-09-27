'use strict';
/**
 * p1b/src/evidence/revealClass.js —— 「揭晓分流」的**单一真源**（2026-09-28 · T6 / M3）
 *
 * 【病象：待落定页假设「你要手填全部」】
 * 旧页把到期未解的题列成一队，每条三个键（真发生了/没发生/判定不清）让你手填。
 * 但守护进程（corpus-resolve-daemon）**已经在自动结算**——实测当日一轮：
 *   到期 21 条 ⇒ 自动 resolved 2、pending 12、fetch-fail 7。
 * ⇒ 那个页面是**倒退设计**：它把已经自动做完的事又摊给用户做一遍。
 *
 * 【本模块做分类，只做分类】
 * 把「到期未解」的题分成三类，**每类给出人话理由**：
 *   ① auto_ok    这类题机器能自动查到真值 ⇒ 揭晓应当是自动的，不该问你
 *   ② need_human 机器拿不到真值，但**人能回答**（开奖未公布、判据歧义等）
 *   ③ stuck      机器**永远**拿不到（接口地域封禁、真值窗口已滑出等）⇒ 不给假按钮
 *
 * ★三类互斥且完备（可由第 ④ 条测试证）：每个到期未解的题必属其一。
 *
 * 【分类依据：kind 的取数能力，不是运行时日志】
 * 守护进程的分类（pending/fetch-fail）只存在于**运行时**，没落库、不可查。
 * 而「这类题能不能自动取到真值」是 **kind 的固有属性**——由下表显式登记。
 * 依据是实测记录（见每条的 note），**不是猜的**。
 *
 * 【为什么 stuck 不做成可点的按钮】
 * 点了没反应比不给按钮更糟：用户会以为是 bug。做「说清为什么 + 不给按钮」。
 */

/**
 * kind → 三类之一。
 * ok      = 机器能自动查（守护进程已有 resolver 且外部接口可达）
 * human   = 机器拿不到但人能答（等待外部公布 / 判据需人裁）
 * stuck   = 机器永远拿不到（接口封禁 / 真值窗口已过）
 */
const REVEAL_CLASS = {
  // —— 可自动：守护进程实测取到过真值
  binance_daily_close:            { c: 'ok',    note: '到期自动查 Binance 收盘价' },
  kraken_daily_close:             { c: 'ok',    note: '到期自动查 Kraken 收盘价' },
  openmeteo_daily_max:            { c: 'ok',    note: '到期自动查 Open-Meteo 实测' },
  openmeteo_forecast_daily_max:   { c: 'ok',    note: '到期自动查 Open-Meteo' },
  ghcn_daily_tmax:                { c: 'ok',    note: '到期自动查气象站实测' },
  noaa_gml_co2_daily:             { c: 'ok',    note: '到期自动查 NOAA 监测' },
  usgs_nwis_daily_discharge:      { c: 'ok',    note: '到期自动查水文站' },
  frankfurter_rate:               { c: 'ok',    note: '到期自动查 ECB 参考汇率' },
  frankfurter_rate_range:         { c: 'ok',    note: '到期自动查 ECB 汇率区间' },
  npm_downloads_window:           { c: 'ok',    note: '到期自动查 npm 统计' },
  wikimedia_pageviews:            { c: 'ok',    note: '到期自动查维基流量' },
  github_weekly_commits:          { c: 'ok',    note: '到期自动查 GitHub 统计' },
  crossref_week_total:            { c: 'ok',    note: '到期自动查 Crossref' },
  openalex_works_count:           { c: 'ok',    note: '到期自动查 OpenAlex' },
  nvd_cve_week_count:             { c: 'ok',    note: '到期自动查 NVD 漏洞库' },
  jpl_cad_monthly_count:          { c: 'ok',    note: '到期自动查 JPL 名录' },
  swpc_solar_cycle_monthly:       { c: 'ok',    note: '到期自动查空间天气' },
  dbnomics_series_value:          { c: 'ok',    note: '到期自动查各国统计局' },
  elexon_fuelhh_daily_mean:       { c: 'ok',    note: '到期自动查英国电网' },
  energycharts_daily_mean:        { c: 'ok',    note: '到期自动查能源图表' },
  bom_weekend_top10_gross:        { c: 'ok',    note: '到期自动查票房' },
  mlb_schedule_daily_total_runs:  { c: 'ok',    note: '到期自动查赛程' },

  // —— 需人答：真值来自「官方公布」，机器拿不到（接口不给结构化数据）
  cwl_ssq_red_contains:           { c: 'human', note: '双色球要等福彩开奖公告公布' },
  cwl_ssq_blue_odd:               { c: 'human', note: '双色球要等福彩开奖公告公布' },
  cwl_ssq_blue_odd_forward:       { c: 'human', note: '双色球要等福彩开奖公告公布' },
  dlt_draw_result:                { c: 'human', note: '大乐透要等体彩开奖公告公布' },
  delphi_fluview_ili:             { c: 'human', note: '流感周报要等 CDC 发布' },
  delphi_fluview_num_ili:         { c: 'human', note: '流感周报要等 CDC 发布' },

  // —— 卡死：接口层永久不可达，或真值窗口已滑出
  cta_daily_total_rides:          { c: 'stuck', note: '芝加哥交通局接口对本机地域封禁（实测 HTTP 403），代码无法解决' },
  oddsapi_h2h:                    { c: 'stuck', note: '赔率真值只在开赛后 3 日滚动窗内可取，过期永久取不到' },
};

/** 未登记的 kind：按「需人确认」处理（保守：宁可问一句，不给错按钮） */
const DEFAULT_CLASS = { c: 'human', note: '这类题没有登记取数方式，先由你确认' };

/** 分类单条 */
function classifyReveal(kind) {
  const r = REVEAL_CLASS[kind];
  return r ? { kind, ...r } : { kind, ...DEFAULT_CLASS };
}

/** 批量统计（给界面显示三类各几条） */
function classCounts(rows) {
  const out = { ok: 0, human: 0, stuck: 0, unknown: 0 };
  for (const r of rows) {
    const k = r && r.kind;
    if (!k || !REVEAL_CLASS[k]) { out.unknown += 1; continue; }
    out[REVEAL_CLASS[k].c] += 1;
  }
  return out;
}

// ★exports 放在常量**之后**：直接写 `module.exports = { REVEAL_CLASS, ... }`
//  会在模块加载时求值，命中 const 的暂时性死区
//  （实测报错 "Cannot access 'REVEAL_CLASS' before initialization"）。
// ⇒ 导出语句必须排在声明之后。
module.exports = { REVEAL_CLASS, classifyReveal, classCounts };
