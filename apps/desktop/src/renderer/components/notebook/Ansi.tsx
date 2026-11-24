import { memo, type CSSProperties } from 'react';
import { ansiSpans } from '../../../shared/notebook';
import './ansi.css';

/** Over this, the text is shown plain (styling a megabyte of log costs more than it gives). */
const MAX_STYLED = 300_000;

/**
 * Text printed with ANSI colors (IPython tracebacks, colored logs) as styled spans. The 16
 * terminal colors map to the theme's colors (classes); 256-color and true color come inline.
 */
export const AnsiText = memo(function AnsiText({ text }: { text: string }) {
  if (!text.includes('\u001b')) return <>{text}</>;
  if (text.length > MAX_STYLED)
    return (
      <>
        {ansiSpans(text)
          .map((s) => s.text)
          .join('')}
      </>
    );
  return (
    <>
      {ansiSpans(text).map((s, i) => {
        const cls: string[] = [];
        const style: CSSProperties = {};
        if (typeof s.fg === 'number') cls.push(`ansi-fg-${s.fg}`);
        else if (s.fg) style.color = s.fg;
        if (typeof s.bg === 'number') cls.push(`ansi-bg-${s.bg}`);
        else if (s.bg) style.background = s.bg;
        if (s.bold) cls.push('ansi-b');
        if (s.dim) cls.push('ansi-dim');
        if (s.italic) cls.push('ansi-i');
        if (s.underline) cls.push('ansi-u');
        if (!cls.length && !style.color && !style.background) return s.text;
        return (
          <span
            key={i}
            className={cls.join(' ') || undefined}
            style={style.color || style.background ? style : undefined}
          >
            {s.text}
          </span>
        );
      })}
    </>
  );
});
