import { useEffect, useRef, useState } from 'react';
import type { DocSourceView, MemoryView } from '../../shared/api';
import { confirmDialog } from '../confirm';
import { t } from '../i18n';
import { api, toast, useStore } from '../store';
import { Icon } from './Icon';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Re-runs `load` now and whenever main says memories or docs changed. */
function useKnowledge<T>(load: () => Promise<T>, initial: T): [T, () => void] {
  const [value, setValue] = useState<T>(initial);
  const reload = () =>
    void load()
      .then(setValue)
      .catch(() => undefined);
  useEffect(() => {
    reload();
    return api().on((ev) => {
      if (ev.type === 'knowledge:changed') reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [value, reload];
}

/** Settings › Memories: what the AI keeps between conversations. */
export function MemoriesSection() {
  const workspace = useStore((s) => s.workspace);
  const [items, reload] = useKnowledge<MemoryView[]>(() => api().knowledge.memories(), []);
  const [text, setText] = useState('');
  const [scope, setScope] = useState<'global' | 'project'>('global');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  // Enter saves and unmounts the field, which can also fire blur: save only once.
  const saving = useRef(false);
  // Esc / Enter already decided: the blur of the field going away must not save again.
  const skipBlur = useRef(false);

  /** Saves the edited memory (Enter or leaving the field); empty or unchanged just closes. */
  const saveEdit = async (m: MemoryView, value: string) => {
    if (saving.current) return;
    const next = value.trim();
    if (!next || next === m.text) {
      setEditing(null);
      return;
    }
    saving.current = true;
    try {
      await api().knowledge.updateMemory(m.id, next);
      setEditing(null);
      reload();
    } catch (e) {
      // Keep the field open with the text, so nothing typed is lost.
      skipBlur.current = false;
      toast(errText(e));
    } finally {
      saving.current = false;
    }
  };

  const remove = async (m: MemoryView) => {
    if (
      !(await confirmDialog(t('memDeleteConfirm', { text: m.text.slice(0, 120) }), {
        danger: true,
      }))
    )
      return;
    try {
      await api().knowledge.removeMemory(m.id);
      reload();
    } catch (e) {
      toast(errText(e));
    }
  };

  const add = async () => {
    if (!text.trim()) return;
    try {
      await api().knowledge.addMemory(text.trim(), scope);
      setText('');
      reload();
    } catch (e) {
      toast(errText(e));
    }
  };

  const projectName = (p?: string) => p?.split(/[\\/]/).filter(Boolean).pop() ?? '';

  return (
    <>
      <h3>{t('setMemories')}</h3>
      <p className="dim small">{t('memHint')}</p>
      <div className="knowledge-add">
        <input
          value={text}
          aria-label={t('memPlaceholder')}
          placeholder={t('memPlaceholder')}
          maxLength={600}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <select
          value={scope}
          aria-label={t('memScope')}
          onChange={(e) => setScope(e.target.value as 'global' | 'project')}
        >
          <option value="global">{t('memGlobal')}</option>
          <option value="project" disabled={!workspace}>
            {t('memProject')}
          </option>
        </select>
        <button className="primary" disabled={!text.trim()} onClick={() => void add()}>
          <Icon name="plus" size={13} /> {t('memAdd')}
        </button>
      </div>
      {!items.length && <p className="dim small">{t('memEmpty')}</p>}
      <ul className="knowledge-list">
        {items.map((m) => (
          <li key={m.id}>
            {editing?.id === m.id ? (
              <input
                autoFocus
                value={editing.text}
                maxLength={600}
                aria-label={t('memEdit')}
                onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    // Cancels the edit only (not the Settings modal).
                    e.preventDefault();
                    skipBlur.current = true;
                    setEditing(null);
                  }
                  if (e.key === 'Enter') {
                    skipBlur.current = true;
                    void saveEdit(m, editing.text);
                  }
                }}
                onFocus={() => {
                  skipBlur.current = false;
                }}
                onBlur={(e) => {
                  if (!skipBlur.current) void saveEdit(m, e.target.value);
                }}
              />
            ) : (
              <span
                className="knowledge-text"
                onDoubleClick={() => setEditing({ id: m.id, text: m.text })}
              >
                {m.text}
              </span>
            )}
            <span className="knowledge-tag dim small">
              {m.scope === 'global' ? t('memGlobal') : projectName(m.project)}
            </span>
            <button
              title={t('memEdit')}
              aria-label={t('memEdit')}
              onClick={() => setEditing({ id: m.id, text: m.text })}
            >
              <Icon name="edit" size={13} />
            </button>
            <button
              title={t('memDelete')}
              aria-label={t('memDelete')}
              onClick={() => void remove(m)}
            >
              <Icon name="trash" size={13} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Settings › Docs: external documentation indexed for the AI, and the embedding model. */
export function DocsSection() {
  const [docs, reload] = useKnowledge<DocSourceView[]>(() => api().knowledge.docs(), []);
  const [embed, reloadEmbed] = useKnowledge<string | null>(
    () => api().knowledge.embedModel(),
    null,
  );
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [model, setModel] = useState<string | null>(null);

  const add = async () => {
    try {
      const d = await api().knowledge.addDocs(name.trim(), url.trim());
      toast(t('docsAdded', { name: d.name }));
      setName('');
      setUrl('');
      reload();
    } catch (e) {
      toast(errText(e));
    }
  };

  const saveModel = async () => {
    try {
      await api().knowledge.setEmbedModel((model ?? '').trim() || null);
      toast(t('embedSaved'));
      setModel(null);
      reloadEmbed();
    } catch (e) {
      toast(errText(e));
    }
  };

  return (
    <>
      <h3>{t('setDocs')}</h3>
      <p className="dim small">{t('docsHint')}</p>
      <div className="knowledge-add">
        <input
          style={{ maxWidth: 140 }}
          value={name}
          aria-label={t('docsName')}
          placeholder={t('docsName')}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          value={url}
          aria-label={t('docsUrl')}
          placeholder="https://…/docs/"
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && /^https?:\/\//.test(url.trim())) void add();
          }}
        />
        <button
          className="primary"
          disabled={!/^https?:\/\/\S+/.test(url.trim())}
          onClick={() => void add()}
        >
          <Icon name="books" size={13} /> {t('docsAdd')}
        </button>
      </div>
      {!docs.length && <p className="dim small">{t('docsEmpty')}</p>}
      <ul className="knowledge-list">
        {docs.map((d) => (
          <li key={d.id}>
            <span className="knowledge-text">
              <b>@docs:{d.name}</b> <span className="dim small">{d.url}</span>
            </span>
            <span className="knowledge-tag dim small">
              {d.status === 'indexing'
                ? t('docsIndexing', { n: d.pages })
                : d.status === 'error'
                  ? t('docsError', { msg: d.error ?? '' })
                  : t('docsReady', { pages: d.pages, chunks: d.chunks })}
            </span>
            <button
              title={t('docsReindex')}
              aria-label={t('docsReindex')}
              disabled={d.status === 'indexing'}
              onClick={() =>
                void api()
                  .knowledge.reindexDocs(d.id)
                  .then(reload)
                  .catch((e: unknown) => toast(errText(e)))
              }
            >
              <Icon name="refresh" size={13} />
            </button>
            <button
              title={t('docsRemove')}
              aria-label={t('docsRemove')}
              onClick={async () => {
                if (
                  !(await confirmDialog(t('docsRemoveConfirm', { name: d.name }), { danger: true }))
                )
                  return;
                try {
                  await api().knowledge.removeDocs(d.id);
                  reload();
                } catch (e) {
                  toast(errText(e));
                }
              }}
            >
              <Icon name="trash" size={13} />
            </button>
          </li>
        ))}
      </ul>

      <h3>{t('setEmbed')}</h3>
      <p className="dim small">{t('embedHint')}</p>
      <div className="knowledge-add">
        <input
          value={model ?? embed ?? ''}
          aria-label={t('setEmbed')}
          placeholder={t('embedPlaceholder')}
          spellCheck={false}
          onChange={(e) => setModel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void saveModel();
          }}
        />
        <button disabled={model === null} onClick={() => void saveModel()}>
          {t('embedSave')}
        </button>
      </div>
      <p className="dim small">{embed ? `${t('embedModel')}: ${embed}` : t('embedNone')}</p>
    </>
  );
}
