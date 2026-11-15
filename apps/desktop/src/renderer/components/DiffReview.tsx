import { useEffect, useMemo, useRef, useState } from 'react';
import type { RewindFileView, TurnDiffFileView } from '../../shared/api';
import { hunks, type Hunk } from '../../shared/checkpoints';
import { errText } from '../errText';
import { t } from '../i18n';
import { api, openFile, reloadFromDisk, toast } from '../store';
import { Icon } from './Icon';
import { ModalShell } from './ModalShell';
import './diff-review.css';

/**
 * Fase 2 — every file one agent exchange changed, as blocks of lines the user keeps or puts
 * back. Only that exchange's change is shown (later ones are not mixed in); rejected blocks
 * are undone in the file as it is now, so later changes stay.
 */
export function DiffReview({
  conversationId,
  turn,
  folder,
  onClose,
}: {
  conversationId: string;
  /** The exchange's request id. */
  turn: string;
  folder?: string;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<TurnDiffFileView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** path → rejected block numbers. */
  const [rejected, setRejected] = useState<Record<string, number[]>>({});
  const [saving, setSaving] = useState(false);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api()
      .ai.turnDiff(conversationId, turn, folder)
      .then(setFiles)
      .catch((e) => setError(errText(e)));
  }, [conversationId, turn, folder]);

  const blocks = useMemo(
    () =>
      new Map((files ?? []).map((f) => [f.path, hunks(f.before ?? '', f.after ?? '')] as const)),
    [files],
  );
  const total = [...blocks.values()].reduce((n, h) => n + h.length, 0);
  const nRejected = Object.values(rejected).reduce((n, r) => n + r.length, 0);

  const toggle = (path: string, index: number, reject: boolean) =>
    setRejected((r) => {
      const cur = new Set(r[path] ?? []);
      if (reject) cur.add(index);
      else cur.delete(index);
      return { ...r, [path]: [...cur] };
    });
  const setFile = (path: string, reject: boolean) =>
    setRejected((r) => ({ ...r, [path]: reject ? blocks.get(path)!.map((h) => h.index) : [] }));

  const apply = async () => {
    if (!files) return;
    setSaving(true);
    let done = 0;
    try {
      for (const f of files) {
        const rej = rejected[f.path] ?? [];
        if (!rej.length) continue;
        // The main side rebuilds the file from disk (a file created and rejected whole goes).
        await api().ai.applyReview(conversationId, turn, f.path, rej, folder);
        await reloadFromDisk(f.path);
        done++;
      }
      toast(t('reviewApplied', { n: done }));
      onClose();
    } catch (e) {
      toast(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const jump = (i: number) =>
    body.current
      ?.querySelector<HTMLElement>(`[data-file="${i}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });

  return (
    <ModalShell onClose={onClose} className="diff-review" labelledBy="diff-review-title">
      <div className="git-diff-head">
        <b id="diff-review-title">{t('reviewTitle')}</b>
        {files && (
          <span className="dim">
            {t('reviewSummary', { files: files.length, blocks: total, rejected: nRejected })}
          </span>
        )}
        <span className="spacer" />
        <button onClick={onClose} aria-label={t('close')} title={t('close')}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="diff-review-main">
        {files && files.length > 1 && (
          <nav className="diff-review-files" aria-label={t('reviewFiles')}>
            {files.map((f, i) => (
              <button key={f.path} onClick={() => jump(i)} title={f.path}>
                <span className="diff-review-name">{f.path.split(/[\\/]/).pop()}</span>
                {(rejected[f.path]?.length ?? 0) > 0 && (
                  <span className="diff-review-badge">{rejected[f.path]!.length}</span>
                )}
              </button>
            ))}
          </nav>
        )}
        <div className="diff-review-body" ref={body} aria-busy={files === null && !error}>
          {error && <div className="diff-review-empty">{error}</div>}
          {!error && files === null && <div className="diff-review-empty">{t('loading')}</div>}
          {files?.length === 0 && <div className="diff-review-empty">{t('reviewNothing')}</div>}
          {files?.map((f, i) => (
            <section key={f.path} className="diff-review-file" data-file={i}>
              <header>
                <b>{f.path}</b>
                {f.changedSince && (
                  <span className="changed-since" title={t('reviewChangedSinceTitle')}>
                    <Icon name="warning" size={12} /> {t('reviewChangedSince')}
                  </span>
                )}
                <span className="dim">
                  {f.before === null
                    ? t('reviewCreated')
                    : f.after === null
                      ? t('reviewDeleted')
                      : ''}
                </span>
                <span className="spacer" />
                <button onClick={() => void openFile(f.path)}>
                  <Icon name="file" size={12} /> {t('gitOpenFile')}
                </button>
                <button onClick={() => setFile(f.path, false)}>{t('reviewKeepAll')}</button>
                <button onClick={() => setFile(f.path, true)}>{t('reviewUndoAll')}</button>
              </header>
              {blocks.get(f.path)!.map((h) => (
                <HunkView
                  key={h.index}
                  hunk={h}
                  rejected={rejected[f.path]?.includes(h.index) ?? false}
                  onToggle={(r) => toggle(f.path, h.index, r)}
                />
              ))}
            </section>
          ))}
        </div>
      </div>
      <div className="diff-review-foot">
        <span className="dim">{t('reviewHint')}</span>
        <span className="spacer" />
        <button onClick={onClose}>{t('cancel')}</button>
        <button className="primary" disabled={!nRejected || saving} onClick={() => void apply()}>
          <Icon name="check" size={13} /> {t('reviewApply', { n: nRejected })}
        </button>
      </div>
    </ModalShell>
  );
}

const strip = (s: string) => s.replace(/\r?\n$/, '');

function HunkView({
  hunk,
  rejected,
  onToggle,
}: {
  hunk: Hunk;
  rejected: boolean;
  onToggle: (rejected: boolean) => void;
}) {
  return (
    <div className={`diff-review-hunk${rejected ? ' rejected' : ''}`}>
      <div className="diff-review-hunk-head">
        <code>
          @@ −{hunk.oldStart} +{hunk.newStart} @@ · +{hunk.added} −{hunk.removed}
        </code>
        <span className="spacer" />
        <button
          aria-pressed={!rejected}
          className={rejected ? '' : 'on'}
          onClick={() => onToggle(false)}
        >
          <Icon name="check" size={12} /> {t('reviewKeep')}
        </button>
        <button
          aria-pressed={rejected}
          className={rejected ? 'on' : ''}
          onClick={() => onToggle(true)}
        >
          <Icon name="undo" size={12} /> {t('reviewUndo')}
        </button>
      </div>
      <pre>
        {hunk.lines.map((l, k) => (
          <div key={k} className={`l-${l.kind}`}>
            <span className="sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
            {strip(l.text) || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}

export type RewindMode = 'both' | 'code' | 'chat';

/** "Volver aquí": what to put back as it was before this message. */
export function RewindDialog({
  edits,
  commands,
  preview,
  onPick,
  onClose,
}: {
  /** File changes the agent made from this message on (tool steps). */
  edits: number;
  /** Commands the agent ran from this message on (they are not undone). */
  commands: number;
  /** Loads the files a rewind would write back (null while it cannot be known). */
  preview?: () => Promise<RewindFileView[]>;
  onPick: (mode: RewindMode) => void;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<RewindFileView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!preview) return;
    let live = true;
    preview()
      .then((f) => live && setFiles(f))
      .catch((e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [preview]);
  const edited = files?.filter((f) => f.edited).length ?? 0;
  const pick = (m: RewindMode) => {
    onClose();
    onPick(m);
  };
  return (
    <ModalShell
      onClose={onClose}
      className="confirm-dialog rewind-dialog"
      labelledBy="rewind-title"
    >
      <b id="rewind-title">{t('rewindTitle')}</b>
      <p className="dim">{t('rewindIntro', { n: edits })}</p>
      {files && files.length > 0 && (
        <ul className="rewind-files" aria-label={t('rewindFilesTitle')}>
          {files.map((f) => (
            <li key={f.path}>
              <code title={f.path}>{f.path}</code>
              {f.action === 'delete' && <span className="dim">{t('rewindDelete')}</span>}
              {f.edited && <span className="edited">{t('rewindEdited')}</span>}
            </li>
          ))}
        </ul>
      )}
      {files?.length === 0 && edits > 0 && <p className="dim">{t('rewindNoFiles')}</p>}
      {error && (
        <p className="rewind-warn" role="alert">
          <Icon name="warning" size={13} /> {error}
        </p>
      )}
      {edited > 0 && (
        <p className="rewind-warn" role="note">
          <Icon name="warning" size={13} /> {t('rewindEditedWarn', { n: edited })}
        </p>
      )}
      {commands > 0 && (
        <p className="rewind-warn" role="note">
          <Icon name="warning" size={13} /> {t('rewindCommands', { n: commands })}
        </p>
      )}
      <div className="rewind-options">
        <button className="primary" onClick={() => pick('both')} autoFocus>
          <Icon name="undo" size={13} /> {t('rewindBoth')}
        </button>
        <button onClick={() => pick('code')}>{t('rewindCode')}</button>
        <button onClick={() => pick('chat')}>{t('rewindChat')}</button>
        <button onClick={onClose}>{t('cancel')}</button>
      </div>
    </ModalShell>
  );
}
