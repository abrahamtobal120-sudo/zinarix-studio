import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, WheelEvent } from 'react';
import { t } from '../i18n';
import { languageFor, monaco } from '../monaco';
import { MAX_EDITABLE, api, openLargeInEditor, type Tab } from '../store';
import { EDITABLE_EXT } from '../../shared/imageEdit';
import { ImageEditor } from './image/ImageEditor';
import { ti } from './image/imageStrings';
import { PaintView } from './paint/PaintView';
import { tg } from './graphics/graphicsStrings';
import { Icon } from './Icon';

/** Human size: 1.2 MB, 340 KB… */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

const CHUNK = 8 * 1024 * 1024;
/** Pictures bigger than this are not loaded into memory (only shown in hex). */
const MAX_IMAGE = 256 * 1024 * 1024;

const MIME: Record<string, string> = {
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

/** Picks the viewer of a tab; images and big text can also be looked at as hex. */
export function FileViewerPane({ tab }: { tab: Tab }) {
  const [mode, setMode] = useState<'main' | 'hex'>(tab.viewer === 'hex' ? 'hex' : 'main');
  useEffect(() => setMode(tab.viewer === 'hex' ? 'hex' : 'main'), [tab.path, tab.viewer]);
  const size = tab.size ?? 0;
  const showHex = mode === 'hex' || tab.viewer === 'hex';
  return (
    <div className="viewer-pane">
      <div className="viewer-bar">
        <span className="viewer-kind">
          {tab.viewer === 'image'
            ? t('viewerImage')
            : tab.viewer === 'large'
              ? t('viewerLarge')
              : t('viewerBinary')}
        </span>
        <span className="viewer-dim">{formatBytes(size)}</span>
        <div className="spacer" />
        {tab.viewer !== 'hex' && (
          <div className="viewer-seg">
            <button className={!showHex ? 'on' : ''} onClick={() => setMode('main')}>
              {tab.viewer === 'image' ? t('viewerImage') : t('viewerText')}
            </button>
            <button className={showHex ? 'on' : ''} onClick={() => setMode('hex')}>
              Hex
            </button>
          </div>
        )}
      </div>
      {showHex ? (
        <HexViewer path={tab.path} size={size} />
      ) : tab.viewer === 'image' ? (
        <ImageViewer path={tab.path} size={size} />
      ) : (
        <LargeTextViewer path={tab.path} size={size} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- image

function ImageViewer({ path, size }: { path: string; size: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  // Fase 1A: the editor works on the same bytes; "rev" reads the file again after replacing it.
  const [editing, setEditing] = useState(false);
  // Fase 3A: paint over the picture (layers), saved as a .zdraw next to it.
  const [painting, setPainting] = useState(false);
  const [rev, setRev] = useState(0);
  const editable = EDITABLE_EXT.has(path.split('.').pop()?.toLowerCase() ?? '');

  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setUrl(null);
    setError(null);
    setNatural(null);
    setZoom('fit');
    if (size > MAX_IMAGE) {
      setError(t('imageTooLarge'));
      return;
    }
    void (async () => {
      try {
        const parts: Uint8Array<ArrayBuffer>[] = [];
        let offset = 0;
        // The size of the file now (the tab's may be stale after the editor replaced it).
        let total = size;
        while (offset < total || offset === 0) {
          const { bytes, size: now } = await api().workspace.readBytes(path, offset, CHUNK);
          if (!alive) return;
          total = Math.min(now, MAX_IMAGE);
          if (bytes.length === 0) break;
          parts.push(bytes);
          offset += bytes.length;
          setProgress(total ? offset / total : 1);
        }
        const ext = path.split('.').pop()?.toLowerCase() ?? '';
        made = URL.createObjectURL(new Blob(parts, { type: MIME[ext] ?? 'image/*' }));
        if (alive) setUrl(made);
      } catch (e) {
        if (alive) setError(String((e as Error).message ?? e));
      }
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path, size, rev]);

  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey || !natural) return;
    e.preventDefault();
    const cur = zoom === 'fit' ? 1 : zoom;
    setZoom(Math.min(32, Math.max(0.05, cur * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
  };

  if (error) return <div className="notice-pane">{error}</div>;
  if (painting && url) return <PaintView path={path} source={{ url }} onClose={() => setPainting(false)} />;
  if (editing && url)
    return (
      <ImageEditor
        path={path}
        url={url}
        onClose={() => setEditing(false)}
        onReplaced={() => {
          setEditing(false);
          setRev((r) => r + 1);
        }}
      />
    );
  return (
    <div className="image-viewer">
      <div className="image-tools">
        {editable && (
          <button className="on" disabled={!url} title={ti('editHint')} onClick={() => setEditing(true)}>
            ✎ {ti('edit')}
          </button>
        )}
        <button disabled={!url} title={tg('paintFromHint')} onClick={() => setPainting(true)}>
          <Icon name="brush" size={14} /> {tg('paintFrom')}
        </button>
        <button className={zoom === 'fit' ? 'on' : ''} onClick={() => setZoom('fit')}>
          {t('zoomFit')}
        </button>
        <button className={zoom === 1 ? 'on' : ''} onClick={() => setZoom(1)}>
          100%
        </button>
        <button onClick={() => setZoom((z) => Math.max(0.05, (z === 'fit' ? 1 : z) / 1.25))}>
          −
        </button>
        <button onClick={() => setZoom((z) => Math.min(32, (z === 'fit' ? 1 : z) * 1.25))}>
          +
        </button>
        {zoom !== 'fit' && <span className="viewer-dim">{Math.round(zoom * 100)}%</span>}
        {natural && (
          <span className="viewer-dim">
            {natural.w} × {natural.h} px
          </span>
        )}
      </div>
      <div className={`image-stage ${zoom === 'fit' ? 'fit' : ''}`} onWheel={onWheel}>
        {url ? (
          <img
            src={url}
            alt={path}
            draggable={false}
            onLoad={(e) =>
              setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            onError={() => setError(t('imageBroken'))}
            style={
              zoom === 'fit' || !natural
                ? undefined
                : { width: natural.w * zoom, height: natural.h * zoom, maxWidth: 'none' }
            }
          />
        ) : (
          <span className="viewer-dim">
            {t('loading')} {Math.round(progress * 100)}%
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- hex

const ROW = 16;
const ROW_H = 20;
const PAGE = 64 * 1024;
const MAX_PAGES = 64;
/** Browsers cap element height (~33M px), so huge files scroll on a scaled track. */
const MAX_TRACK = 8_000_000;

function HexViewer({ path, size }: { path: string; size: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pages = useRef(new Map<number, Uint8Array>());
  const loading = useRef(new Set<number>());
  const [, bump] = useState(0);
  const [firstRow, setFirstRow] = useState(0);
  const [viewRows, setViewRows] = useState(30);
  const [goto, setGoto] = useState('');

  const totalRows = Math.max(1, Math.ceil(size / ROW));
  const trackH = Math.min(totalRows * ROW_H, MAX_TRACK);
  const maxFirst = Math.max(0, totalRows - viewRows + 1);

  useEffect(() => {
    pages.current.clear();
    loading.current.clear();
    setFirstRow(0);
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [path]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewRows(Math.ceil(el.clientHeight / ROW_H) + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const room = el.scrollHeight - el.clientHeight;
    const ratio = room > 0 ? el.scrollTop / room : 0;
    setFirstRow(Math.round(ratio * maxFirst));
  };

  const scrollToRow = (row: number) => {
    const el = scroller.current;
    if (!el) return;
    const r = Math.max(0, Math.min(row, maxFirst));
    const room = el.scrollHeight - el.clientHeight;
    el.scrollTop = maxFirst > 0 ? (r / maxFirst) * room : 0;
    setFirstRow(r);
  };

  // Load the 64 KB pages the visible rows need; drop old ones past MAX_PAGES.
  useEffect(() => {
    const from = Math.floor((firstRow * ROW) / PAGE);
    const to = Math.floor(Math.min(size - 1, (firstRow + viewRows) * ROW) / PAGE);
    for (let p = from; p <= to; p++) {
      if (pages.current.has(p) || loading.current.has(p)) continue;
      loading.current.add(p);
      void api()
        .workspace.readBytes(path, p * PAGE, PAGE)
        .then(({ bytes }) => {
          pages.current.set(p, bytes);
          while (pages.current.size > MAX_PAGES) {
            const oldest = pages.current.keys().next().value as number;
            pages.current.delete(oldest);
          }
          bump((n) => n + 1);
        })
        .catch(() => undefined)
        .finally(() => loading.current.delete(p));
    }
  }, [firstRow, viewRows, path, size]);

  const byteAt = (i: number): number | undefined => {
    const page = pages.current.get(Math.floor(i / PAGE));
    return page?.[i % PAGE];
  };

  const rows: ReactElement[] = [];
  const offW = Math.max(8, size.toString(16).length);
  for (let r = firstRow; r < Math.min(totalRows, firstRow + viewRows); r++) {
    const start = r * ROW;
    let hex = '';
    let ascii = '';
    for (let c = 0; c < ROW; c++) {
      const i = start + c;
      if (i >= size) {
        hex += '   ';
        continue;
      }
      const b = byteAt(i);
      hex += b === undefined ? '.. ' : `${b.toString(16).padStart(2, '0')} `;
      if (c === 7) hex += ' ';
      ascii += b === undefined ? ' ' : b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·';
    }
    rows.push(
      <div className="hex-row" key={r}>
        <span className="hex-off">{start.toString(16).padStart(offW, '0')}</span>
        <span className="hex-bytes">{hex}</span>
        <span className="hex-ascii">{ascii}</span>
      </div>,
    );
  }

  const doGoto = () => {
    const v = goto.trim().toLowerCase();
    if (!v) return;
    const n = v.endsWith('%')
      ? Math.floor((parseFloat(v) / 100) * size)
      : v.startsWith('0x')
        ? parseInt(v.slice(2), 16)
        : parseInt(v, 10);
    if (Number.isFinite(n)) scrollToRow(Math.floor(Math.max(0, Math.min(n, size - 1)) / ROW));
  };

  return (
    <div className="hex-viewer">
      <div className="image-tools">
        <input
          className="viewer-input"
          placeholder={t('gotoOffset')}
          value={goto}
          onChange={(e) => setGoto(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doGoto()}
        />
        <button onClick={doGoto}>{t('go')}</button>
        <span className="viewer-dim">
          0x{(firstRow * ROW).toString(16)} / 0x{size.toString(16)}
        </span>
      </div>
      <div className="hex-scroller" ref={scroller} onScroll={onScroll}>
        <div style={{ height: trackH, position: 'relative' }}>
          <div className="hex-rows">{rows}</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- large text

const TEXT_PAGE = 1024 * 1024;

/**
 * Huge text files are read one ~1 MB page at a time into a read-only Monaco editor
 * (syntax colours and Ctrl+F work inside the page). Pages end on a line break.
 */
function LargeTextViewer({ path, size }: { path: string; size: number }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const history = useRef<number[]>([]);
  const [offset, setOffset] = useState(0);
  const [end, setEnd] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pct, setPct] = useState('');
  const language = useMemo(() => languageFor(path), [path]);

  useEffect(() => {
    if (!host.current) return;
    const ed = monaco.editor.create(host.current, {
      model: null,
      readOnly: true,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      lineNumbers: 'off',
      wordWrap: 'off',
      largeFileOptimizations: true,
    });
    editor.current = ed;
    return () => {
      ed.getModel()?.dispose();
      ed.dispose();
      editor.current = null;
    };
  }, []);

  /** Reads the page starting at `from`; `align` skips to the next line start first. */
  const load = useCallback(
    async (from: number, align: boolean) => {
      setBusy(true);
      setError(null);
      try {
        let start = Math.max(0, Math.min(from, size));
        let { bytes } = await api().workspace.readBytes(path, start, TEXT_PAGE);
        if (align && start > 0) {
          const nl = bytes.indexOf(10);
          if (nl >= 0 && nl < bytes.length - 1) {
            start += nl + 1;
            bytes = bytes.subarray(nl + 1);
          }
        }
        let stop = start + bytes.length;
        if (stop < size) {
          const nl = bytes.lastIndexOf(10);
          if (nl > 0) {
            bytes = bytes.subarray(0, nl + 1);
            stop = start + nl + 1;
          }
        }
        const text = new TextDecoder('utf-8').decode(bytes);
        const ed = editor.current;
        if (ed) {
          const old = ed.getModel();
          ed.setModel(monaco.editor.createModel(text, language));
          old?.dispose();
          ed.setScrollTop(0);
        }
        setOffset(start);
        setEnd(stop);
      } catch (e) {
        setError(String((e as Error).message ?? e));
      } finally {
        setBusy(false);
      }
    },
    [path, size, language],
  );

  useEffect(() => {
    history.current = [];
    void load(0, false);
  }, [load]);

  const next = () => {
    if (end >= size) return;
    history.current.push(offset);
    void load(end, false);
  };
  const prev = () => {
    const back = history.current.pop();
    if (back !== undefined) void load(back, false);
    else if (offset > 0) void load(Math.max(0, offset - TEXT_PAGE), true);
  };
  const jump = (fraction: number) => {
    history.current = [];
    void load(Math.floor(Math.max(0, Math.min(1, fraction)) * size), true);
  };

  const [opening, setOpening] = useState(false);
  const openFull = async () => {
    setOpening(true);
    try {
      await openLargeInEditor(path);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="large-viewer">
      <div className="image-tools">
        <button onClick={() => jump(0)} disabled={busy || offset === 0} title={t('firstPage')} aria-label={t('firstPage')}>
          <Icon name="skipBack" size={14} />
        </button>
        <button onClick={prev} disabled={busy || offset === 0}>
          ◀ {t('prevPage')}
        </button>
        <button onClick={next} disabled={busy || end >= size}>
          {t('nextPage')} ▶
        </button>
        <button
          onClick={() => jump(1 - TEXT_PAGE / Math.max(size, 1))}
          disabled={busy || end >= size}
          title={t('lastPage')}
          aria-label={t('lastPage')}
        >
          <Icon name="skipForward" size={14} />
        </button>
        <input
          className="viewer-input small"
          placeholder="%"
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && pct.trim()) jump(parseFloat(pct) / 100);
          }}
        />
        <span className="viewer-dim">
          {formatBytes(offset)} – {formatBytes(end)} / {formatBytes(size)} (
          {size ? Math.round((end / size) * 100) : 100}%)
        </span>
        <div className="spacer" />
        {size <= MAX_EDITABLE && (
          <button onClick={() => void openFull()} disabled={opening}>
            {opening ? t('loading') : t('openFullEditor')}
          </button>
        )}
      </div>
      {error && <div className="viewer-error">{error}</div>}
      <div className="large-host" ref={host} />
    </div>
  );
}
