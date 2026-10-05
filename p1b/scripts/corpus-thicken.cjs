#!/usr/bin/env node
'use strict';
/*
 * p1b/scripts/corpus-thicken.cjs —— **薄域补量**（C 线 · 2026-09-15）。
 *
 * 目标：阶段 4 分域读数显示 **21 个域 n<30**（不能拿数据说话）。本脚本**只补薄域**，
 *   用「已解但样本少」的域对应的 kind，铺**可机械结算**的前瞻题，把 n 养到 ≥30。
 *
 * 纪律（照既有 corpus-forward-* 先例 + 项目铁律）：
 *   · **Q0-2**：cutoff（created_at）**严格早于**事件日 ⇒ 题铺在**未来**（事件日 = 今天+N 天）；
 *   · **Q0-3**：阈值由历史分位挑选，**基率必须落 (0.15, 0.85)**，否则不产该题；
 *   · **真值锚**：每题带 `resolve` 参数（kind/url/field），且该 kind **必须有现役 resolver**（否则题永远不结）；
 *   · **零翻转**：只 **新增行**，不改任何既有行（幂等：slug 唯一键 ＋ 库内查重）；
 *   · **写库须 `--confirm`**；dry-run 为默认。
 *
 * 用法：node p1b/scripts/corpus-thicken.cjs [--confirm] [--only=<domain>] [--per=<n>] [--db <path>]
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const { db } = require(path.join(ROOT, 'p1b/src/deps'));
const { insertPrediction, l0Gate } = require(path.join(ROOT, 'p1b/src/db/predictionsStore'));

function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && process.argv[i + 1].slice(0, 2) !== '--' ? process.argv[i + 1] : d;
}
const CONFIRM = process.argv.includes('--confirm');
const ONLY = arg('only', null);
const PER = Number(arg('per', '12')) || 12;
const DB_ARG = arg('db', null);

// ── 候选留痕旁路（2026-09-22 · 承 corpus-sources-b4.cjs / role3-utype.cjs / calendar-questions.cjs 同款）──
// 为什么：本生成器在 **recipe 内部**（网络失败／历史不足／阈值算不出／不在基率带）直接 continue
//   ⇒ 被丢提议**零留痕** ⇒ 拿现成候选算出的永远是**构造性 100%**（过锚率的严格分母＝提议全集）。
// 纪律：**默认关** ⇒ 不传 `--record-candidates=<path>` 时**零行为变化**（不建数组、不写文件）。
const REC_PATH = (() => { const a = process.argv.find((x) => x.startsWith('--record-candidates=')); return a ? a.slice(20) : null; })();
const DROPS = [];
function recDrop(stage, reason, info) { if (!REC_PATH) return; DROPS.push(Object.assign({ stage: stage, reason: reason }, info || {})); }
// ★数据过滤（**不计入提议全集**）：源数据行的筛选（如 elexon 只要 WIND 燃料），
//   不是「本可成为候选但被丢的提议」⇒ 混入分母会严重失真（实测 elexon 6745 行 ⇒ 失真 1125 倍）。
const FILTERED = [];
function dataFilter(reason) { if (!REC_PATH) return; FILTERED.push({ reason: reason }); }

const LO = 0.15, HI = 0.85;
let dom_note_elexon = null;   // elexon 取数失败原因（如实上报）
const UA = 'corpus-thicken/1.0 (research; +node)';
const now08 = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).replace(' ', 'T') + '+08:00';
const RUN_AT = now08();
const TODAY = RUN_AT.slice(0, 10);
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
/**
 * 幂等键：语义 canonical key（照既有 corpus-forward-* 先例；predictions 表**无 slug 列**）。
 * 从 evidence[0].resolve 反解「源|标的|目标期|阈值」；已存在则本批不产（重跑/跨批均不重复入库）。
 */
