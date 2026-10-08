import { useEffect, useMemo, useState } from 'react';
import type { ConversationView } from '../../shared/api';
import { t } from '../i18n';
import { api, askText, toast, useStore } from '../store';
import { ProviderLogo } from './ProviderLogo';

function bucket(ts: number): string {
  const day = 86_400_000;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  if (ts >= today) return t('histToday');
  if (ts >= today - day) return t('histYesterday');
  if (ts >= today - 6 * day) return t('histWeek');
  if (ts >= today - 29 * day) return t('histMonth');
  return t('histOlder');
}

function when(ts: number): string {
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Saved conversations: search, project filter, open, rename, export and delete. */
export function ChatHistory({
  current,
  onOpen,
  onClose,
  onDeleted,
}: {
  current?: string;
  onOpen: (id: string) => void;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const workspace = useStore((s) => s.workspace);
  const [query, setQuery] = useState('');
  const [onlyProject, setOnlyProject] = useState(Boolean(workspace));
  const [list, setList] = useState<ConversationView[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setList(await api().ai.conversations(query, onlyProject && Boolean(workspace)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void load(), query ? 200 : 0);
    return () => clearTimeout(timer);
  }, [query, onlyProject, workspace?.root]);

  const groups = useMemo(() => {
    const out: [string, ConversationView[]][] = [];
    for (const c of list) {
      const b = bucket(c.updatedAt);
      const g = out.find((x) => x[0] === b);
      if (g) g[1].push(c);
      else out.push([b, [c]]);
    }
    return out;
  }, [list]);

  const rename = async (c: ConversationView) => {
    const title = (await askText(t('histRename'), c.title))?.trim();
    if (!title) return;
    await api().ai.renameConversation(c.id, title);
    await load();
  };

  const remove = async (c: ConversationView) => {
    if (!confirm(t('histDeleteConfirm', { title: c.title }))) return;
    await api().ai.deleteConversation(c.id);
    onDeleted(c.id);
    await load();
  };

  const exportMd = async (c: ConversationView) => {
    const path = await api().ai.exportConversation(c.id);
    if (path) toast(t('histExported', { path }));
  };

  return (
    <div className="chat-history">
      <div className="ch-head">
        <button className="ch-back" onClick={onClose} title={t('histBack')}>
          ←
        </button>
        <span className="ch-title">{t('histTitle')}</span>
      </div>
      <div className="ch-tools">
        <input
          autoFocus
          value={query}
          placeholder={t('histSearch')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
        />
        {workspace && (
          <div className="ch-scope" role="tablist">
            <button
              className={onlyProject ? 'on' : ''}
              onClick={() => setOnlyProject(true)}
              title={workspace.root}
            >
              📁 {workspace.name}
            </button>
            <button className={!onlyProject ? 'on' : ''} onClick={() => setOnlyProject(false)}>
              {t('histAll')}
            </button>
          </div>
        )}
      </div>
      <div className="ch-list">
        {!loading && list.length === 0 && (
          <p className="dim ch-empty">{query ? t('noMatches') : t('histEmpty')}</p>
        )}
        {groups.map(([label, items]) => (
          <div key={label}>
            <div className="ch-group">{label}</div>
            {items.map((c) => (
              <div
                key={c.id}
                className={`ch-item ${c.id === current ? 'active' : ''}`}
                onClick={() => onOpen(c.id)}
                title={c.project ?? ''}
              >
                {c.model ? (
                  <ProviderLogo id={c.model.split('/')[0]!} size={22} />
                ) : (
                  <span className="ch-dot">💬</span>
                )}
                <span className="ch-main">
                  <span className="ch-name">{c.title}</span>
                  <span className="ch-meta">
                    {when(c.updatedAt)} · {t('histMessages', { n: c.messageCount })}
                    {!onlyProject && c.project ? ` · ${c.project.split(/[\\/]/).pop()}` : ''}
                  </span>
                </span>
                <span className="ch-actions" onClick={(e) => e.stopPropagation()}>
                  <button title={t('histRename')} onClick={() => void rename(c)}>
                    ✏️
                  </button>
                  <button title={t('histExport')} onClick={() => void exportMd(c)}>
                    ⤓
                  </button>
                  <button title={t('histDelete')} onClick={() => void remove(c)}>
                    🗑
                  </button>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
