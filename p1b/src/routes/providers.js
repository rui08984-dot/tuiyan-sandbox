'use strict';
/**
 * p1b/src/routes/providers.js —— 供应商管理器路由（P1B-SPEC §2.4/§3）：
 *   GET    /api/providers                  → {providers:[脱敏形状], active}
 *   PUT    /api/providers/:key             → upsert（api_key 留空 = 保留现有值）→ {provider}
 *   DELETE /api/providers/:key             → {ok}（§2.4 要求可删除；§3 未列 —— 契约扩展，前端 api.ts 已对齐）
 *   POST   /api/providers/:key/activate    → {ok, active}
 *   POST   /api/providers/:key/test        → 连接测试（mock 模式跳过网络）
 * 安全铁律：api_key 读写全部发生在服务端；任何响应都不含 api_key 明文（含错误信息）。
 */
const { httpError, requireNonEmptyString } = require('../util');

function register(app, ctx) {
  const store = ctx.store;

  app.get('/api/providers', async () => store.list());

  app.put('/api/providers/:key', async (req) => {
    const body = req.body || {};
    const provider = store.upsert(String(req.params.key || ''), {
      label: body.label,
      base_url: body.base_url,
      api_key: body.api_key, // undefined/'' = 保留现有（store 内裁决）
      model: body.model !== undefined ? body.model : body.extraction_model,
      cards_model: body.cards_model,
    });
    return { provider };
  });

  app.delete('/api/providers/:key', async (req) => {
    return store.remove(String(req.params.key || ''));
  });

  app.post('/api/providers/:key/activate', async (req) => {
    return store.activate(String(req.params.key || ''));
  });

  app.post('/api/providers/:key/test', async (req) => {
    const key = String(req.params.key || '');
    // 确认存在性（不存在 → 404 由 store 抛）
    if (typeof key !== 'string' || !key) throw httpError(400, 'provider key 必须非空');
    requireNonEmptyString('provider key', key);
    return store.testProvider(key, { mock: ctx.llmMock });
  });
}

module.exports = { register };
