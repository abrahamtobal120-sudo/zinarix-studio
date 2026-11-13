import { useEffect, useState } from 'react';
import type { DocSourceView, MemoryView } from '../../shared/api';
import { t } from '../i18n';
import { api, toast, useStore } from '../store';
import { Icon } from './Icon';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Re-runs `load` now and whenever main says memories or docs changed. */
function useKnowledge<T>(load: () => Promise<T>, initial: T): [T, () => void] {
  const [value, setValue] = useState<T>(initial);
  const reload = () => void load().then(setValue).catch(() => undefined);
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
          placeholder={t('memPlaceholder')}
          maxLength={600}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <select value={scope} onChange={(e) => setScope(e.target.value as 'global' | 'project')}>
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
                onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                onKeyDown={async (e) => {
                  if (e.key === 'Escape') setEditing(null);
                  if (e.key === 'Enter' && editing.text.trim()) {
                    await api().knowledge.updateMemory(m.id, editing.text.trim());
                    setEditing(null);
                    reload();
                  }
                }}
                onBlur={() => setEditing(null)}
              />
            ) : (
              <span className="knowledge-text" onDoubleClick={() => setEditing({ id: m.id, text: m.text })}>
                {m.text}
              </span>
            )}
            <span className="knowledge-tag dim small">
              {m.scope === 'global' ? t('memGlobal') : projectName(m.project)}
            </span>
            <button title={t('memEdit')} onClick={() => setEditing({ id: m.id, text: m.text })}>
              <Icon name="edit" size={13} />
            </button>
            <button
              title={t('memDelete')}
              onClick={async () => {
                await api().knowledge.removeMemory(m.id);
                reload();
              }}
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
  const [embed, reloadEmbed] = useKnowledge<string | null>(() => api().knowledge.embedModel(), null);
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
          placeholder={t('docsName')}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          value={url}
          placeholder="https://…/docs/"
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && /^https?:\/\//.test(url.trim())) void add();
          }}
        />
        <button className="primary" disabled={!/^https?:\/\/\S+/.test(url.trim())} onClick={() => void add()}>
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
              disabled={d.status === 'indexing'}
              onClick={() => void api().knowledge.reindexDocs(d.id).then(reload)}
            >
              <Icon name="refresh" size={13} />
            </button>
            <button title={t('docsRemove')} onClick={() => void api().knowledge.removeDocs(d.id).then(reload)}>
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
