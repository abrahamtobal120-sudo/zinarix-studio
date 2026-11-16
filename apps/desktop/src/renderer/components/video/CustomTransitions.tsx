/**
 * The Transitions tab, custom part: the user's library (made by the AI or imported), the ones
 * shared in the Zinarix Studio repository, and "Share on GitHub" for one's own.
 */
import { useEffect, useRef } from 'react';
import type { Clip } from '../../../shared/video';
import { setTransition } from '../../../shared/video';
import { TRANSITION_DEFAULT } from '../../../shared/videoFx';
import {
  customLook,
  mergeDefs,
  shareUrl,
  type TransitionDef,
} from '../../../shared/videoTransitions';
import { confirmDialog } from '../../confirm';
import { api, toast } from '../../store';
import { tv } from './strings';
import {
  BUNDLED,
  deleteTransition,
  importTransition,
  refreshCommunity,
  useTransitionLibrary,
} from './transitionLibrary';
import { commit, getV } from './videoStore';

/** A looping sample of the transition on the card (same curves as the preview). */
function Sample({ def }: { def: TransitionDef }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !el.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const frames: Keyframe[] = [];
    for (let i = 0; i <= 20; i++) {
      const l = customLook(def, i / 20);
      frames.push({
        offset: (i / 20) * 0.75,
        opacity: l.alpha,
        transform: `translate(${l.dx * 100}%, ${l.dy * 100}%) scale(${l.scale})`,
        clipPath: `inset(0 ${(1 - l.reveal) * 100}% 0 0)`,
      });
    }
    frames.push({ offset: 1, opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0)' });
    const a = el.animate(frames, { duration: 1800, iterations: Infinity });
    return () => a.cancel();
  }, [def]);
  return (
    <span className="vs-fx-swatch vs-tr-sample" aria-hidden="true">
      <i ref={ref} className="vs-tr-custom" />
    </span>
  );
}

function Card({ def, targets, mine }: { def: TransitionDef; targets: Clip[]; mine: boolean }) {
  const apply = () => {
    let p = getV().project;
    for (const c of targets)
      p = setTransition(p, c.id, {
        kind: 'custom',
        d: c.transition?.d ?? TRANSITION_DEFAULT,
        def,
      });
    commit(p, tv('editTransition'));
    toast(tv('fxApplied', { what: def.name, n: targets.length }));
  };
  const share = async () => {
    if (!(await confirmDialog(tv('trShareConfirm', { name: def.name })))) return;
    await api().app.openExternal(shareUrl(def));
  };
  return (
    <div className="vs-tr-item">
      <button
        className="vs-fx-card"
        disabled={!targets.length}
        title={def.description ?? def.name}
        onClick={apply}
      >
        <Sample def={def} />
        <span className="vs-fx-name">{def.name}</span>
      </button>
      {mine && (
        <div className="vs-tr-actions">
          <button className="vs-mini" title={tv('trShare')} onClick={() => void share()}>
            {tv('trShare')}
          </button>
          <button
            className="vs-mini"
            title={tv('trDelete')}
            aria-label={tv('trDelete')}
            onClick={() => deleteTransition(def.id)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export function CustomTransitions({ targets }: { targets: Clip[] }) {
  const lib = useTransitionLibrary();
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (lib.remote === 'idle') void refreshCommunity();
  }, [lib.remote]);
  const mineIds = new Set(lib.mine.map((d) => d.id));
  const shared = mergeDefs(BUNDLED, lib.community).filter((d) => !mineIds.has(d.id));
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = importTransition(await f.text());
    if ('error' in r) toast(r.error);
    else toast(tv('trImported', { name: r.name }));
  };
  return (
    <>
      <div className="vs-panel-sub vs-sub-row">
        <span>{tv('trMine')}</span>
        <button className="vs-mini" onClick={() => file.current?.click()}>
          {tv('trImport')}
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {lib.mine.length ? (
        <div className="vs-fx-grid">
          {lib.mine.map((d) => (
            <Card key={d.id} def={d} targets={targets} mine />
          ))}
        </div>
      ) : (
        <p className="vs-dim vs-note">{tv('trMineEmpty')}</p>
      )}
      <div className="vs-panel-sub vs-sub-row">
        <span>{tv('trCommunity')}</span>
        <button
          className="vs-mini"
          disabled={lib.remote === 'loading'}
          onClick={() => void refreshCommunity(true)}
        >
          {tv('trRefresh')}
        </button>
      </div>
      {shared.length ? (
        <div className="vs-fx-grid">
          {shared.map((d) => (
            <Card key={d.id} def={d} targets={targets} mine={false} />
          ))}
        </div>
      ) : (
        <p className="vs-dim vs-note">
          {lib.remote === 'error' ? tv('trCommunityError') : tv('trCommunityEmpty')}
        </p>
      )}
    </>
  );
}
