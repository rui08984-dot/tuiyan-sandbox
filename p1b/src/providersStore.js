'use strict';
/**
 * p1b/src/providersStore.js —— 供应商配置读写（P1B-SPEC §1/§2.4）。
 * 安全铁律：
 *  - 配置文件与终端共用 p1a-terminal/config/providers.json（读写都在服务端，key 永不出服务端）；
 *  - 所有对 HTTP 输出的形状经 toPublic() 脱敏：只回 label/base_url/model/掩码指示，绝不回 api_key；
 *  - PUT 语义 = upsert（key 不存在即新建）；api_key 留空/缺省 = 保留服务端现有值；
 *  - 写入原子化（tmp + rename），保留未涉及的既有字段（context_window/max_tokens 等）。
 * 测试注入：configPath（或 env P1B_PROVIDERS_PATH）——测试必须指向临时文件，绝不碰真实配置。
 */
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { httpError } = require('./util');

const DEFAULT_PATH = path.join(__dirname, '..', '..', 'p1a-terminal', 'config', 'providers.json');
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ════════════════════════════════════════════════════════════════════
// P0-2 出口守卫：base_url 指向哪里，决定了真密钥会被送到哪里。
//
// 为什么放在 store 层而不是路由层：路由层能被绕过（直接调 store、直接手改
// providers.json），而「出站前必须过一遍」这件事必须钉在**唯一真正发请求的
// 那条路**（testProvider 的 fetch）上，写入层再叠一道做纵深。
//
// 为什么用 WHATWG URL 解析器判主机：它自己就把 2130706433 / 0x7f000001 /
// 0177.0.0.1 / ①②⑦.0.0.1 全都归一成 127.0.0.1（实测见 p0-ssrf-credleak 备注），
// 不用自己写一套八进制/十六进制/unicode 数字的还原逻辑——那是最容易写漏的地方。
// ════════════════════════════════════════════════════════════════════

/** IPv4 段位判定：命中即返回人话原因，不命中返回 null */
function blockedIpv4(ip) {
  const p = ip.split('.').map((n) => parseInt(n, 10));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return '不是合法 IPv4';
  const [a, b] = p;
  if (a === 0) return '0.0.0.0/8（本网络/未指定）';
  if (a === 10) return 'RFC1918 私网 10.0.0.0/8';
  if (a === 127) return '回环 127.0.0.0/8（本机）';
  if (a === 169 && b === 254) return '链路本地 169.254.0.0/16（含云元数据 169.254.169.254）';
  if (a === 172 && b >= 16 && b <= 31) return 'RFC1918 私网 172.16.0.0/12';
  if (a === 192 && b === 168) return 'RFC1918 私网 192.168.0.0/16';
  if (a === 100 && b >= 64 && b <= 127) return 'CGNAT 100.64.0.0/10';
  if (a === 192 && b === 0) return 'IETF 协议保留 192.0.0.0/24';
  if (a === 198 && (b === 18 || b === 19)) return '基准测试段 198.18.0.0/15';
  if (a >= 224 && a <= 239) return '组播 224.0.0.0/4';
  if (a >= 240) return '保留段 240.0.0.0/4（含 255.255.255.255）';
  return null;
}

/** IPv6 → 8 个 hextet 整数；解析不了返回 null。
 *  为什么自己写而不用字符串前缀判断：WHATWG URL 会把 ::ffff:127.0.0.1 归一成
 *  ::ffff:7f00:1（实测），按点分十进制去抠会漏掉这一整类 IPv4-mapped 绕过。 */
