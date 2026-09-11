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
const { httpError } = require('./util');

const DEFAULT_PATH = path.join(__dirname, '..', '..', 'p1a-terminal', 'config', 'providers.json');
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

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
    }
    next.extraction = Object.assign({}, existing.extraction, { model });
    next.cards = Object.assign({}, existing.cards, { model: body.cards_model || (existing.cards && existing.cards.model) || model });
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
    if (!/^https?:\/\//.test(base)) return { ok: false, model, message: 'base_url 非法: ' + base };
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

function requireBaseUrl(v) {
  const s = requireNonEmpty(v, 'base_url');
  if (!/^https?:\/\//i.test(s)) throw httpError(400, 'base_url 必须以 http:// 或 https:// 开头');
  return s;
}

module.exports = { createProvidersStore, DEFAULT_PATH };
