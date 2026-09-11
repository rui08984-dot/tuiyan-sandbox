/**
 * 供应商编辑抽屉（移动端底部弹层 / 桌面居中对话框）。
 * 契约：PUT /api/providers/:key（upsert）；api_key 留空 = 不修改服务端已有值，key 永不出服务端。
 */
import { useMemo, useState } from 'react';
import { saveProvider } from '../api';
import type { Provider } from '../types';

export interface ProviderTemplate {
  key: string;
  label: string;
  base_url: string;
  model: string;
  hint?: string;
}

export interface EditorSession {
  mode: 'add' | 'edit';
  /** add：来源模板（null = 空白自定义）；edit：null */
  template: ProviderTemplate | null;
  /** edit：现有供应商 */
  provider: Provider | null;
}

interface Props {
  session: EditorSession;
  onClose: () => void;
  onSaved: () => void;
}

interface Draft {
  key: string;
  label: string;
  base_url: string;
  api_key: string;
  model: string;
  cards_model: string;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function ProviderEditorSheet({ session, onClose, onSaved }: Props) {
  const { mode, template, provider } = session;
  const isEdit = mode === 'edit' && provider !== null;

  const [draft, setDraft] = useState<Draft>(() => {
    if (isEdit && provider) {
      return {
        key: provider.key,
        label: provider.label,
        base_url: provider.base_url,
        api_key: '',
        model: provider.model,
        cards_model: provider.cards_model || '',
      };
    }
    const t = template;
    return {
      key: t && t.key !== 'custom' ? t.key : '',
      label: t && t.key !== 'custom' ? t.label : '',
      base_url: t?.base_url ?? '',
      api_key: '',
      model: t?.model ?? '',
      cards_model: '',
    };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const keyProblem = useMemo(() => {
    if (isEdit) return null;
    const k = draft.key.trim();
    if (!k) return '必填';
    if (!KEY_RE.test(k)) return '字母开头，仅限字母/数字/-/_，≤64 字符';
    return null;
  }, [isEdit, draft.key]);

  async function handleSave() {
    setError(null);
    const key = draft.key.trim();
    if (!isEdit) {
      if (!key) { setError('标识（key）必填'); return; }
      if (!KEY_RE.test(key)) { setError('标识仅限字母/数字/-/_，字母开头'); return; }
    }
    if (!draft.label.trim()) { setError('名称必填'); return; }
    if (!/^https?:\/\//i.test(draft.base_url.trim())) { setError('Base URL 需以 http:// 或 https:// 开头'); return; }
    if (!draft.model.trim()) { setError('抽取模型必填'); return; }
    setSaving(true);
    try {
      await saveProvider(key, {
        label: draft.label.trim(),
        base_url: draft.base_url.trim(),
        api_key: draft.api_key.trim() || undefined, // 留空 = 不修改服务端已有 key
        model: draft.model.trim(),
        cards_model: draft.cards_model.trim() || undefined,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sheet-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={isEdit ? '编辑供应商' : '添加供应商'}>
        <div className="sheet-head">
          <h2>{isEdit ? '编辑供应商' : '添加供应商'}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>

        {!isEdit && template?.hint && <p className="muted">{template.hint}</p>}

        <div className="form-grid">
          <label className="field">
            <span className="field-label">标识（key）{isEdit && <em>· 创建后不可改</em>}</span>
            <input
              value={draft.key}
              readOnly={isEdit}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="如 deepseek"
              onChange={(e) => set({ key: e.target.value })}
            />
            {keyProblem && <span className="field-error">{keyProblem}</span>}
          </label>

          <label className="field">
            <span className="field-label">名称</span>
            <input
              value={draft.label}
              placeholder="如 DeepSeek"
              onChange={(e) => set({ label: e.target.value })}
            />
          </label>

          <label className="field">
            <span className="field-label">Base URL</span>
            <input
              value={draft.base_url}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://api.example.com/v1"
              onChange={(e) => set({ base_url: e.target.value })}
            />
          </label>

          <label className="field">
            <span className="field-label">API Key</span>
            <input
              type="password"
              value={draft.api_key}
              autoComplete="new-password"
              placeholder={
                isEdit && provider?.has_api_key
                  ? '已保存 ' + (provider.api_key_masked ?? '••••') + '，留空不修改'
                  : isEdit ? '未配置，可留空' : 'sk-…'
              }
              onChange={(e) => set({ api_key: e.target.value })}
            />
            <span className="field-hint">Key 只保存在服务端配置文件，页面不回显明文；留空 = 保持现有值。</span>
          </label>

          <label className="field">
            <span className="field-label">抽取模型</span>
            <input
              value={draft.model}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="如 deepseek-chat"
              onChange={(e) => set({ model: e.target.value })}
            />
          </label>

          <label className="field">
            <span className="field-label">参谋卡模型</span>
            <input
              value={draft.cards_model}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="留空 = 与抽取模型相同"
              onChange={(e) => set({ cards_model: e.target.value })}
            />
          </label>
        </div>

        {error && <p className="sheet-error" role="alert">{error}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>取消</button>
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
