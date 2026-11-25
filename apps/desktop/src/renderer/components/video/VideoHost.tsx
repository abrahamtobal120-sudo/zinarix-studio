/**
 * The always-mounted part of Video Studio: the shortcut, the agent bridge, the minimized pill and
 * the recording bar. C2: the studio itself (timeline, viewer, panels, three.js) is loaded the
 * first time it opens.
 */
import { useEffect, useState } from 'react';
import { lazyNamed } from '../../lazy';
import { Icon } from '../Icon';
import { Studio3DHost } from '../three/Host3D';
import { RecordBar } from './RecordDialog';
import { tv } from './strings';
import { wireVideoAgent } from './videoAgent';
import { openStudio, toggleStudio, useV, wireJobs } from './videoStore';
import './video.css';

const VideoStudio = lazyNamed(() => import('./VideoStudio'), 'VideoStudio');

/** Mounted from the first time the studio opens, so closing it keeps everything as it was. */
export function VideoStudioHost() {
  const open = useV((s) => s.open);
  // Fase 13B: the agent's video_* tools work even before the studio is first opened.
  useEffect(() => wireVideoAgent(), []);
  // Ctrl+Shift+V anywhere in the app (the menu has it too; toggleStudio ignores the double).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === 'KeyV') {
        e.preventDefault();
        e.stopPropagation();
        toggleStudio();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const minimized = useV((s) => s.minimized);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open && !minimized) {
      setMounted(true);
      wireJobs();
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
  }, [open, minimized]);
  return (
    <>
      {mounted && <VideoStudio shown={shown} visible={open && !minimized} />}
      <MiniPill />
      <RecordBar />
      <Studio3DHost />
    </>
  );
}

function MiniPill() {
  const open = useV((s) => s.open);
  const minimized = useV((s) => s.minimized);
  const running = useV((s) => s.jobs.find((j) => j.state === 'running' || j.state === 'queued'));
  if (open && !minimized) return null;
  if (!minimized && !running) return null;
  const pct = running ? Math.round(running.progress * 100) : null;
  return (
    <button className="vs-pill" onClick={() => void openStudio()} title={tv('restore')}>
      <Icon name="film" size={15} />
      {pct != null ? tv('rendering', { pct }) : tv('title')}
      {pct != null && (
        <span className="vs-pill-bar">
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
    </button>
  );
}
