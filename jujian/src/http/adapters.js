'use strict';
/**
 * 局鉴 · src/http/adapters.js —— 游戏类型登记表：GET /api/adapters
 *   → 200 [{ id, name, kind, ready, source, layer?, checklist?, contract?, missing? }]
 *
 * ★这个端点是「加新游戏零改其余代码」那条承诺的兑现处：
 *   ① BUILTIN = werewolf/botc/script（本体已内置，只登记）；
 *   ② 扫 src/kernel/adapters/*.js：只读 require，认 ADAPTER_ID ＋ 五方法契约，
 *      五方法齐 = ready:true；缺则 ready:false ＋ missing 如实列出（**禁编造**）。
 *   加一种新游戏 = 往 adapters/ 丢一个文件。前后端一行都不用改。
 *
 * 零 db、零 LLM、零网络：纯 fs 读目录 ＋ 模块元信息。
 */
const fs = require('fs');
const path = require('path');

const ADAPTERS_DIR = path.join(__dirname, '..', 'kernel', 'adapters');
const REQUIRED_METHODS = ['listOpenQuestions', 'resolveQuestion', 'featurePack', 'baseline', 'exposure'];

// 内置登记（不扫目录也恒在）；kind: engine=本体自带引擎 / script=纯记录类型 / adapter=落文件接入
const BUILTIN = [
  { id: 'werewolf', name: '狼人杀', kind: 'engine', ready: true, source: 'src/kernel/detectors/werewolf-contradictions.js' },
  { id: 'botc', name: '血染钟楼', kind: 'engine', ready: true, source: 'src/kernel/botc/' },
  { id: 'script', name: '剧本', kind: 'script', ready: true, source: '内置纯记录类型（无矛盾推理）' },
];

// 文件名 → 中文名（未登记者用 id 兜底，不编造名字）
const NAME_HINT = { avalon: '阿瓦隆' };

/** 扫 adapters/*.js：require 失败也保留条目（ready:false），不静默丢 */
function scanAdapters() {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(ADAPTERS_DIR); } catch (e) { return out; }
  for (const f of files.sort()) {
    if (!/\.js$/.test(f) || f.charAt(0) === '_') continue;
    let mod = null;
    try { mod = require(path.join(ADAPTERS_DIR, f)); } catch (e) { mod = null; }
    const id = (mod && typeof mod.ADAPTER_ID === 'string' && mod.ADAPTER_ID)
      ? mod.ADAPTER_ID : f.replace(/\.js$/, '');
    const missing = mod ? REQUIRED_METHODS.filter((m) => typeof mod[m] !== 'function') : REQUIRED_METHODS.slice();
    const item = {
      id: id,
      name: NAME_HINT[id] || id,
      kind: 'adapter',
      ready: missing.length === 0,
      source: 'adapters/' + f,
      layer: (mod && mod.LAYER) || null,
      checklist: (mod && mod.CHECKLIST_HASH) || null,
      contract: (REQUIRED_METHODS.length - missing.length) + '/' + REQUIRED_METHODS.length,
    };
    if (missing.length) item.missing = missing;
    out.push(item);
  }
  return out;
}

/** 内置 + 扫描（同 id 以内置为准，去重） */
function listAdapters() {
  const seen = {};
  BUILTIN.forEach((b) => { seen[b.id] = true; });
  return BUILTIN.concat(scanAdapters().filter((a) => !seen[a.id]));
}

function register(app) {
  app.get('/api/adapters', async () => listAdapters());
}

module.exports = { register, listAdapters, ADAPTERS_DIR, REQUIRED_METHODS, BUILTIN };