import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { toast, updatePrefs, useStore } from '../../store';
import './helper.css';

/** Same rule as main/helper.ts MODEL_NAME (main validates it again). */
const MODEL_NAME = /^[A-Za-z0-9][\w.\-/]{0,98}(:[\w.\-]{1,60})?$/;

/** Settings > Inteligencia artificial: show the help button, and its local model. */
export function HelperSettings() {
  const prefs = useStore((s) => s.prefs);
  const [model, setModel] = useState(prefs.helperModel);
  useEffect(() => setModel(prefs.helperModel), [prefs.helperModel]);
  const save = () => {
    const m = model.trim();
    if (m === prefs.helperModel) return;
    if (!MODEL_NAME.test(m)) {
      toast(t('hlpSetModelBad'));
      return setModel(prefs.helperModel);
    }
    void updatePrefs({ helperModel: m });
  };
  return (
    <>
      <h4>{t('hlpSetTitle')}</h4>
      <label className="settings-toggle">
        <span>
          <span className="settings-label">{t('hlpSetBubble')}</span>
          <span className="settings-hint">{t('hlpSetBubbleHint')}</span>
        </span>
        <input
          type="checkbox"
          checked={prefs.helperBubble !== false}
          onChange={(e) => void updatePrefs({ helperBubble: e.target.checked })}
        />
      </label>
      <label className="settings-toggle">
        <span>
          <span className="settings-label">{t('hlpSetModel')}</span>
          <span className="settings-hint">{t('hlpSetModelHint')}</span>
        </span>
        <span className="hlp-set-model">
          <input
            value={model}
            spellCheck={false}
            aria-label={t('hlpSetModel')}
            list="hlp-models"
            onChange={(e) => setModel(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <datalist id="hlp-models">
            <option value="qwen2.5:1.5b" />
            <option value="llama3.2:1b" />
            <option value="qwen2.5:0.5b" />
            <option value="gemma3:1b" />
          </datalist>
        </span>
      </label>
    </>
  );
}
