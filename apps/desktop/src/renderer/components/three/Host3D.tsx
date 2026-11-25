/**
 * The always-mounted part of the 3D studio. C2: three.js and the studio itself are loaded the
 * first time the studio opens or the agent asks for a 3D render, not when the app starts.
 */
import { useEffect } from 'react';
import { api } from '../../store';
import { lazyNamed } from '../../lazy';
import { use3 } from './store3d';
import { t3 } from './strings3d';
import './studio3d.css';

const Studio3D = lazyNamed(() => import('./Studio3D'), 'Studio3D');

let wired = false;
/** The agent's 3D tools work before the studio is first opened: forward its events, in order. */
function wireAgent3d(): void {
  if (wired) return;
  wired = true;
  api().on((ev) => {
    if (ev.type !== 'scene3d:agent' && ev.type !== 'scene3d:edit' && ev.type !== 'scene3d:imported')
      return;
    void import('./actions3d').then((m) => m.onAgent3dEvent(ev));
  });
}

export function Studio3DHost() {
  const open = use3((s) => s.open);
  useEffect(() => wireAgent3d(), []);
  const render = use3((s) => s.render);
  return (
    <>
      {open && <Studio3D />}
      {!open && render && <RenderPill />}
    </>
  );
}

function RenderPill() {
  const r = use3((s) => s.render)!;
  return (
    <div className="s3-pill" role="status">
      <span>{r.label}</span>
      <button type="button" className="s3-btn" onClick={r.cancel}>
        {t3('cancel')}
      </button>
    </div>
  );
}
