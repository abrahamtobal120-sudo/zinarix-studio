import { useState } from 'react';
import type { ThemeId } from '../../shared/api';
import { THEME_IDS } from '../../shared/api';
import { commands, defaultKeys, runCommand } from '../commands';
import { t } from '../i18n';
import { comboFromEvent } from '../keys';
import { api, refreshSettings, setState, setTheme, updatePrefs, useStore } from '../store';
import { THEMES } from '../themes';
import { Icon, type IconName } from './Icon';

const close = () => setState({ modal: null });

const FONTS = [
  "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
  "'Fira Code', monospace",
  "'Cascadia Code', monospace",
  "'Source Code Pro', monospace",
  "'Ubuntu Mono', monospace",
  'Menlo, Monaco, monospace',
  'Consolas, monospace',
  'monospace',
];

type Section = 'appearance' | 'editor' | 'ai' | 'keys';

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="settings-toggle">
      <span>
        <span className="settings-label">{label}</span>
        {hint && <span className="settings-hint">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function ThemeCard({ id, active }: { id: ThemeId; active: boolean }) {
  const th = THEMES[id];
  const v = (k: string, d: string) => th.vars[k] ?? d;
  const bg = v('--bg', th.dark ? '#1e1e1e' : '#ffffff');
  const side = v('--bg-2', th.dark ? '#252526' : '#f3f3f3');
  const accent = v('--accent', th.dark ? '#0e639c' : '#005fb8');
  const fg = v('--fg', th.dark ? '#cccccc' : '#333333');
  return (
    <button className={`theme-card ${active ? 'on' : ''}`} onClick={() => void setTheme(id)}>
      <span className="theme-preview" style={{ background: bg }}>
        <span className="theme-side" style={{ background: side }} />
        <span className="theme-lines">
          <span style={{ background: accent, width: '55%' }} />
          <span style={{ background: fg, width: '80%', opacity: 0.5 }} />
          <span style={{ background: fg, width: '40%', opacity: 0.5 }} />
        </span>
      </span>
      <span className="theme-name">{th.label}</span>
    </button>
  );
}

export function SettingsPanel() {
  const prefs = useStore((s) => s.prefs);
  const settings = useStore((s) => s.settings);
  const [section, setSection] = useState<Section>('appearance');
  const [recording, setRecording] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const nav = (id: Section, label: string, icon: IconName) => (
    <button className={section === id ? 'on' : ''} onClick={() => setSection(id)}>
      <Icon name={icon} size={16} /> {label}
    </button>
  );

  const defaults = defaultKeys();
  const list = commands().filter(
    (c) =>
      c.id !== 'app.requestClose' &&
      (!filter || c.label.toLowerCase().includes(filter.toLowerCase())),
  );

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
        <nav className="settings-nav">
          <div className="settings-title">
            <Icon name="settings" size={16} /> {t('settings')}
          </div>
          {nav('appearance', t('setAppearance'), 'palette')}
          {nav('editor', t('setEditor'), 'edit')}
          {nav('ai', t('setAi'), 'sparkles')}
          {nav('keys', t('shortcuts'), 'keyboard')}
        </nav>
        <div className="settings-body">
          <button className="modal-x" onClick={close} aria-label={t('close')}>
            ×
          </button>
          {section === 'appearance' && (
            <>
              <h3>{t('setTheme')}</h3>
              <div className="theme-grid">
                {THEME_IDS.map((id) => (
                  <ThemeCard key={id} id={id} active={settings.theme === id} />
                ))}
              </div>
              <h3>{t('setFont')}</h3>
              <label className="settings-field">
                <span>{t('setFontSize')}</span>
                <span className="settings-range">
                  <input
                    type="range"
                    min={10}
                    max={28}
                    value={prefs.fontSize}
                    onChange={(e) => void updatePrefs({ fontSize: Number(e.target.value) })}
                  />
                  <b>{prefs.fontSize}px</b>
                </span>
              </label>
              <label className="settings-field">
                <span>{t('setFontFamily')}</span>
                <select
                  value={FONTS.includes(prefs.fontFamily) ? prefs.fontFamily : ''}
                  onChange={(e) => void updatePrefs({ fontFamily: e.target.value })}
                >
                  {!FONTS.includes(prefs.fontFamily) && (
                    <option value="">{prefs.fontFamily}</option>
                  )}
                  {FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f.split(',')[0]!.replace(/'/g, '')}
                    </option>
                  ))}
                </select>
              </label>
              <div
                className="font-sample"
                style={{ fontFamily: prefs.fontFamily, fontSize: prefs.fontSize }}
              >
                {'const saludo = (nombre) => `Hola, ${nombre}!`; // => != === 0x1F'}
              </div>
            </>
          )}

          {section === 'editor' && (
            <>
              <h3>{t('setEditor')}</h3>
              <label className="settings-field">
                <span>{t('setTabSize')}</span>
                <select
                  value={prefs.tabSize}
                  onChange={(e) => void updatePrefs({ tabSize: Number(e.target.value) })}
                >
                  {[2, 4, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <Toggle
                label={t('setWordWrap')}
                checked={prefs.wordWrap}
                onChange={(v) => void updatePrefs({ wordWrap: v })}
              />
              <Toggle
                label={t('setMinimap')}
                checked={prefs.minimap}
                onChange={(v) => void updatePrefs({ minimap: v })}
              />
              <Toggle
                label={t('setLineNumbers')}
                checked={prefs.lineNumbers}
                onChange={(v) => void updatePrefs({ lineNumbers: v })}
              />
              <Toggle
                label={t('setFormatOnSave')}
                hint={t('setFormatOnSaveHint')}
                checked={prefs.formatOnSave}
                onChange={(v) => void updatePrefs({ formatOnSave: v })}
              />
              <Toggle
                label={t('setAutoSave')}
                hint={t('setAutoSaveHint')}
                checked={prefs.autoSave}
                onChange={(v) => void updatePrefs({ autoSave: v })}
              />
            </>
          )}

          {section === 'ai' && (
            <>
              <h3>{t('setAi')}</h3>
              <Toggle
                label={t('setInline')}
                hint={t('setInlineHint')}
                checked={prefs.inlineCompletions}
                onChange={(v) => void updatePrefs({ inlineCompletions: v })}
              />
              <div className="settings-sub">
                <button onClick={() => setState({ modal: { kind: 'models', role: 'inline' } })}>
                  {t('setInlineModel')}:{' '}
                  {settings.roles.inline ?? settings.defaultModel ?? t('noModel')}
                </button>
              </div>
              <Toggle
                label={t('setRules')}
                hint={t('setRulesHint')}
                checked={prefs.projectRules}
                onChange={(v) => void updatePrefs({ projectRules: v })}
              />
              <div className="settings-sub">
                <button onClick={() => (close(), void runCommand('ai.rules'))}>
                  📜 {t('rulesEdit')}
                </button>
              </div>
              <Toggle
                label={t('setLocalOnly')}
                hint={t('setLocalOnlyHint')}
                checked={settings.localOnly}
                onChange={async (v) => {
                  await api().ai.setLocalOnly(v);
                  await refreshSettings();
                }}
              />
            </>
          )}

          {section === 'keys' && (
            <>
              <h3>{t('shortcuts')}</h3>
              <p className="dim small">{t('setKeysHint')}</p>
              <input
                className="settings-filter"
                value={filter}
                placeholder={t('setKeysFilter')}
                onChange={(e) => setFilter(e.target.value)}
              />
              <table className="keys-table">
                <tbody>
                  {list.map((c) => {
                    const custom = prefs.keybindings[c.id];
                    return (
                      <tr key={c.id}>
                        <td>{c.label}</td>
                        <td>
                          {recording === c.id ? (
                            <input
                              autoFocus
                              className="key-recorder"
                              readOnly
                              value={t('setKeysPress')}
                              onBlur={() => setRecording(null)}
                              onKeyDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (e.key === 'Escape') return setRecording(null);
                                const combo = comboFromEvent(e.nativeEvent);
                                if (!combo) return;
                                void updatePrefs({
                                  keybindings: { ...prefs.keybindings, [c.id]: combo },
                                });
                                setRecording(null);
                              }}
                            />
                          ) : (
                            <button className="key-btn" onClick={() => setRecording(c.id)}>
                              {custom || defaults[c.id] ? (
                                <kbd className={custom ? 'custom' : ''}>
                                  {custom ?? defaults[c.id]}
                                </kbd>
                              ) : (
                                <span className="dim">{t('setKeysAdd')}</span>
                              )}
                            </button>
                          )}
                          {custom && (
                            <button
                              className="key-reset"
                              title={t('setKeysReset')}
                              onClick={() => {
                                const { [c.id]: _gone, ...rest } = prefs.keybindings;
                                void updatePrefs({ keybindings: rest });
                              }}
                            >
                              ↺
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