function canonKey(r) {
  if (!r || typeof r !== "object") return null;
  // **不猜字段名**：对 resolve 做规范化 JSON（键排序 + 剔掉易变/非语义字段）后哈希。
  //   理由：各 recipe 的 resolve 字段名不统一（from/to、pkg、week_end…），硬编码映射必漏。
  const drop = new Set(["url", "field", "note", "cutoff"]);
  const keys = Object.keys(r).filter((k) => !drop.has(k)).sort();
  const norm = {};
  for (const k of keys) norm[k] = r[k];
  return JSON.stringify(norm);
}
/** 载入库内既有 canonical key（只读） */
function loadExist(conn) {
  const set = new Set();
  const rows = conn.prepare("SELECT evidence_json FROM predictions WHERE evidence_json LIKE ?").all("%thicken%");
  for (const row of rows) {
    try { const ev = JSON.parse(row.evidence_json); const r = ev && ev[0] && ev[0].resolve; const ck = canonKey(r); if (ck) set.add(ck); } catch (e) { /* ignore */ }
  }
  return set;
}
const inBand = (x) => x > LO && x < HI;

/**
 * 按主机决定是否经代理（本机 node fetch 默认**不走系统代理**；墙外源须显式设 env）。
 * 实测（2026-09-15）：kraken 直连 fetch failed，经代理 HTTP 200。
 * 用法：jget(url, headers, { viaProxy: true })。
 */
const http = require("http");
const https = require("https");
/**
 * 经系统代理（127.0.0.1:2080）取 JSON —— **自建 CONNECT 隧道**，零依赖。
 * 为何不用 env：实测 NODE_USE_ENV_PROXY 必须在**进程启动前**设置，运行时赋值无效（fetch failed）。
 * 用法：await jgetProxied(url, headers)。
 */
function jgetProxied(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: "127.0.0.1", port: 2080, method: "CONNECT", path: u.host + ":443" });
    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return reject(new Error("CONNECT " + res.statusCode)); }
      const r2 = https.request({ host: u.hostname, path: u.pathname + u.search, method: "GET", socket: socket, agent: false, headers: Object.assign({ "User-Agent": UA, Accept: "application/json" }, headers || {}) }, (r3) => {
        let b = ""; r3.on("data", (c) => { b += c; }); r3.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error("NON-JSON len=" + b.length)); } });
      });
      r2.on("error", reject); r2.end();
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(new Error("CONNECT timeout")); });
    req.end();
  });
}

async function jget(url, h) {
  for (let a = 0; a < 3; a++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: Object.assign({ 'User-Agent': UA, Accept: 'application/json, */*' }, h || {}) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const txt = await r.text();
      try { return JSON.parse(txt); } catch (e) { throw new Error('NON-JSON len=' + txt.length); }
    } catch (e) { if (a === 2) throw e; await sleep(1200 * (a + 1)); }
    finally { clearTimeout(t); }
  }
}
function quantile(a, p) { const s = a.slice().sort((x, y) => x - y); if (!s.length) return null; return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }

/**
 * 薄域 → 出题配方。每条给出：kind（须有现役 resolver）、取数（历史窗）、事件日（未来 N 天）、阈值候选分位。
 * **只列 n<30 的薄域**（阶段 4 分域读数清单）。
 *
 * ★2026-09-21 修（登记缺陷 `corpus-thicken.cjs:372`）：新增可选字段 `publishDays`＝该域的**发布日集合**
 *   （0=周日…6=周六）。缺省＝每天都有（不填即原行为，零回归）。**未过滤非发布日 ⇒ 生成「永远不会出数」
 *   的题**——与 frankfurter 19 条被预筛拦死同根：题面问「某日的数据」，而该日源根本不发布。
 *   现役只有 frankfurter 需要（ECB 参考汇率每工作日发布，周末不发）。
 */
