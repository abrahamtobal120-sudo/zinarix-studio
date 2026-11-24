import { useState } from 'react';
import type { DesignSelection, DesignSrc } from '../../../shared/design';
import { t } from '../../i18n';
import { Icon } from '../Icon';
import { tagName } from './names';

/**
 * Right column in live/built mode: what is selected and a box to ask the AI to change it
 * (the page is produced by the project's code, so the AI edits that code).
 */
export function LiveProps(props: {
  sel: DesignSelection | null;
  onAsk: (what: string) => void;
  onParent: (src: DesignSrc) => void;
}) {
  const { sel } = props;
  const [text, setText] = useState('');
  if (!sel) return <div className="dz-muted dz-pad">{t('dzLiveHint')}</div>;
  const ask = () => {
    if (!text.trim()) return;
    props.onAsk(text);
    setText('');
  };
  return (
    <div className="dz-live-props">
      <div className="dz-live-sel">
        <strong>{tagName(sel.tag)}</strong>
        {sel.text && <span> «{sel.text}»</span>}
      </div>
      {sel.parents.length > 0 && (
        <div className="dz-live-crumbs">
          {sel.parents
            .slice(0, 4)
            .reverse()
            .map((p) => (
              <button
                key={p.src}
                className="link"
                onClick={() => props.onParent(p.src)}
                title={p.text}
              >
                {tagName(p.tag)}
              </button>
            ))}
        </div>
      )}
      <p className="dz-muted">{t('dzLiveSelHint')}</p>
      <textarea
        value={text}
        rows={4}
        placeholder={t('dzLiveAskPh')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            ask();
          }
        }}
      />
      <div className="dz-live-chips">
        {t('dzLiveSuggest')
          .split(',')
          .map((s) => (
            <button key={s} onClick={() => setText(s)}>
              {s.replace(/:\s*$/, '')}
            </button>
          ))}
      </div>
      <button className="primary" disabled={!text.trim()} onClick={ask}>
        <Icon name="sparkle" size={14} /> {t('dzAskAiDo')}
      </button>
    </div>
  );
}
