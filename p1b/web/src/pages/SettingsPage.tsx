/**
 * 设置页 = 供应商管理器（spec §2.4，拍板 #6：做进网页设置页）。
 * - 供应商列表（预置模板添加）+ 添加/编辑/删除
 * - 编辑项：名称 / Base URL / API Key（密码框）/ 抽取模型 / 参谋卡模型
 * - 激活切换（POST /api/providers/:key/activate）+ 连接测试（POST /api/providers/:key/test，行内提示）
 * - key 永不出服务端：前端编辑 key 留空 = 不修改该字段
 * - 后端未起时：请求失败显示可读错误 + 重试，不白屏
 */
import { useCallback, useEffect, useState } from 'react';
import { activateProvider, deleteProvider, getEffectiveProvider, listProviders, testProvider } from '../api';
import type { EffectiveProvider, Provider, ProviderListResult, ProviderTestResult } from '../types';
import { Tabs, IconGear, IconCheck, IconClose } from '../components/ui';
import {
  ProviderEditorSheet,
  type EditorSession,
  type ProviderTemplate,
} from '../components/ProviderEditorSheet';

/** 预置模板（spec §2.4：DeepSeek/Kimi/GLM/通义/硅基流动/OpenRouter/Ollama/自定义） */
const TEMPLATES: ProviderTemplate[] = [
  { key: 'deepseek', label: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hint: '官方 API，OpenAI 兼容' },
  { key: 'kimi', label: 'Kimi（月之暗面）', base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { key: 'glm', label: 'GLM（智谱）', base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', hint: 'glm-4-flash 有免费档，适合先跑通' },
  { key: 'qwen', label: '通义千问', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { key: 'siliconflow', label: '硅基流动', base_url: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  { key: 'openrouter', label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' },
  { key: 'ollama', label: 'Ollama（本地）', base_url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', hint: '本地推理，无需 API Key' },
  { key: 'custom', label: '自定义', base_url: '', model: '', hint: '任意 OpenAI 兼容中转 / 网关，字段自填' },
];

export default function SettingsPage() {
  const [list, setList] = useState<ProviderListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorSession | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // 'test:<key>' | 'activate:<key>' | 'delete:<key>'
  const [testResults, setTestResults] = useState<Record<string, ProviderTestResult>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // 实际生效配置（2026-09-14）：证明「换模型真的生效」的浏览器内验证面（无需重启服务）
  const [effective, setEffective] = useState<EffectiveProvider | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [l, eff] = await Promise.all([listProviders(), getEffectiveProvider().catch(() => null)]);
      setList(l);
      setEffective(eff);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  async function withBusy(id: string, fn: () => Promise<void>) {
    setActionError(null);
    setBusy(id);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const handleActivate = (key: string) =>
    withBusy('activate:' + key, async () => {
      await activateProvider(key);
      await reload();
    });

  const handleTest = (key: string) =>
    withBusy('test:' + key, async () => {
      const r = await testProvider(key);
      setTestResults((prev) => ({ ...prev, [key]: r }));
    });

  const handleDelete = (key: string) =>
    withBusy('delete:' + key, async () => {
      await deleteProvider(key);
      setConfirmDelete(null);
      setTestResults((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      await reload();
    });

  const activeProvider = list?.providers.find((p) => p.key === list.active) ?? null;

  return (
    <section className="page">
      <header className="page-head">
        <IconGear size={20} />
        <h1>设置</h1>
      </header>
      <p className="page-sub">
        供应商管理器 —— 配置文件与终端共享，网页改完终端自动生效。
        API Key 只保存在服务端，页面不回显明文。
      </p>

      {loadError && (
        <div className="banner banner-error" role="alert">
          <p>{loadError}</p>
          <button type="button" className="btn" onClick={() => void reload()}>重试</button>
        </div>
      )}

      {loading && !list && <p className="muted">加载中…</p>}

      {list && !loadError && (
        <>
          <div className="settings-active">
            <span className="muted">当前使用：</span>
            {activeProvider
              ? <strong>{activeProvider.label}</strong>
              : <em className="warn-text">未激活任何供应商</em>}
          </div>

          {/* 实际生效读数（2026-09-14）：判词/跑批/参谋全链真正会用的模型；改完配置即刷新 */}
          {effective && (
            <div className="callout" data-testid="effective-provider">
              <p>
                <strong>实际生效（判词 / 跑批 / 参谋全链）</strong>
                {' · '}
                <span className={effective.mock ? 'warn-text' : 'muted'}>
                  {effective.mock ? 'MOCK（无可用 Key，不会真实调用）' : 'LIVE'}
                </span>
              </p>
              <p className="muted">
                供应商 <code>{effective.provider ?? '（未激活）'}</code>
                {' · '}
                模型 <code>{effective.model ?? '—'}</code>
              </p>
              <p className="muted">
                Key 来源：{effective.key_source === 'providers' ? '配置文件 providers.json' : effective.key_source === 'env' ? '环境变量兜底（非配置文件）' : '无'}
                {' · '}
                改配置后此处即时刷新，无需重启服务。
              </p>
            </div>
          )}

          {actionError && (
            <div className="banner banner-error" role="alert">
              <p>{actionError}</p>
            </div>
          )}

          <Tabs testId="settings-tabs" tabs={[
            { id: 'providers', label: '供应商', content: (
              <div className="ui-section">
                <h2 className="ui-section-title">供应商</h2>
                {list.providers.length === 0 && (
                  <div className="callout"><p>还没有供应商，切到「模板添加」加一个。</p></div>
                )}
                <ul className="provider-list">
                  {list.providers.map((p) => (
                    <ProviderCard
                      key={p.key}
                      provider={p}
                      isActive={p.key === list.active}
                      testResult={testResults[p.key]}
                      busyId={busy}
                      confirmDelete={confirmDelete === p.key}
                      onActivate={() => void handleActivate(p.key)}
                      onTest={() => void handleTest(p.key)}
                      onEdit={() => setEditor({ mode: 'edit', template: null, provider: p })}
                      onRequestDelete={() => setConfirmDelete(p.key)}
                      onCancelDelete={() => setConfirmDelete(null)}
                      onConfirmDelete={() => void handleDelete(p.key)}
                    />
                  ))}
                </ul>
              </div>
            ) },
            { id: 'templates', label: '模板添加', content: (
              <div className="ui-section">
                <h2 className="ui-section-title">模板添加</h2>
                <div className="template-row">
                  {TEMPLATES.map((t) => (
                    <button key={t.key} type="button" className="chip"
                      onClick={() => setEditor({ mode: 'add', template: t, provider: null })}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="btn btn-block"
                  onClick={() => setEditor({ mode: 'add', template: null, provider: null })}>
                  ＋ 空白自定义供应商
                </button>
              </div>
            ) },
          ]} />
        </>
      )}

      {editor && (
        <ProviderEditorSheet
          key={editor.mode + ':' + (editor.provider?.key ?? editor.template?.key ?? 'blank')}
          session={editor}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); void reload(); }}
        />
      )}
    </section>
  );
}

// ── 供应商卡片 ──

interface CardProps {
  provider: Provider;
  isActive: boolean;
  testResult?: ProviderTestResult;
  busyId: string | null;
  confirmDelete: boolean;
  onActivate: () => void;
  onTest: () => void;
  onEdit: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function ProviderCard(props: CardProps) {
  const { provider: p, isActive, testResult, busyId, confirmDelete } = props;
  const busyTest = busyId === 'test:' + p.key;
  const busyActivate = busyId === 'activate:' + p.key;
  const busyDelete = busyId === 'delete:' + p.key;

  return (
    <li className={'provider-card' + (isActive ? ' is-active' : '')}>
      <div className="provider-head">
        <div>
          <span className="provider-name">{p.label}</span>
          <span className="provider-key">{p.key}</span>
        </div>
        <div className="provider-badges">
          {isActive && <span className="badge badge-accent">使用中</span>}
          <span className={p.has_api_key ? 'badge badge-ok' : 'badge badge-warn'}>
            {p.has_api_key ? 'Key 已配置' : '未配 Key'}
          </span>
        </div>
      </div>
      <p className="provider-url">{p.base_url}</p>
      <p className="provider-models">
        抽取 <code>{p.model}</code>
        {' · '}
        参谋卡 <code>{p.cards_model || '（同抽取模型）'}</code>
      </p>

      {testResult && (
        <p className={'test-result ' + (testResult.ok ? 'is-ok' : 'is-fail')} role="status">
          {testResult.ok ? <IconCheck size={14} /> : <IconClose size={14} />} {testResult.message}
          {testResult.ok && testResult.latency_ms != null ? ' · ' + testResult.latency_ms + 'ms' : ''}
        </p>
      )}

      {confirmDelete ? (
        <div className="confirm-row">
          <span>确认删除「{p.label}」？{isActive && '（使用中，删除后将自动切换到其余供应商）'}</span>
          <button type="button" className="btn btn-danger" disabled={busyDelete} onClick={props.onConfirmDelete}>
            {busyDelete ? '删除中…' : '确认删除'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={props.onCancelDelete}>取消</button>
        </div>
      ) : (
        <div className="provider-actions">
          {isActive ? (
            <button type="button" className="btn" disabled>当前使用中</button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={busyActivate} onClick={props.onActivate}>
              {busyActivate ? '切换中…' : '设为使用中'}
            </button>
          )}
          <button type="button" className="btn" disabled={busyTest} onClick={props.onTest}>
            {busyTest ? '测试中…' : '连接测试'}
          </button>
          <button type="button" className="btn" onClick={props.onEdit}>编辑</button>
          <button type="button" className="btn btn-danger-ghost" onClick={props.onRequestDelete}>删除</button>
        </div>
      )}
    </li>
  );
}
