/**
 * Fase 12: the keyboard side of the pro trim tools (shared/videoEdit.ts) on the selected clip.
 *  Alt+← / Alt+→   slip by a frame (Shift: 10)
 *  , / .           slide by a frame (Shift: 10)
 *  Q / W           ripple trim the start / end to the playhead
 *  R               roll the cut of the selected clip nearest to the playhead onto it
 */
import { clipEnd, nextAdjacent, prevAdjacent } from '../../../shared/video';
import type { Clip, VideoProject } from '../../../shared/video';
import { rippleTrim, rollEdit, slideClip, slipClip } from '../../../shared/videoEdit';
import { toast } from '../../store';
import { tp } from './proStrings';
import { commit, commitMerged, getV } from './videoStore';

function selected(): { p: VideoProject; c: Clip } | null {
  const s = getV();
  const c = s.project.clips.find((x) => x.id === s.selection[0]);
  if (!c || s.selection.length !== 1) {
    toast(tp('needOne'));
    return null;
  }
  return { p: s.project, c };
}

/** Repeated presses of the same nudge fold into one undo step. */
function apply(next: VideoProject, p: VideoProject, label: string, merged: boolean): void {
  if (next === p) return toast(tp('cantTrim'));
  (merged ? commitMerged : commit)(next, label);
}

export function slipSelected(frames: number): void {
  const r = selected();
  if (!r) return;
  const next = slipClip(r.p, r.c.id, frames / r.p.fps);
  apply(next, r.p, `${tp('editSlip')} ${r.c.id}`, true);
}

export function slideSelected(frames: number): void {
  const r = selected();
  if (!r) return;
  const next = slideClip(r.p, r.c.id, frames / r.p.fps);
  apply(next, r.p, `${tp('editSlide')} ${r.c.id}`, true);
}

export function rippleToPlayhead(edge: 'left' | 'right'): void {
  const r = selected();
  if (!r) return;
  const next = rippleTrim(r.p, r.c.id, edge, getV().playhead);
  apply(next, r.p, tp('editRipple'), false);
}

export function rollToPlayhead(): void {
  const r = selected();
  if (!r) return;
  const t = getV().playhead;
  const prev = prevAdjacent(r.p, r.c);
  const next = nextAdjacent(r.p, r.c);
  // The cut nearest to the playhead: the clip's start (with the one before) or its end.
  const useStart = prev && (!next || Math.abs(t - r.c.start) < Math.abs(t - clipEnd(r.c)));
  const left = useStart ? prev : next ? r.c : null;
  if (!left) return toast(tp('noCut'));
  apply(rollEdit(r.p, left.id, t), r.p, tp('editRoll'), false);
}
