/**
 * Fase 8 — Settings › AI: next-edit and auto-import switches, and the acceptance metric of
 * the editor suggestions (per kind and model: acceptance rate, p50 / p90 latency).
 */
import { useEffect, useState } from 'react';
import type { SuggestionStatsRow } from '../../shared/nextEdit';
import { TARGET_P50_MS, latencyAdvice } from '../../shared/nextEdit';
import { confirmDialog } from '../confirm';
import { tl } from '../i18nLsp';
import { api, updatePrefs, useStore } from '../store';
import './suggestion-settings.css';

function SubToggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`settings-toggle ${disabled ? 'sx-disabled' : ''}`}>
      <span>
        <span className="settings-label">{label}</span>
        <span className="settings-hint">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function ms(v: number | null): string {
  return v === null ? '—' : `${v} ms`;
}

export function SuggestionSettings() {
  const prefs = useStore((s) => s.prefs);
  const [rows, setRows] = useState<SuggestionStatsRow[] | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    void api()
      .ai.suggestionStats()
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [nonce]);

  const off = !prefs.inlineCompletions;
  return (
    <>
      <SubToggle
        label={tl('nextEditSetting')}
        hint={tl('nextEditSettingHint')}
        checked={prefs.nextEdit}
        disabled={off}
        onChange={(v) => void updatePrefs({ nextEdit: v })}
      />
      <SubToggle
        label={tl('autoImportSetting')}
        hint={tl('autoImportSettingHint')}
        checked={prefs.autoImport}
        disabled={off}
        onChange={(v) => void updatePrefs({ autoImport: v })}
      />
      <div className="zx-stats">
        <div className="zx-stats-head">
          <span className="settings-label">{tl('statsTitle')}</span>
          <span className="zx-stats-actions">
            <button onClick={() => setNonce((n) => n + 1)}>{tl('statsRefresh')}</button>
            <button
              disabled={!rows?.length}
              onClick={async () => {
                if (!(await confirmDialog(tl('statsClear'), { danger: true }))) return;
                await api().ai.suggestionStatsClear();
                setNonce((n) => n + 1);
              }}
            >
              {tl('statsClear')}
            </button>
          </span>
        </div>
        <span className="settings-hint">{tl('statsHint')}</span>
        {rows && !rows.length && <p className="settings-hint">{tl('statsEmpty')}</p>}
        {!!rows?.length && (
          <table className="zx-stats-table">
            <thead>
              <tr>
                <th>{tl('statsModel')}</th>
                <th>{tl('statsRequests')}</th>
                <th>{tl('statsShown')}</th>
                <th>{tl('statsAccepted')}</th>
                <th>{tl('statsRate')}</th>
                <th>p50</th>
                <th>p90</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const advice = latencyAdvice(r);
                return (
                  <tr key={`${r.kind}:${r.model}`}>
                    <td>
                      <span className="zx-stats-kind">
                        {r.kind === 'inline' ? tl('statsKindInline') : tl('statsKindNextEdit')}
                      </span>{' '}
                      <code>{r.model}</code>
                      {advice && (
                        <div className="zx-stats-warn">
                          {advice === 'slow'
                            ? tl('statsSlow', { ms: TARGET_P50_MS })
                            : tl('statsLowAccept')}
                        </div>
                      )}
                    </td>
                    <td>{r.requests}</td>
                    <td>{r.shown}</td>
                    <td>{r.accepted}</td>
                    <td>{r.acceptRate === null ? '—' : `${Math.round(r.acceptRate * 100)} %`}</td>
                    <td className={(r.p50 ?? 0) > TARGET_P50_MS ? 'zx-stats-slow' : ''}>
                      {ms(r.p50)}
                    </td>
                    <td>{ms(r.p90)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
