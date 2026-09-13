
// ── 日历锚：期号→开奖日（cwl 周二/四/日；dlt 周一/三/六）。启动时用官方列表刷新最新期/日 ──
const SSQ_DOW = [0, 2, 4], DLT_DOW = [1, 3, 6];
const CALS = {
  cwl: { latestCode: '2026105', latestDate: '2026-09-10', dows: SSQ_DOW },
  dlt: { latestCode: '26104', latestDate: '2026-09-12', dows: DLT_DOW },
};
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dow(iso) { return new Date(iso + 'T00:00:00Z').getUTCDay(); }
function nextDraw(iso, dows) { let d = addDays(iso, 1), g = 0; while (dows.indexOf(dow(d)) === -1 && g++ < 10) d = addDays(d, 1); return d; }
/** 从 cal.latestCode/latestDate 按期号节奏推进到 issue，返回开奖日；期号长度不符或回推失败返回 null */
function inferIssue(issue, cal) {
  const target = String(issue);
  let code = String(cal.latestCode), date = cal.latestDate, g = 0;
  if (target.length !== code.length) return null;
  while (Number(code) < Number(target) && g++ < 400) { date = nextDraw(date, cal.dows); code = String(Number(code) + 1); }
  return code === target ? date : null;
}
function monthEndPlusOne(ym) { const y = Number(String(ym).slice(0, 4)), mo = Number(String(ym).slice(5, 7)); return mo === 12 ? (y + 1) + '-01-01' : y + '-' + String(mo + 1).padStart(2, '0') + '-01'; }
/** 到期时间（证据优先、期号推断兜底）；返回 {due, src}，推断不出 due=null/src='undatable' */
function dueOf(e0) {
  const r = (e0 && e0.resolve) || {};
  let m = {}; try { m = JSON.parse(e0.meta || '{}'); } catch (e) { m = {}; }
  const k = String(r.kind || '');
  if (m.expectDate) return { due: m.expectDate, src: 'meta.expectDate' };
  if (m.eventDate) return { due: m.eventDate, src: 'meta.eventDate' };
  if (r.date) return { due: r.date, src: 'resolve.date' };
  if (r.period) return { due: monthEndPlusOne(r.period), src: 'period+1mo' };
  if (r.month) return { due: monthEndPlusOne(r.month), src: 'month+1mo' };
  if (m.expectMonth) return { due: m.expectMonth + '-01', src: 'meta.expectMonth' };
  if (r.week_end && k === 'github_weekly_commits') return { due: addDays(r.week_end, 1), src: 'week_end+1d' };
  if (r.end && k === 'npm_downloads_window') return { due: addDays(r.end, 1), src: 'end+1d' };
  if (k.indexOf('cwl') === 0 && r.issue) return { due: inferIssue(r.issue, CALS.cwl), src: 'infer:ssq' };
  if (k === 'dlt_draw_result' && r.issue) return { due: inferIssue(r.issue, CALS.dlt), src: 'infer:dlt' };
  return { due: null, src: 'undatable' };
}
