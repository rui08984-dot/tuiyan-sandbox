
// ── 取数稳健层：瞬时失败重试（最终失败仍按现役口径跳过不写，重试只为降噪）──
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = /HTTP (400|403|404|429|5\d\d)|fetch failed|abort|socket hang up|ETIMEDOUT/i;
async function fetchRetry(fn, tries, tag) {
  const n = Math.max(1, tries || 3); let last = null;
  for (let i = 0; i < n; i++) {
    try { return await fn(); }
    catch (e) {
      last = e; const m = String((e && e.message) || '');
      if (i + 1 < n && RETRYABLE.test(m)) { await SLEEP(1000 + i * 2000 + Math.floor(Math.random() * 500)); continue; }
      throw e;
    }
  }
  throw last;
}
/** 并发池：并发数可控，用于对反爬源（cwl/dlt/wikimedia/github/air-quality）限速 */
async function pool(items, limit, fn) {
  const q = items.slice(); const n = Math.max(1, limit || 4);
  await Promise.all(Array.from({ length: n }, async () => { for (;;) { const it = q.shift(); if (!it) return; await fn(it); } }));
}
