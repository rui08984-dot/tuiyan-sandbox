/**
 * kindLabel —— 真值锚的人话标签与分组（2026-09-28 · T3 / 模块 M1）
 *
 * 【病象：把引擎的内部词汇直接甩给人看】
 * 旧「记一笔」页是一个 27 项的平铺下拉，里面是
 *   `binance_daily_close` / `dlt_draw_result` / `noaa_gml_co2_daily` ……
 * 这些是**引擎标识**，不是产品词汇。用户看到它们无法判断"该不该选这个"，
 * 于是整个"选来源"这一步就废了——而这一步恰恰是**出题能不能被机检**的前提。
 *
 * 【本模块怎么改：翻译 + 重组，一个不少】
 * · 27 个 kind **一个不删**，只是每个配一个人话名，并说清「到期去哪里查」；
 * · 按**领域**分组（行情/天气/彩票/文献/能源/汇率/交通/太空/环境/站点…），
 *   让"扫读"成为可能——平铺 27 项没法扫，分组后同类挨在一起。
 *
 * ★分组的依据不是"技术分类"，是**用户凭什么判断选它**——
 *   即「到期时我能不能去某个地方查到真实答案」。所以每项都带一句"去哪查"。
 *
 * 单一真源：kind 名单来自后端 `GET /api/disclosure/compiler`（契约表
 * `g2-contract-frozen-r4.json`）。本文件只提供**展示层命名**，
 * 新增 kind 时若此处无对应项，界面会**回退显示原标识并标注"未译"**
 * （绝不静默丢项——那会让人以为"没这个来源"）。
 */

export interface KindLabel {
  /** 引擎标识（后端契约里的真名，选它时提交的就是这个）。 */
  kind: string;
  /** 人话名。 */
  label: string;
  /** 到期去哪里查真实答案。 */
  source: string;
}

/** 领域分组（顺序即界面呈现顺序：先最常问的行情/天气，再往专走去） */
export const KIND_GROUPS: { group: string; hint: string; items: KindLabel[] }[] = [
  {
    group: '行情价格',
    hint: '加密货币与商品的每日收盘价',
    items: [
      { kind: 'binance_daily_close', label: '比特币／以太坊每日收盘价', source: 'Binance 行情' },
      { kind: 'kraken_daily_close', label: '其他币对每日收盘价', source: 'Kraken 行情' },
    ],
  },
  {
    group: '天气',
    hint: '按经纬度查，任意地点',
    items: [
      { kind: 'openmeteo_forecast_daily_max', label: '某地某天最高气温（预报）', source: 'Open-Meteo 预报' },
      { kind: 'openmeteo_daily_max', label: '某地某天最高气温（实测）', source: 'Open-Meteo 实测' },
    ],
  },
  {
    group: '彩票',
    hint: '按期号查，开奖后自动揭晓',
    items: [
      { kind: 'cwl_ssq_red_contains', label: '双色球某期红球含某个号', source: '福彩双色球开奖公告' },
      { kind: 'cwl_ssq_blue_odd', label: '双色球某期蓝球是奇数', source: '福彩双色球开奖公告' },
      { kind: 'cwl_ssq_blue_odd_forward', label: '双色球某期蓝球是奇数（未开奖）', source: '福彩双色球开奖公告' },
      { kind: 'dlt_draw_result', label: '大乐透某期开奖号码', source: '体彩大乐透开奖公告' },
    ],
  },
  {
    group: '文献',
    hint: '按作者／仓库等标识查',
    items: [
      { kind: 'crossref_week_total', label: '某一周新增了多少篇论文', source: 'Crossref 论文索引' },
      { kind: 'openalex_works_count', label: '某段时间新增了多少篇论文', source: 'OpenAlex 论文索引' },
      { kind: 'nvd_cve_week_count', label: '某一周披露了多少个漏洞', source: 'NVD 漏洞库' },
      { kind: 'github_weekly_commits', label: '某仓库某周提交数', source: 'GitHub 统计' },
      { kind: 'npm_downloads_window', label: '某个 npm 包某段时间的下载量', source: 'npm 下载统计' },
      { kind: 'wikimedia_pageviews', label: '某篇条目某天的浏览量', source: '维基媒体流量' },
    ],
  },
  {
    group: '能源电力',
    hint: '按国家／地区与能源类型查',
    items: [
      { kind: 'energycharts_daily_mean', label: '某国某类能源的日均值', source: 'Our World in Data 能源图表' },
      { kind: 'elexon_fuelhh_daily_mean', label: '英国某燃料的日均量', source: 'Elexon 电网数据' },
    ],
  },
  {
    group: '汇率',
    hint: '按货币对与日期查',
    items: [
      { kind: 'frankfurter_rate', label: '某货币对某天的汇率', source: 'Frankfurter（ECB 参考汇率）' },
      { kind: 'frankfurter_rate_range', label: '某货币对某一周的汇率区间', source: 'Frankfurter（ECB 参考汇率）' },
    ],
  },
  {
    group: '经济统计',
    hint: '按统计指标与年月查',
    items: [
      { kind: 'dbnomics_series_value', label: '某个经济指标某期的数值', source: 'DBnomics 各国统计局' },
    ],
  },
  {
    group: '环境与站点',
    hint: '按站点编号／日期查',
    items: [
      { kind: 'ghcn_daily_tmax', label: '某个气象站某天最高气温', source: 'GHCN 气象站实测' },
      { kind: 'usgs_nwis_daily_discharge', label: '某条河流某天的流量', source: 'USGS 水文站' },
      { kind: 'noaa_gml_co2_daily', label: '某天的大气二氧化碳浓度', source: 'NOAA 全球监测' },
    ],
  },
  {
    group: '交通与文体',
    hint: '按城市／日期查',
    items: [
      { kind: 'cta_daily_total_rides', label: '某城市某天的乘车量', source: '芝加哥交通局' },
      { kind: 'mlb_schedule_daily_total_runs', label: '某天棒球比赛的总得分', source: 'MLB 赛程' },
      { kind: 'bom_weekend_top10_gross', label: '某周末票房前十合计', source: 'Box Office Mojo' },
    ],
  },
  {
    group: '太空',
    hint: '按月份查',
    items: [
      { kind: 'jpl_cad_monthly_count', label: '某月小行星接近次数', source: 'JPL 近地天体名录' },
      { kind: 'swpc_solar_cycle_monthly', label: '某月太阳活动指数', source: 'NOAA 空间天气' },
    ],
  },
];

const INDEX = new Map<string, KindLabel>();
for (const g of KIND_GROUPS) for (const it of g.items) INDEX.set(it.kind, it);

/** 查一个人话标签；未收录时回退为**显式标注「未译」的原标识**（绝不静默丢弃）。 */
export function kindLabel(kind: string): KindLabel {
  return INDEX.get(kind) || { kind, label: kind + '（未译）', source: '见判据契约' };
}

/** 界面上是否还有裸标识（真值锚闸要用它）。 */
export function hasBareKindLabel(kind: string): boolean {
  return !INDEX.has(kind);
}
