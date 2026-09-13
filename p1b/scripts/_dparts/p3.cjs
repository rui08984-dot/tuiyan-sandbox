
const FETCH_MS = 30000;
const UA_DEFAULT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
let getJson = async function getJson(url, headers) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: Object.assign({ 'User-Agent': UA_DEFAULT, Accept: 'application/json, text/plain, */*' }, headers || {}) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
};
const dateOf = (s) => String(s || '').slice(0, 10);
const isFuture = (d) => !!d && dateOf(d) > today();
function cmpOk(v, cmp, thr) {
  const a = Number(v), b = Number(thr);
  if (!isFinite(a) || !isFinite(b)) return null;
  if (cmp === '>=') return a >= b; if (cmp === '<=') return a <= b;
  if (cmp === '>') return a > b; if (cmp === '<') return a < b;
  return null;
}
// ── 复用现有 resolve 能力：只读抽取 corpus-resolve.cjs 的 RESOLVERS（不改该文件）──
// 注入 __GETJSON_CACHE 钩子：同 URL 在同一轮内只打一次网（cwl/dlt 同题多注、反爬源限速友好）。
let BASE = null, LOAD_MODE = '', ROUND_CACHE = null, roundApiHits = 0;
function cachedGet(url, headers) {
  if (!ROUND_CACHE) return getJson(url, headers);
  const key = url + '|' + JSON.stringify(headers || {});
  if (ROUND_CACHE.has(key)) return ROUND_CACHE.get(key);
  roundApiHits++;
  const p = getJson(url, headers);
  ROUND_CACHE.set(key, p);
  p.catch(() => { if (ROUND_CACHE.get(key) === p) ROUND_CACHE.delete(key); });   // 失败不入缓存，便于重试
  return p;
}
function loadBase() {
  try {
    const src = fs.readFileSync(RESOLVE_SRC, 'utf8');
    const i = src.indexOf('//RESOLVE-B2');   // 锚点：位于 main() 之前，切掉 main 与其 I/O
    if (i < 0) throw new Error('anchor //RESOLVE-B2 missing');
    const mod = { exports: {} };
    let body = src.slice(0, i);
    const hook = 'async function getJson(url, headers) {';
    if (body.indexOf(hook) === -1) throw new Error('getJson definition not found');
    body = body.replace(hook, hook + ' if (typeof __GETJSON_CACHE === "function") { return __GETJSON_CACHE(url, headers); }');
    body += '\nmodule.exports = { RESOLVERS: RESOLVERS, getJson: getJson };';
    new Function('module', 'exports', 'require', '__dirname', '__GETJSON_CACHE', body)(mod, mod.exports, require, __dirname, cachedGet);
    if (!mod.exports.RESOLVERS || typeof mod.exports.getJson !== 'function') throw new Error('extracted shape invalid');
    BASE = mod.exports.RESOLVERS; LOAD_MODE = 'inline-extract(' + Object.keys(BASE).length + ' kinds)';
  } catch (e) { BASE = null; LOAD_MODE = 'spawn-fallback: ' + e.message; }
  return LOAD_MODE;
}