function expandIpv6(ipRaw) {
  let s = String(ipRaw).toLowerCase().split('%')[0]; // %zone 也要剥（fe80::1%eth0）
  const v4m = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4m) {
    const q = v4m[1].split('.').map(Number);
    if (q.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    s = s.slice(0, v4m.index) + ((q[0] << 8) | q[1]).toString(16) + ':' + ((q[2] << 8) | q[3]).toString(16);
  }
  const dbl = s.indexOf('::');
  const head = (dbl >= 0 ? s.slice(0, dbl) : s).split(':').filter(Boolean);
  const tail = dbl >= 0 ? s.slice(dbl + 2).split(':').filter(Boolean) : [];
  if (dbl >= 0 && s.indexOf('::', dbl + 1) >= 0) return null; // 只能有一个 ::
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (dbl < 0 && fill !== 0)) return null;
  const parts = head.concat(new Array(fill).fill('0'), tail);
  if (parts.length !== 8) return null;
  const nums = parts.map((h) => (typeof h === 'string' && /^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

/** IPv6 段位判定：IPv4-mapped / NAT64 先拆回 v4 递归判，其余按前缀判 */
function blockedIpv6(ipRaw) {
  const p = expandIpv6(ipRaw);
  if (!p) return '不是合法 IPv6';
  const zero5 = p[0] === 0 && p[1] === 0 && p[2] === 0 && p[3] === 0 && p[4] === 0;
  if (zero5 && p[5] === 0xffff) return blockedIpv4([p[6] >> 8, p[6] & 255, p[7] >> 8, p[7] & 255].join('.'));
  if (p[0] === 0x64 && p[1] === 0xff9b && p[2] === 0 && p[3] === 0) return blockedIpv4([p[6] >> 8, p[6] & 255, p[7] >> 8, p[7] & 255].join('.')); // NAT64
  if (p.every((n) => n === 0)) return 'IPv6 未指定 ::';
  // ::1 必须排在 ::a.b.c.d 之前判，否则 ::1 会被当成 0.0.0.1 报成「0.0.0.0/8」，误导排查
  if (zero5 && p[5] === 0 && p[6] === 0 && p[7] === 1) return 'IPv6 回环 ::1（本机）';
  if (zero5 && p[5] === 0 && (p[6] !== 0 || p[7] !== 0)) return blockedIpv4([p[6] >> 8, p[6] & 255, p[7] >> 8, p[7] & 255].join('.')); // ::a.b.c.d
  if ((p[0] & 0xfe00) === 0xfc00) return 'IPv6 ULA 私网 fc00::/7';
  if ((p[0] & 0xffc0) === 0xfe80) return 'IPv6 链路本地 fe80::/10';
  if ((p[0] & 0xff00) === 0xff00) return 'IPv6 组播 ff00::/8';
  if (p[0] === 0x2002) return 'IPv6 6to4 2002::/16（内嵌 v4 地址）';
  return null;
}

/** 任意 host 字面量 → 命中原因或 null（只对 IP 字面量有意义） */
function isBlockedAddress(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '');
  if (h.includes(':')) return blockedIpv6(h);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return blockedIpv4(h);
  return null;
}

/** env 读取集中在这里：每次调用现读，测试改 env 后立即生效（不缓存） */
function envFlag(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() !== '' && v.trim() !== '0';
}
function allowList() {
  return String(process.env.P1B_LLM_HOST_ALLOW || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function hostAllowed(host) {
  const list = allowList();
  if (!list.length) return true; // 未配白名单 = 不启用白名单模式（默认不收紧到无法自建供应商）
  const h = String(host || '').toLowerCase();
  return list.some((e) => (e.startsWith('.') ? h.endsWith(e) && h.length > e.length : h === e));
}

/** 解析 + 同步策略判定。upsert 保持同步（既有调用方全是同步调用，改 async 会打断它们）。 */
function checkBaseUrl(raw) {
  const s = requireNonEmpty(raw, 'base_url');
  let u;
  try { u = new URL(s); } catch (e) { throw httpError(400, 'base_url 不是合法 URL: ' + JSON.stringify(s)); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw httpError(400, 'base_url 只允许 http:// 或 https://，收到: ' + u.protocol);
  // userinfo 形如 http://a:密码@host/：LLM base_url 永远不需要它，却是解析器混淆的经典载体
  if (u.username || u.password) throw httpError(400, 'base_url 不得携带 userinfo（http://user:pass@host/ 一律拒收）');
  if (!hostAllowed(u.hostname)) {
    throw httpError(400, 'base_url 主机不在白名单内（env P1B_LLM_HOST_ALLOW）：' + u.hostname);
  }
  if (!envFlag('P1B_LLM_ALLOW_PRIVATE')) {
    const why = isBlockedAddress(u.hostname);
    if (why) {
      throw httpError(400, 'base_url 指向内网/回环/云元数据地址（' + why + '）：' + u.hostname +
        '　——要让本机 Ollama 之类可用，显式设 P1B_LLM_ALLOW_PRIVATE=1');
    }
  }
  return u;
}

/**
 * 出站前的加强判定：除同步策略外，再把域名解析出来看它落在哪。
 * 解析失败按「放行」处理并在此说明取舍：既有用例大量使用 .example/.invalid 这类
 * 保留域（本就解析不出），且离线改配置时也解析不出；解析不出来的主机此刻本来就
 * 到不了。真正想彻底断掉公网主机外泄的，用 P1B_LLM_HOST_ALLOW 白名单（写入层就挡）。
 */
async function assertEgressSafe(rawBase) {
  const u = checkBaseUrl(rawBase);
  const host = u.hostname;
  if (isBlockedAddress(host)) return u; // 上面已抛
  if (/^\[?[\da-f:.]+\]?$/i.test(host) || isBlockedAddress(host)) return u; // IP 字面量无需 DNS
  let addrs = [];
  try {
    addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch (e) {
    return u; // 见上方说明：解析失败放行
  }
  if (!envFlag('P1B_LLM_ALLOW_PRIVATE')) {
    for (const a of addrs || []) {
      const why = isBlockedAddress(a.address);
      if (why) {
        throw httpError(400, 'base_url 域名 ' + host + ' 解析到内网/回环/云元数据地址（' + why + '）：' + a.address);
      }
    }
  }
  return u;
}

function createProvidersStore(configPath) {
  const file = configPath || process.env.P1B_PROVIDERS_PATH || DEFAULT_PATH;

  function read() {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT') return { active: null, providers: {} };
      throw httpError(500, '供应商配置读取失败: ' + (e && e.message ? e.message : e));
    }
    let cfg;
    try { cfg = JSON.parse(raw); } catch (e) {
      throw httpError(500, '供应商配置 JSON 损坏: ' + (e && e.message ? e.message : e));
    }
    return {
      active: (cfg && typeof cfg.active === 'string') ? cfg.active : null,
      providers: (cfg && cfg.providers && typeof cfg.providers === 'object') ? cfg.providers : {},
    };
  }

  function write(cfg) {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
  }

  /** 脱敏公开形状（安全铁律的唯一出口） */
  function toPublic(key, p) {
    p = p || {};
    const model = (p.extraction && p.extraction.model) || p.model || null;
    const cardsModel = (p.cards && p.cards.model) || p.cards_model || model;
    const k = typeof p.api_key === 'string' ? p.api_key : '';
    return {
      key,
      label: p.label || key,
      base_url: p.base_url || '',
      model,
      cards_model: cardsModel,
      has_api_key: k.length > 0,
      api_key_masked: k ? (k.length >= 12 ? '....' + k.slice(-4) : '....') : null,
    };
  }

  function requireKey(key) {
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
      throw httpError(400, 'provider key 非法（限字母/数字/_/-，≤64 字符）: ' + JSON.stringify(key));
    }
    return key;
  }

  function getProvider(key) {
    requireKey(key);
    const { providers } = read();
    const p = providers[key];
    if (!p) throw httpError(404, '供应商不存在: ' + key);
    return p;
  }

  /** PUT upsert。body: {label, base_url, api_key?, model, cards_model?} */
  function upsert(key, body) {
    requireKey(key);
    if (!body || typeof body !== 'object') throw httpError(400, 'body 必须是对象');
    const label = requireNonEmpty(body.label, 'label');
    const baseUrl = requireBaseUrl(body.base_url);
    const model = requireNonEmpty(body.model, 'model');
    const cfg = read();
    const existing = cfg.providers[key] || {};
    const next = JSON.parse(JSON.stringify(existing));
    next.label = label;
    next.base_url = baseUrl;
    // api_key：仅当传入非空字符串才覆盖；留空/缺省 = 保留现有值（前端「留空=不修改」语义）
    if (typeof body.api_key === 'string' && body.api_key.trim() !== '') {
      next.api_key = body.api_key.trim();
    } else if (envFlag('P1B_LLM_STRICT_HOST') && typeof existing.base_url === 'string' &&
      originOf(existing.base_url) !== originOf(baseUrl)) {
      // ★凭证外泄链的最后一环：换主机 = 把「真 key 发给谁」这件事整个换掉了。
      //   旧语义下不带 key 的 PUT 会让真 key 跟着搬到新主机，随后 /test 就把它发出去。
      //   严格形态下换主机必须重交 key，否则宁可不继承。
      //   为什么默认关：既有契约 verdicts.test.cjs 明确钉死「改 base_url + key 留空 = 保留现有 key」，
      //   默认打开会打断它；要这个保护的操作者显式设 P1B_LLM_STRICT_HOST=1。
      delete next.api_key;
    }
    next.extraction = Object.assign({}, existing.extraction, { model });
    // cards.model 的 UI 语义 =「留空 = 与抽取模型相同」（见 ProviderEditorSheet 占位文案）。
    // 2026-09-14 修：此前留空时保留**旧值**，于是「只改抽取模型」会让过期的 cards.model 继续生效；
    // 而 resolveLlmOptions/llm-client 的取值优先级是 cards.model → extraction.model，结果=界面显示已改、
    // 判词链实际仍用旧模型（用户报「切换模型不生效」的真实根因之一）。改为：留空即清空，
    // 让下游 fallback 到 extraction.model，与 UI 语义一致。
    next.cards = Object.assign({}, existing.cards, { model: (body.cards_model && String(body.cards_model).trim()) || model });
    cfg.providers[key] = next;
    write(cfg);
    return toPublic(key, next);
  }

  function remove(key) {
    requireKey(key);
    const cfg = read();
    if (!cfg.providers[key]) throw httpError(404, '供应商不存在: ' + key);
    delete cfg.providers[key];
    if (cfg.active === key) {
      const rest = Object.keys(cfg.providers);
      cfg.active = rest.length ? rest[0] : null;
    }
    write(cfg);
    return { ok: true, active: cfg.active };
  }

  function activate(key) {
    requireKey(key);
    const cfg = read();
    if (!cfg.providers[key]) throw httpError(404, '供应商不存在: ' + key);
    cfg.active = key;
    write(cfg);
    return { ok: true, active: key };
  }

  function list() {
    const cfg = read();
    const providers = Object.keys(cfg.providers)
      .sort()
      .map((k) => toPublic(k, cfg.providers[k]));
    return { providers, active: cfg.active };
  }

  /** 连接测试：发一条 ping（live 模式真连，mock 模式跳过网络）。绝不把 key 放进返回/日志。 */
  async function testProvider(key, { mock }) {
    const p = getProvider(key);
    const model = (p.extraction && p.extraction.model) || p.model || null;
    if (mock) {
      return { ok: true, model, message: 'mock 模式（P1B_LLM_MOCK=1）：跳过真实连接测试' };
    }
    const k = typeof p.api_key === 'string' ? p.api_key : '';
    if (!k) return { ok: false, model, message: '未配置 API key，无法测试' };
    const base = String(p.base_url || '').replace(/\/+$/, '');
    // ★出站前最后一道闸：这一步之前一个字节都还没发出去，所以在这里拒绝等于零泄漏。
    //   base_url 可能绕过 upsert 直接来自手改的 providers.json，因此不能只靠写入层校验。
    //   mock 分支在上面就 return 了，所以 P1B_LLM_MOCK=1 依旧零 DNS 零网络。
    let u;
    try {
      u = await assertEgressSafe(base);
    } catch (e) {
      return { ok: false, model, message: 'base_url 被出口守卫拒绝，未发出任何请求: ' + ((e && e.message) ? e.message : String(e)) };
    }
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      let res;
      try {
        res = await fetch(base + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8, stream: false }),
          signal: ctrl.signal,
        });
      } finally { clearTimeout(timer); }
      const latencyMs = Date.now() - t0;
      if (!res.ok) return { ok: false, model, latency_ms: latencyMs, message: 'HTTP ' + res.status };
      return { ok: true, model, latency_ms: latencyMs, message: '连接成功（' + latencyMs + 'ms）' };
    } catch (e) {
      const why = e && e.name === 'AbortError' ? '超时(10s)' : ((e && e.message) ? e.message : String(e));
      return { ok: false, model, message: '连接失败: ' + why };
    }
  }

  return { read, write, list, upsert, remove, activate, getProvider, testProvider, toPublic, file };
}

function requireNonEmpty(v, name) {
  if (typeof v !== 'string' || !v.trim()) throw httpError(400, name + ' 必须是非空字符串');
  return v.trim();
}

/** 只取 origin 作「换没换主机」的判据：路径/末尾斜杠变化不算换主机（否则会误伤改 path 的场景） */
function originOf(v) {
  try { return new URL(String(v)).origin; } catch (e) { return null; }
}

function requireBaseUrl(v) {
  const s = requireNonEmpty(v, 'base_url');
  checkBaseUrl(s); // 全部策略判定在 checkBaseUrl；返回值仍用原串，避免 URL 归一化改动存量配置
  return s;
}

module.exports = { createProvidersStore, DEFAULT_PATH, checkBaseUrl, isBlockedAddress, assertEgressSafe, originOf };
