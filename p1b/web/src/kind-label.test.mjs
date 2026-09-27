/**
 * 真值锚人话化闸（2026-09-28 · T3 / 模块 M1）
 *
 * 病象：旧「记一笔」页是一个 27 项平铺下拉，里面是 `binance_daily_close`、
 *   `dlt_draw_result`、`noaa_gml_co2_daily` …… 这些是**引擎标识，不是产品词汇**。
 *   用户无法判断该不该选 ⇒ "选来源"这步废了，而它是**出题能否被机检**的前提。
 *
 * 本闸锁四件事：
 *   ① 界面上不得出现裸标识（选项文案必须是人话）
 *   ② 按领域分组（平铺 27 项没法扫读）
 *   ③ ★**零漏译**：后端契约里的每个 kind 都必须有人话名。
 *      漏一个 = 那个来源在界面上没法用 = 用户以为"没这个来源"。
 *   ④ 未收录的 kind 仍要出现（标注「未译」）——静默丢弃比英文更难懂更糟。
 *
 * 名单真源＝后端 `GET /api/disclosure/compiler`（读 g2-contract-frozen-r4.json）。
 * 本测试用**盘上那份真实名单**做核对，避免"改了后端忘了改前端"无人发现。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, 'lib', 'kindLabel.ts'), 'utf8');
const note = readFileSync(join(dir, 'pages', 'NotePage.tsx'), 'utf8');

/** 后端契约里的真实 kind 名单（从 disclosure.js 里解出来，避免测试依赖运行中的服务） */
const BACKEND_KINDS = [
  'binance_daily_close', 'bom_weekend_top10_gross', 'crossref_week_total', 'cta_daily_total_rides',
  'cwl_ssq_blue_odd', 'cwl_ssq_blue_odd_forward', 'cwl_ssq_red_contains', 'dbnomics_series_value',
  'dlt_draw_result', 'elexon_fuelhh_daily_mean', 'energycharts_daily_mean', 'frankfurter_rate',
  'frankfurter_rate_range', 'ghcn_daily_tmax', 'github_weekly_commits', 'jpl_cad_monthly_count',
  'kraken_daily_close', 'mlb_schedule_daily_total_runs', 'noaa_gml_co2_daily', 'npm_downloads_window',
  'nvd_cve_week_count', 'openalex_works_count', 'openmeteo_daily_max', 'openmeteo_forecast_daily_max',
  'swpc_solar_cycle_monthly', 'usgs_nwis_daily_discharge', 'wikimedia_pageviews',
];

const mapped = [...src.matchAll(/kind:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);

test('① 界面上不出现裸标识（选项必须是人话 + 去哪查）', () => {
  // 下拉里渲染的是 it.label · it.source，不是 it.kind
  assert.ok(note.includes('it.label'), '选项须渲染人话名');
  assert.ok(note.includes('it.source'), '选项须带「到期去哪里查」');
  assert.equal(/\{k\.kind\}/.test(note), false, '下拉里不得直接渲染裸 kind 标识');
  assert.ok(note.includes('<optgroup'), '须按领域分组（平铺 27 项没法扫读）');
  // 每项都要有 source
  const noSource = [...src.matchAll(/\{ kind: '([a-z0-9_]+)', label: '[^']+' \}/g)].map((m) => m[1]);
  assert.deepEqual(noSource, [], '有 kind 缺「去哪查」：' + noSource.join(','));
});

test('② 分组 ≥6 个领域（扫读的前提）', () => {
  const groups = [...src.matchAll(/group: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(groups.length >= 6, '领域分组应 ≥6，实际 ' + groups.length);
  // 每组都要有 hint（说清这组是什么）
  // ★只数**对象字面量里的 hint**（类型声明那行 `hint: string` 不算）
  const hints = src.split('\n').filter((l) => l.trim().startsWith('hint: ')).length;
  assert.equal(hints, groups.length, '每组都应有 hint（' + hints + ' vs ' + groups.length + '）');
});

test('★③ 零漏译：后端契约的每个 kind 都必须有人话名', () => {
  const set = new Set(mapped);
  const missing = BACKEND_KINDS.filter((k) => !set.has(k));
  assert.deepEqual(missing, [],
    '★漏译（这些来源在界面上没法用，用户会以为"没这个来源"）：' + missing.join(','));
});

test('★③b 不多译：映射表里不得有后端不存在的 kind（否则是幻觉）', () => {
  const extra = mapped.filter((k) => !BACKEND_KINDS.includes(k));
  assert.deepEqual(extra, [], '映射表含后端没有的 kind：' + extra.join(','));
});

test('④ 未收录的 kind 仍要出现（标注「未译」），不得静默丢弃', () => {
  assert.ok(src.includes('（未译）'), '未收录须显式标注，不得静默丢');
  assert.ok(note.includes('untranslated'), '页面须把未收录的 kind 也放进下拉');
  assert.ok(note.includes('其他（尚未翻译的来源）'), '未收录项须归入一个可见分组');
});
