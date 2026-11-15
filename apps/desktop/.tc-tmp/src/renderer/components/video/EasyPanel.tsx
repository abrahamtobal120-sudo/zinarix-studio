/**
 * Left-panel tab of phase 11 ("Fácil"): Magic video, themes and Ken Burns. Every action is one
 * undoable edit of the pure model (shared/videoEasy.ts).
 */
import { useState } from 'react';
import type { Track } from '../../../shared/video';
import { trackOf } from '../../../shared/video';
import type { KenBurnsKind } from '../../../shared/videoEasy';
import {
  DUCK_DEFAULT,
  KEN_BURNS_KINDS,
  MAGIC_DEFAULT,
  VIDEO_THEMES,
  applyTheme,
  kenBurns,
  magicVideo,
  setTrackDuck,
} from '../../../shared/videoEasy';
import { toast } from '../../store';
import { type EasyKey, te } from './easyStrings';
import { commit, commitMerged, getV, setV, useV } from './videoStore';
import './video-fx.css';
import './easy.css';

export function EasyPanel() {
  return (
    <div className="vs-fx-panel">
      <div className="vs-panel-title">{te('tab')}</div>
      <MagicSection />
      <ThemeSection />
      <KenBurnsSection />
    </div>
  );
}

function MagicSection() {
  const media = useV((s) => s.project.media);
  const visuals = media.filter((m) => !m.missing && (m.kind === 'image' || m.kind === 'video'));
  const songs = media.filter((m) => !m.missing && m.kind === 'audio');
  const [order, setOrder] = useState<string[]>([]);
  const [music, setMusic] = useState('');
  const [theme, setTheme] = useState(VIDEO_THEMES[0]!.id);
  const [title, setTitle] = useState('');
  const [dur, setDur] = useState(MAGIC_DEFAULT);
  const picked = order.filter((id) => visuals.some((m) => m.id === id));
  const toggle = (id: string) =>
    setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));

  const build = () => {
    if (!picked.length) return toast(te('needPick'));
    const r = magicVideo(getV().project, {
      mediaIds: picked,
      musicId: music || undefined,
      themeId: theme,
      title,
      duration: dur,
    });
    if (!r) return toast(te('needPick'));
    commit(r.project, te('editMagic'));
    setV({ selection: r.clipIds });
    toast(te('built', { n: picked.length, s: Math.round(r.duration) }));
  };

  return (
    <section className="vs-easy-sec" aria-label={te('magicTitle')}>
      <h4>{te('magicTitle')}</h4>
      <p className="vs-dim vs-note">{te('magicHint')}</p>
      {!visuals.length ? (
        <p className="vs-dim vs-note">{te('noMedia')}</p>
      ) : (
        <>
          <div className="vs-easy-field">
            <span>{te('pick')}</span>
            <div className="vs-easy-list" role="group" aria-label={te('pick')}>
              {visuals.map((m) => {
                const i = picked.indexOf(m.id);
                return (
                  <label key={m.id} className="vs-easy-item">
                    <input type="checkbox" checked={i >= 0} onChange={() => toggle(m.id)} />
                    <span className="vs-easy-order">{i >= 0 ? i + 1 : ''}</span>
                    <span className="vs-ellipsis" title={m.path}>
                      {m.name}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          <label className="vs-easy-field">
            <span>{te('music')}</span>
            <select className="vs-select" value={music} onChange={(e) => setMusic(e.target.value)}>
              <option value="">{te('noMusic')}</option>
              {songs.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="vs-easy-field">
            <span>{te('theme')}</span>
            <select className="vs-select" value={theme} onChange={(e) => setTheme(e.target.value)}>
              {VIDEO_THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {te(`th_${t.id}` as EasyKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="vs-easy-field">
            <span>{te('titleText')}</span>
            <input
              value={title}
              maxLength={200}
              placeholder={te('titlePh')}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="vs-easy-field">
            <span>{te('duration')}</span>
            <input
              type="number"
              min={5}
              max={600}
              value={dur}
              onChange={(e) => setDur(Number(e.target.value) || MAGIC_DEFAULT)}
            />
          </label>
          <button className="primary" disabled={!picked.length} onClick={build}>
            {te('build')}
          </button>
        </>
      )}
    </section>
  );
}

function ThemeSection() {
  const project = useV((s) => s.project);
  const selection = useV((s) => s.selection);
  const sel = selection.filter((id) => {
    const c = project.clips.find((x) => x.id === id);
    return !!c && trackOf(project, c.trackId)?.kind === 'video';
  });
  const apply = (id: string) => {
    commit(applyTheme(getV().project, id, sel.length ? sel : undefined), te('editTheme'));
    toast(te('themeApplied', { what: te(`th_${id}` as EasyKey) }));
  };
  return (
    <section className="vs-easy-sec" aria-label={te('themesTitle')}>
      <h4>{te('themesTitle')}</h4>
      <p className="vs-dim vs-note">
        {te('themesHint')} {sel.length ? te('themeSel', { n: sel.length }) : te('themeAll')}
      </p>
      <div className="vs-easy-row">
        {VIDEO_THEMES.map((t) => (
          <button
            key={t.id}
            className="vs-mini"
            disabled={!project.clips.length}
            onClick={() => apply(t.id)}
          >
            {te(`th_${t.id}` as EasyKey)}
          </button>
        ))}
      </div>
    </section>
  );
}

function KenBurnsSection() {
  const project = useV((s) => s.project);
  const selection = useV((s) => s.selection);
  const targets = project.clips.filter(
    (c) => selection.includes(c.id) && !c.text && trackOf(project, c.trackId)?.kind === 'video',
  );
  const apply = (kind: KenBurnsKind) => {
    let p = getV().project;
    for (const c of targets) p = kenBurns(p, c.id, kind);
    commit(p, te('editKb'));
    toast(te('kbApplied', { n: targets.length }));
  };
  return (
    <section className="vs-easy-sec" aria-label={te('kbTitle')}>
      <h4>{te('kbTitle')}</h4>
      <p className="vs-dim vs-note">{targets.length ? te('kbHint') : te('needVisual')}</p>
      <div className="vs-easy-row">
        {KEN_BURNS_KINDS.map((k) => (
          <button key={k} className="vs-mini" disabled={!targets.length} onClick={() => apply(k)}>
            {te(`kb_${k}` as EasyKey)}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Ducking switch and level for a mixer strip. */
export function DuckControl({ track }: { track: Track }) {
  const on = track.duck !== undefined;
  const set = (level: number | undefined, merge = false) =>
    (merge ? commitMerged : commit)(
      setTrackDuck(getV().project, track.id, level),
      `${te('editDuck')} ${track.id}`,
    );
  return (
    <div className="vs-duck" title={te('duckHint')}>
      <label className="vs-duck">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => set(e.target.checked ? DUCK_DEFAULT : undefined)}
        />
        {te('duck')}
      </label>
      {on && (
        <>
          <input
            type="range"
            min={0}
            max={0.9}
            step={0.05}
            value={track.duck}
            aria-label={`${te('duckLevel')} · ${track.name}`}
            onChange={(e) => set(Number(e.target.value), true)}
          />
          <code>{track.duck! > 0 ? `${(20 * Math.log10(track.duck!)).toFixed(0)} dB` : '−∞'}</code>
        </>
      )}
    </div>
  );
}
