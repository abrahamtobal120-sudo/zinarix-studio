import { useState } from 'react';
import type { MediaItem, MediaKind } from '../../../shared/video';
import { api } from '../../store';
import { Icon, type IconName } from '../Icon';
import { fmtBytes, fmtDuration, tv } from './strings';
import { addToTimeline, importPaths, relinkMedia, removeMedia, useV } from './videoStore';

export const MEDIA_DRAG = 'application/x-zinarix-video-media';

const KIND_ICON: Record<MediaKind, IconName> = { video: 'play', audio: 'chart', image: 'image' };

export async function pickAndImport(): Promise<void> {
  const paths = await api().video.pickMedia();
  if (paths.length) await importPaths(paths);
}

export function MediaLibrary() {
  const media = useV((s) => s.project.media);
  const thumbs = useV((s) => s.thumbs);
  const importing = useV((s) => s.importing);
  const usage = useV((s) => {
    const n: Record<string, number> = {};
    for (const c of s.project.clips) n[c.mediaId] = (n[c.mediaId] ?? 0) + 1;
    return JSON.stringify(n);
  });
  const used = JSON.parse(usage) as Record<string, number>;
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<MediaKind | 'all'>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [over, setOver] = useState(false);

  const shown = media.filter(
    (m) =>
      (kind === 'all' || m.kind === kind) && (!q || m.name.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div
      className={`vs-library ${over ? 'vs-drop-over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const paths = [...e.dataTransfer.files]
          .map((f) => api().app.pathForFile(f))
          .filter(Boolean);
        void importPaths(paths);
      }}
    >
      <div className="vs-lib-head">
        <button
          className="primary vs-import"
          title={tv('importHint')}
          onClick={() => void pickAndImport()}
        >
          <Icon name="plus" size={14} /> {tv('import')}
        </button>
        <div className="vs-seg" role="group" aria-label={tv('list')}>
          <button
            className={view === 'grid' ? 'on' : ''}
            title={tv('grid')}
            aria-label={tv('grid')}
            onClick={() => setView('grid')}
          >
            <Icon name="columns" size={14} />
          </button>
          <button
            className={view === 'list' ? 'on' : ''}
            title={tv('list')}
            aria-label={tv('list')}
            onClick={() => setView('list')}
          >
            <Icon name="menu" size={14} />
          </button>
        </div>
      </div>
      <input
        className="vs-search"
        placeholder={tv('searchMedia')}
        aria-label={tv('searchMedia')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="vs-chips" role="group">
        {(['all', 'video', 'audio', 'image'] as const).map((k) => (
          <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {tv(k)}
          </button>
        ))}
      </div>
      {importing.map((n) => (
        <div key={n} className="vs-importing">
          <span className="vs-spinner" /> {tv('importing', { name: n })}
        </div>
      ))}
      {!media.length && !importing.length ? (
        <div className="vs-lib-empty">
          <Icon name="download" size={28} />
          <p>{tv('dropHere')}</p>
        </div>
      ) : (
        <div className={view === 'grid' ? 'vs-grid' : 'vs-list'}>
          {shown.map((m) => (
            <MediaCard key={m.id} m={m} thumb={thumbs[m.id]} used={used[m.id] ?? 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function MediaCard({ m, thumb, used }: { m: MediaItem; thumb?: string; used: number }) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  // Hovering scrubs through the thumbnail strip (24 frames).
  const frame = hoverX == null ? 4 : Math.min(23, Math.floor(hoverX * 24));
  const strip = m.kind === 'video' && thumb;
  return (
    <div
      className={`vs-card ${m.missing ? 'vs-missing' : ''}`}
      draggable={!m.missing}
      tabIndex={0}
      title={m.path}
      onDragStart={(e) => {
        e.dataTransfer.setData(MEDIA_DRAG, m.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDoubleClick={() => !m.missing && addToTimeline(m)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !m.missing) addToTimeline(m);
        if (e.key === 'Delete') void removeMedia(m);
      }}
    >
      <div
        className="vs-thumb"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHoverX((e.clientX - r.left) / r.width);
        }}
        onMouseLeave={() => setHoverX(null)}
        style={
          strip
            ? {
                backgroundImage: `url("${thumb}")`,
                backgroundSize: '2400% 100%',
                backgroundPosition: `${(frame / 23) * 100}% 0`,
              }
            : thumb
              ? {
                  backgroundImage: `url("${thumb}")`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }
              : undefined
        }
      >
        {!thumb && <Icon name={KIND_ICON[m.kind]} size={22} />}
        {m.kind !== 'image' && <span className="vs-badge">{fmtDuration(m.duration)}</span>}
        {used > 0 && <span className="vs-used" title={`${used}`} />}
      </div>
      <div className="vs-card-body">
        <div className="vs-card-name">{m.name}</div>
        <div className="vs-dim vs-card-meta">
          {m.missing ? (
            <span className="vs-warn">{tv('missing')}</span>
          ) : (
            <>
              {m.width ? `${m.width}×${m.height}` : tv(m.kind)}
              {m.fps ? ` · ${Math.round(m.fps * 100) / 100} fps` : ''} · {fmtBytes(m.size)}
            </>
          )}
        </div>
      </div>
      <div className="vs-card-actions">
        {m.missing ? (
          <button onClick={() => void relinkMedia(m)}>{tv('relink')}</button>
        ) : (
          <button
            className="vs-icon-btn"
            title={tv('addToTimeline')}
            aria-label={tv('addToTimeline')}
            onClick={() => addToTimeline(m)}
          >
            <Icon name="plus" size={14} />
          </button>
        )}
        <button
          className="vs-icon-btn"
          title={tv('removeMedia')}
          aria-label={tv('removeMedia')}
          onClick={() => void removeMedia(m)}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  );
}
