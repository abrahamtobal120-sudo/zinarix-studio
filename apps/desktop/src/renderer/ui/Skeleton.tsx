import type { CSSProperties } from 'react';

/** Placeholder while something loads. Screen readers skip it: the caller says "loading". */
export function Skeleton({
  width,
  height = 12,
  radius,
  lines = 1,
}: {
  width?: number | string;
  height?: number | string;
  radius?: string;
  /** More than one draws a paragraph whose last line is shorter. */
  lines?: number;
}) {
  const n = Math.max(1, lines);
  const style = (last: boolean): CSSProperties => ({
    width: last && n > 1 ? '60%' : width,
    height,
    borderRadius: radius,
  });
  return (
    <span className="ui-skeleton-group" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="ui-skeleton" style={style(i === n - 1)} />
      ))}
    </span>
  );
}