const RECIPES = [
  {
    domain: 'wikimedia', kind: 'wikimedia_pageviews', layer: 'L2',
    // 每日 pageviews：取某热门条目近 60 天日浏览，预测未来某天是否 >= 分位阈值
    build: async (targetDate) => {
      const arts = ['Main_Page', 'Wikipedia', 'Python_(programming_language)', 'Artificial_intelligence', 'ChatGPT'];
      const out = [];
      for (const art of arts) {
        const end = TODAY;   // 历史窗终点＝今天（数据只到今天）
        const start = addDays(end, -60);
        const u = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/'
          + encodeURIComponent(art) + '/daily/' + start.replace(/-/g, '') + '/' + end.replace(/-/g, '');
        let j; try { j = await jget(u); } catch (e) { recDrop('recipe', 'fetch_fail', {}); continue; }
        const vals = (j.items || []).map((x) => x.views).filter((x) => typeof x === 'number');
        if (vals.length < 30) { recDrop('recipe', 'insufficient_history', {}); continue; }
        for (const q of [0.3, 0.5, 0.7]) {
          const th = quantile(vals, q);
          if (th === null) { recDrop('recipe', 'no_quantile', {}); continue; }
          const hit = vals.filter((x) => x >= th).length / vals.length;
          if (!inBand(hit)) { recDrop('recipe', 'out_of_band', {}); continue; }
          out.push({
            statement: '【forward】维基百科英文条目「' + art.replace(/_/g, ' ') + '」在 ' + targetDate
              + '（UTC）的日浏览量，是否 >= ' + th + ' 次？',
            base: hit, baseNote: '前瞻·维基百科：过去 ' + vals.length + ' 天中 >= ' + th + ' 占 ' + (hit * 100).toFixed(1) + '%（分位 q=' + q + '，pre-cutoff）',
            resolve: { kind: 'wikimedia_pageviews', article: art, date: targetDate, threshold: th, cmp: '>=', project: 'en.wikipedia', access: 'all-access', agent: 'user' },
            slug: 'corpus:thicken|wiki|' + art + '|' + targetDate + '|' + th,
          });
        }
        await sleep(700);
      }
      return out;
    },
  },
  {
    domain: 'kraken', kind: 'kraken_daily_close', layer: 'L2',
    build: async (targetDate) => {
      const pairs = [['XBTUSD', '比特币'], ['ETHUSD', '以太坊'], ['SOLUSD', 'Solana'], ['XRPUSD', 'XRP']];
      const out = [];
      for (const [pair, cn] of pairs) {
        // 近 90 天日收盘
        // ★ Kraken 是墙外源：本机直连 fetch failed ⇒ 走 CONNECT 隧道（自建，零依赖）
        let j; try { j = await jgetProxied('https://api.kraken.com/0/public/OHLC?pair=' + pair + '&interval=1440'); } catch (e) { recDrop('recipe', 'fetch_fail', {}); continue; }
        const key = Object.keys(j.result || {}).find((k) => k !== 'last');
        const rows = (j.result && key && j.result[key]) || [];
        const closes = rows.map((r) => Number(r[4])).filter((x) => isFinite(x));
        if (closes.length < 30) { recDrop('recipe', 'insufficient_history', {}); continue; }
        for (const q of [0.3, 0.5, 0.7]) {
          const th = quantile(closes, q);
          if (th === null) { recDrop('recipe', 'no_quantile', {}); continue; }
          const hit = closes.filter((x) => x >= th).length / closes.length;
          if (!inBand(hit)) { recDrop('recipe', 'out_of_band', {}); continue; }
          out.push({
            statement: '【forward】Kraken ' + pair + '（' + cn + '）在 ' + targetDate + '（UTC）的日收盘价，是否 >= ' + th.toFixed(2) + ' 美元？',
            base: hit, baseNote: '前瞻·Kraken：过去 ' + closes.length + ' 个交易日中 >= ' + th.toFixed(2) + ' 占 ' + (hit * 100).toFixed(1) + '%（分位 q=' + q + '，pre-cutoff）',
            resolve: { kind: 'kraken_daily_close', pair: pair, date: targetDate, threshold: th, cmp: '>=' },
            slug: 'corpus:thicken|kraken|' + pair + '|' + targetDate + '|' + th.toFixed(2),
          });
        }
        await sleep(900);
      }
      return out;
    },
  },
  {
    domain: 'frankfurter', kind: 'frankfurter_rate_range', layer: 'L2',
    publishDays: [1, 2, 3, 4, 5], // ★ECB 参考汇率每工作日发布（周末不发）——见本文件 RECIPES 头注
    build: async (targetDate) => {
      const pairs = [['USD', 'CNY'], ['USD', 'JPY'], ['USD', 'GBP'], ['EUR', 'USD']];
      const out = [];
      for (const [a, b] of pairs) {
        const end = TODAY, start = addDays(end, -90);
        let j; try { j = await jget('https://api.frankfurter.app/' + start + '..' + end + '?from=' + a + '&to=' + b); } catch (e) { recDrop('recipe', 'fetch_fail', {}); continue; }
        const vals = Object.values(j.rates || {}).map((r) => r[b]).filter((x) => typeof x === 'number');
        if (vals.length < 30) { recDrop('recipe', 'insufficient_history', {}); continue; }
        for (const q of [0.3, 0.7]) {
          const th = quantile(vals, q);
          if (th === null) { recDrop('recipe', 'no_quantile', {}); continue; }
          const ge = q >= 0.5;
          const hit = vals.filter((x) => (ge ? x >= th : x <= th)).length / vals.length;
          if (!inBand(hit)) { recDrop('recipe', 'out_of_band', {}); continue; }
          out.push({
            statement: '【forward】' + targetDate + ' 欧元区 ECB 参考汇率 ' + a + '/' + b + '，是否 ' + (ge ? '>=' : '<=') + ' ' + th.toFixed(4) + '？',
            base: hit, baseNote: '前瞻·汇率：过去 ' + vals.length + ' 个交易日中 ' + (ge ? '>=' : '<=') + ' ' + th.toFixed(4) + ' 占 ' + (hit * 100).toFixed(1) + '%（分位 q=' + q + '，pre-cutoff）',
            resolve: { kind: 'frankfurter_rate_range', from: a, to: b, date: targetDate, threshold: th, cmp: ge ? '>=' : '<=' },
            slug: 'corpus:thicken|fx|' + a + b + '|' + targetDate + '|' + th.toFixed(4),
          });
        }
        await sleep(600);
      }
      return out;
    },
  },
  {
    domain: 'npm', kind: 'npm_downloads_window', layer: 'L2',
    build: async (targetDate) => {
      const pkgs = ['react', 'vue', 'express', 'typescript', 'lodash'];
      const out = [];
      const end = TODAY, start = addDays(end, -27);
      for (const p of pkgs) {
        let j; try { j = await jget('https://api.npmjs.org/downloads/range/' + start + ':' + end + '/' + p); } catch (e) { recDrop('recipe', 'fetch_fail', {}); continue; }
        const vals = (j.downloads || []).map((x) => x.downloads).filter((x) => typeof x === 'number');
        if (vals.length < 20) { recDrop('recipe', 'insufficient_history', {}); continue; }
        // 预测「目标日单日下载量 >= 近 4 周日均」
        const daily = vals.reduce((s, x) => s + x, 0) / vals.length;
        const th = Math.round(daily);
        const hit = vals.filter((x) => x >= th).length / vals.length;
        if (!inBand(hit)) { recDrop('recipe', 'out_of_band', {}); continue; }
        out.push({
          statement: '【forward】npm 包「' + p + '」在 ' + targetDate + '（UTC）的单日下载量，是否 >= ' + th + ' 次？',
          base: hit, baseNote: '前瞻·npm：过去 ' + vals.length + ' 天中 >= ' + th + '（4周日均）占 ' + (hit * 100).toFixed(1) + '%（pre-cutoff）',
          resolve: { kind: 'npm_downloads_window', pkg: p, date: targetDate, threshold: th, cmp: '>=' },
          slug: 'corpus:thicken|npm|' + p + '|' + targetDate + '|' + th,
        });
        await sleep(600);
      }
      return out;
    },
  },
  {
    domain: 'github', kind: 'github_weekly_commits', layer: 'L2',
    build: async (targetDate) => {
      const repos = ['nodejs/node', 'microsoft/vscode', 'facebook/react', 'torvalds/linux', 'python/cpython'];
      const out = [];
      const weekEnd = addDays(targetDate, 6);   // 周窗：目标日 .. +6
      for (const r of repos) {
        let j; try { j = await jget('https://api.github.com/repos/' + r + '/stats/participation'); } catch (e) { recDrop('recipe', 'fetch_fail', {}); continue; }   // 周历史（含至今）
        const all = (j.all || []).filter((x) => typeof x === 'number');
        if (all.length < 20) { recDrop('recipe', 'insufficient_history', {}); continue; }
        for (const q of [0.3, 0.7]) {
          const th = quantile(all, q);
          if (th === null) { recDrop('recipe', 'no_quantile', {}); continue; }
          const ge = q >= 0.5;
          const hit = all.filter((x) => (ge ? x >= th : x <= th)).length / all.length;
          if (!inBand(hit)) { recDrop('recipe', 'out_of_band', {}); continue; }
          out.push({
            statement: '【forward】GitHub 仓库 ' + r + ' 在周窗 ' + targetDate + '~' + weekEnd + ' 的提交数，是否 ' + (ge ? '>=' : '<=') + ' ' + th + ' 次？',
            base: hit, baseNote: '前瞻·GitHub：过去 ' + all.length + ' 周中 ' + (ge ? '>=' : '<=') + ' ' + th + ' 占 ' + (hit * 100).toFixed(1) + '%（分位 q=' + q + '，pre-cutoff）',
            resolve: { kind: 'github_weekly_commits', repo: r, week_end: weekEnd, threshold: th, cmp: ge ? '>=' : '<=' },
            slug: 'corpus:thicken|gh|' + r + '|' + targetDate + '|' + th,
          });
        }
        await sleep(900);
      }
      return out;
    },
  },
  {
    domain: 'mlb', kind: 'mlb_schedule_daily_total_runs', layer: 'L2',
    build: async (targetDate) => {
      const out = [];
      let j; try { j = await jget('https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=' + addDays(TODAY, -1)); } catch (e) { return out; }
      const games = ((j.dates || [])[0] || {}).games || [];
      const total = games.reduce((s, g) => s + ((g.teams && g.teams.away && g.teams.away.score) || 0) + ((g.teams && g.teams.home && g.teams.home.score) || 0), 0);
      const nGames = games.length;
      if (!nGames) return out;
      const perGame = total / nGames;
      const th = Math.round(perGame * nGames);
      out.push({
        statement: '【forward】MLB ' + targetDate + ' 全部 ' + nGames + ' 场比赛的总得分，是否 >= ' + th + ' 分？',
        base: 0.5, baseNote: '前瞻·MLB：近一场 ' + nGames + ' 场总得分=' + total + '，以均值为阈值（基线 50%，pre-cutoff）',
        resolve: { kind: 'mlb_schedule_daily_total_runs', date: targetDate, threshold: th, cmp: '>=' },
        slug: 'corpus:thicken|mlb|' + targetDate + '|' + th,
      });
      return out;
    },
  },
  {
    domain: 'crossref', kind: 'crossref_week_total', layer: 'L2',
    build: async (targetDate) => {
      const weekEnd = addDays(targetDate, 6);
      const out = [];
      let j; try { j = await jget('https://api.crossref.org/works?rows=0&filter=from-created-date:' + addDays(TODAY, -30) + ',until-created-date:' + addDays(TODAY, -1)); } catch (e) { return out; }
      const total = (j.message && j.message['total-results']) || 0;
      if (!total) return out;
      const th = Math.round(total / 30 * 7);
      out.push({
        statement: '【forward】Crossref 在周窗 ' + targetDate + '~' + weekEnd + ' 新增登记的作品数，是否 >= ' + th + ' 条？',
        base: 0.5, baseNote: '前瞻·Crossref：近 30 天共 ' + total + ' 条，按日均折算周阈值 ' + th + '（基线 50%，pre-cutoff）',
        resolve: { kind: 'crossref_week_total', week_start: targetDate, week_end: weekEnd, threshold: th, cmp: '>=' },
        slug: 'corpus:thicken|crossref|' + targetDate + '|' + th,
      });
      return out;
    },
  },
  {
    domain: 'nvd', kind: 'nvd_cve_week_count', layer: 'L2',
    build: async (targetDate) => {
      const weekEnd = addDays(targetDate, 6);
      const out = [];
      let j; try { j = await jget('https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=1&pubStartDate=' + addDays(TODAY, -30) + 'T00:00:00.000&pubEndDate=' + addDays(TODAY, -1) + 'T00:00:00.000'); } catch (e) { return out; }
      const total = j.totalResults || 0;
      if (!total) return out;
      const th = Math.round(total / 30 * 7);
      out.push({
        statement: '【forward】NVD 在周窗 ' + targetDate + '~' + weekEnd + ' 新增发布的 CVE 数，是否 >= ' + th + ' 条？',
        base: 0.5, baseNote: '前瞻·NVD：近 30 天共 ' + total + ' 条，按日均折算周阈值 ' + th + '（基线 50%，pre-cutoff）',
        resolve: { kind: 'nvd_cve_week_count', week_start: targetDate, week_end: weekEnd, threshold: th, cmp: '>=' },
        slug: 'corpus:thicken|nvd|' + targetDate + '|' + th,
      });
      return out;
    },
  },
  {
    domain: 'elexon', kind: 'elexon_fuelhh_daily_mean', layer: 'L2',
    build: async (targetDate) => {
      const out = [];
      // ★ 缓存：elexon 端点对连续请求敏感 ⇒ 整个 recipe 生命周期内**只拉一次**（三档 targetDate 共用）
      if (!global.__elexonCache) {
        const d = TODAY;
        // ★ 实测：该端点**跨度 >7 天返回 0 行**（5/7 天正常，10 天即 0）⇒ 窗收敛为 7 天。
        const u = "https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELHH?format=json&settlementDateFrom=" + addDays(d, -7) + "&settlementDateTo=" + d;
        let j = null, lastErr = null;
        for (let a = 1; a <= 4; a++) {
          try { j = await jgetProxied(u); if (j && j.data && j.data.length) break; lastErr = new Error("data 空"); }
          catch (e) { lastErr = e; }
          console.log("  elexon 取数第 " + a + " 次未成，退避 " + (3 * a) + "s");
          await sleep(3000 * a);
        }
        if (!j || !j.data || !j.data.length) { dom_note_elexon = String(lastErr && lastErr.message); global.__elexonCache = { daily: [] }; }
        else {
          const byDay = {};
          for (const r of j.data) {
            if (String(r.fuelType) !== "WIND") { dataFilter('not_wind_fuel'); continue; }
            const k = String(r.settlementDate || "").slice(0, 10);
            const v = Number(r.generation);
            if (!k || !isFinite(v)) { dataFilter('invalid_sample'); continue; }
            (byDay[k] = byDay[k] || []).push(v);
          }
          const daily = Object.values(byDay).map((a) => a.reduce((x, y) => x + y, 0) / a.length).filter((x) => isFinite(x));
          global.__elexonCache = { daily: daily };
          console.log("  elexon 缓存：" + daily.length + " 天 WIND 日均");
        }
      }
      const daily = global.__elexonCache.daily;
      if (daily.length < 5) return out;   // 7 天窗 ⇒ 最多 7 个点
      const d = TODAY;
      // （取数已在缓存块完成；口径＝WIND 日均 MW，照既有 resolver）
      for (const q of [0.3, 0.7]) {
        const th = quantile(daily, q);
        if (th === null) { recDrop('recipe', 'no_quantile', {}); continue; }
        const ge = q >= 0.5;
        const hit = daily.filter((x) => (ge ? x >= th : x <= th)).length / daily.length;
        if (!inBand(hit)) { recDrop('recipe', 'out_of_band', {}); continue; }
        out.push({
          statement: '【forward】英国 Elexon 电力系统 ' + targetDate + ' 的日均发电量，是否 ' + (ge ? '>=' : '<=') + ' ' + th.toFixed(0) + ' MWh？',
          base: hit, baseNote: '前瞻·Elexon：过去 ' + daily.length + ' 天中 ' + (ge ? '>=' : '<=') + ' ' + th.toFixed(0) + ' 占 ' + (hit * 100).toFixed(1) + '%（分位 q=' + q + '，pre-cutoff）',
          resolve: { kind: 'elexon_fuelhh_daily_mean', fuel: 'WIND', date: targetDate, threshold: th, cmp: ge ? '>=' : '<=',
            url_template: 'https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELHH?format=json&settlementDateFrom={date}&settlementDateTo={date_plus1}' },
          slug: 'corpus:thicken|elexon|' + targetDate + '|' + th.toFixed(0),
        });
      }
      return out;
    },
  },
];

(async () => {
  const t0 = Date.now();
  const report = { run_at: RUN_AT, today: TODAY, confirm: CONFIRM, per_domain: PER, domains: [], total_new: 0, total_skip: 0, dry_run: !CONFIRM };

  // 目标事件日：未来 3 / 5 / 7 天（确保 cutoff 早于事件日，Q0-2）
  // ★2026-09-21 修：按域 `publishDays` 过滤——**非发布日生成的题永远取不到数**（登记缺陷）
  const targetDates = [addDays(TODAY, 3), addDays(TODAY, 5), addDays(TODAY, 7)];
  const dow = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();

  if (DB_ARG) process.env.P1B_DB_PATH = DB_ARG;
  db.init(DB_ARG || undefined);
  const conn = db.getConnection();

  for (const rc of RECIPES) {
    if (ONLY && rc.domain !== ONLY) continue;
    const dom = { domain: rc.domain, kind: rc.kind, layer: rc.layer, generated: 0, inserted: 0, skipped_dup: 0, skipped_band: 0, errors: [] };
    // ★上限前置（2026-09-21 修）：**先判上限再生成**——原顺序是「先生成（打网络）后判上限」
    //   ⇒ 已满的域白跑一轮网络（实测 frankfurter 已满仍生成 16 条、耗时 12.5s 后丢弃）。
    const DOMAIN_CAP = Number(arg("cap", "30")) || 30;
    const haveN = conn.prepare(
      "SELECT COUNT(*) c FROM predictions WHERE layer IN ('L2','L3') AND evidence_json LIKE ?"
    ).get("%\"kind\":\"" + rc.kind + "\"%").c;
    if (haveN >= DOMAIN_CAP) {
      dom.capped = true; dom.have = haveN;
      console.log("[" + rc.domain + "] 已达上限 " + haveN + "/" + DOMAIN_CAP + " ⇒ 本域跳过");
      report.domains.push(dom);
      continue;
    }
    // ★发布日过滤（未声明 publishDays 的域＝每日都有，零回归）
    const domDates = rc.publishDays
      ? targetDates.filter((td) => { const ok = rc.publishDays.indexOf(dow(td)) !== -1; if (!ok) dom.skipped_nonpublish = (dom.skipped_nonpublish || 0) + 1; return ok; })
      : targetDates;
    if (rc.publishDays && domDates.length === 0) dom.note_nonpublish = '三个目标日全为非发布日 ⇒ 本域本轮零出题（避免生成不可解题）';
    let cands = [];
    for (const td of domDates) {
      try { cands = cands.concat(await rc.build(td)); } catch (e) { dom.errors.push(td + ': ' + e.message); }
    }
    dom.generated = cands.length;
    // 幂等：按 canonical key 查重（predictions 无 slug 列）
    const existing = loadExist(conn);
    const need = Math.min(PER, DOMAIN_CAP - haveN);   // 只补差额
    dom.have_before = haveN;
    dom.need = need;
    const picked = [];
    for (const c of cands) {
      if (picked.length >= need) break;
      const ck = canonKey(c.resolve);
      if (ck && existing.has(ck)) { dom.skipped_dup++; continue; }
      if (!inBand(c.base)) { dom.skipped_band++; continue; }
      if (ck) existing.add(ck);   // 同批内也去重
      picked.push(c);
    }
    dom.picked = picked.length;
    if (CONFIRM) {
      for (const c of picked) {
        try {
          const ev = [{
            resolve: c.resolve,
            baseRateNote: c.baseNote,
            baseRate: { p: c.base, n: null, k: null, kind: 'empirical', window: null, basis: null, cmp: null, threshold: null, schema: 'evidence.baseRate.v1' },
            meta: { phase: 'forward', cutoff: RUN_AT, thicken: true },
            phase: 'forward', kind: 'thicken',
          }];
          // 用既有 corpus 容器局（与 corpus-forward-* 同模式）
          const g = conn.prepare("SELECT id FROM games WHERE game_type = ?").get('corpus:' + rc.domain);
          let gid = g ? g.id : null;
          if (!gid) {
            // 照既有 corpus 局形状：player_count=1（合成局·非对局）、source='corpus'（均 NOT NULL）
            const info = conn.prepare('INSERT INTO games (game_type, name, player_count, created_at, source) VALUES (?,?,?,?,?)')
              .run('corpus:' + rc.domain, '语料库·' + rc.domain + '（合成局·非对局）', 1, RUN_AT, 'corpus');
            gid = Number(info.lastInsertRowid);
          }
          const gate = l0Gate({ statement: c.statement, evidence: ev, layer: rc.layer });
          if (gate && gate.ok === false) { dom.errors.push('l0Gate 拒收: ' + JSON.stringify(gate).slice(0, 120)); continue; }
          // insertPrediction 入参是 **camelCase**（照 predictionsStore API）：sourceType/prob/maturesAt
          insertPrediction({
            gameId: gid, day: 1, sourceType: '预测卡', statement: c.statement,
            prob: c.base, evidence: ev, layer: rc.layer,
            maturesAt: c.resolve.date || c.resolve.week_end || c.resolve.week_start,
            g2Regime: 'R4',
          });
          dom.inserted++;
        } catch (e) { dom.errors.push((canonKey(c.resolve) || '?') + ': ' + e.message); }
      }
    }
    report.domains.push(dom);
    report.total_new += dom.inserted;
    report.total_skip += dom.skipped_dup;
    console.log('[' + rc.domain + '] 候选 ' + dom.generated + ' | 选中 ' + dom.picked + ' | 写入 ' + dom.inserted + ' | 查重跳过 ' + dom.skipped_dup + (dom.errors.length ? (' | 错误 ' + dom.errors.length) : ''));
    if (dom.errors.length) dom.errors.slice(0, 3).forEach((e) => console.log('    ! ' + e));
  }

  db.closeCurrent && db.closeCurrent();
  const p = path.join(ROOT, '.run-out', 'backtest', 'thicken-report-' + TODAY + '.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(report, null, 1), 'utf8');
  console.log('');
  console.log('== 薄域补量 ' + (CONFIRM ? '（已写库）' : '（DRY-RUN，未写库）') + ' ==');
  console.log('  新增 ' + report.total_new + ' 条 | 查重跳过 ' + report.total_skip + ' 条');
  console.log('  产物 ' + p);
  // ── 候选留痕落盘（默认关；仅当传 --record-candidates=<path>）──
  if (REC_PATH) {
    const dropByReason = {};
    for (const dz of DROPS) dropByReason[dz.reason] = (dropByReason[dz.reason] || 0) + 1;
    // 提议全集＝已产出的候选（各域 dom.generated 之和）＋ 被丢（DROPS）
    const candTotal = report.domains.reduce((s, d) => s + (d.generated || 0), 0);
    fs.writeFileSync(REC_PATH, JSON.stringify({
      run_at: RUN_AT, source: 'corpus-thicken.cjs', today: TODAY, confirm: CONFIRM,
      note: '候选留痕旁路产物（承 corpus-sources-b4.cjs / role3-utype.cjs / calendar-questions.cjs 同款）：'
        + 'drops＝被丢提议（含原因）。过锚率的严格分母＝候选 ＋ drops（提议全集）。'
        + '★注意：本生成器的 drops 是**recipe 内条目级**（逐标的/逐对/逐条目被丢），非整题级；'
        + '且 candidates 只给计数（明细见 thicken-report 产物），因本脚本的主产物是 report 而非候选数组。',
      counts: {
        candidates_generated: candTotal,
        drops: DROPS.length,
        proposed_total: candTotal + DROPS.length,
        drop_by_reason: dropByReason,
        data_filtered: FILTERED.length,
        data_filtered_by_reason: (() => { const o = {}; for (const f of FILTERED) o[f.reason] = (o[f.reason] || 0) + 1; return o; })(),
      },
      drops: DROPS,
      report_file: p,
    }, null, 1), 'utf8');
    console.log('[record] 候选留痕 -> ' + REC_PATH + '（候选 ' + candTotal + ' ＋ 被丢 ' + DROPS.length + ' ＝ 提议全集 ' + (candTotal + DROPS.length) + '）');
    console.log('[record] 被丢按原因 ' + JSON.stringify(dropByReason));
  }
  console.log('  用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
