import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { OmniApi, ProviderView } from '../../shared/api';
import { commands, runCommand } from '../commands';
import { t } from '../i18n';
import { monaco } from '../monaco';
import { monacoTheme } from '../themes';
import {
  api,
  chooseModel,
  getEditor,
  getState,
  newRequestId,
  openFile,
  refreshModels,
  refreshSettings,
  setState,
  toast,
  useStore,
} from '../store';
import { ModelPicker } from './ModelPicker';
import { UsagePanel } from './Usage';
import { SecurityCenter } from './SecurityCenter';
import { Scanner } from './Scanner';
import { CloneRepo, CommitView, GitDiff, PublishRepo } from './GitModals';
import { SettingsPanel } from './Settings';
import { fileIcon } from './icons';
import { fuzzyMarks } from './Search';
import { QuickPick } from './QuickPick';
import { ProviderLogo } from './ProviderLogo';
import type { PickItem } from './QuickPick';

const close = () => setState({ modal: null });

export function Modals() {
  const modal = useStore((s) => s.modal);
  const inputBox = useStore((s) => s.inputBox);
  return (
    <>
      {modal?.kind === 'palette' && <Palette />}
      {modal?.kind === 'quickOpen' && <QuickOpen />}
      {modal?.kind === 'models' && <ModelPicker role={modal.role} />}
      {modal?.kind === 'providers' && <Providers focus={modal.focus} />}
      {modal?.kind === 'aiEdit' && <AiEdit />}
      {modal?.kind === 'shortcuts' && <Shortcuts />}
      {modal?.kind === 'usage' && <UsagePanel />}
      {modal?.kind === 'security' && <SecurityCenter />}
      {modal?.kind === 'scanner' && <Scanner />}
      {modal?.kind === 'settings' && <SettingsPanel />}
      {modal?.kind === 'diff' && <GitDiff path={modal.path} staged={modal.staged} />}
      {modal?.kind === 'commit' && <CommitView hash={modal.hash} subject={modal.subject} />}
      {modal?.kind === 'clone' && <CloneRepo />}
      {modal?.kind === 'publish' && <PublishRepo />}
      {inputBox && <InputBox />}
    </>
  );
}

function Palette() {
  const items: PickItem[] = commands().map((c) => ({ id: c.id, label: c.label, hint: c.keys }));
  return (
    <QuickPick
      placeholder={t('palette')}
      items={items}
      onClose={close}
      onPick={(it) => {
        close();
        void runCommand(it.id);
      }}
    />
  );
}

function QuickOpen() {
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    if (getState().workspace) void api().workspace.listFiles().then(setFiles);
  }, []);
  const items = useMemo(
    () => files.map((f) => ({ id: f, label: f.split('/').pop()!, detail: f })),
    [files],
  );
  return (
    <QuickPick
      placeholder={t('quickOpen')}
      items={items}
      limit={100}
      renderItem={(it, q) => {
        const dir = it.id.includes('/') ? it.id.slice(0, it.id.lastIndexOf('/')) : '';
        return (
          <span className="qo-row">
            <span className="qo-icon">{fileIcon(it.id)}</span>
            <span className="qo-name">{q ? fuzzyMarks(q, it.label) : it.label}</span>
            <span className="qo-dir">{dir}</span>
          </span>
        );
      }}
      onClose={close}
      onPick={(it) => {
        close();
        void openFile(it.id);
      }}
    />
  );
}

function Providers({ focus }: { focus?: string }) {
  const [list, setList] = useState<ProviderView[]>([]);
  const [selected, setSelected] = useState<string | undefined>(focus);
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<'all' | 'connected' | 'cli' | 'api' | 'local'>('all');
  const [key, setKey] = useState('');
  const [params, setParams] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => setList(await api().ai.providers());
  useEffect(() => {
    void reload();
  }, []);
  const p = list.find((x) => x.id === selected);
  // Reset the form when another provider is picked or the list first loads (not on every reload,
  // which would wipe the result of "Save and test").
  const resetForm = useEffectEvent(() => {
    setKey('');
    setStatus(null);
    setParams(Object.fromEntries((p?.params ?? []).map((x) => [x.name, x.value])));
  });
  useEffect(() => {
    resetForm();
  }, [selected, list.length]);

  const shown = list
    .filter(
      (x) =>
        (!filter ||
          `${x.name} ${x.id} ${x.category}`.toLowerCase().includes(filter.toLowerCase())) &&
        (kind === 'all' ||
          (kind === 'connected' && x.connected) ||
          (kind === 'cli' && x.adapter === 'cli-agent') ||
          (kind === 'api' && x.adapter !== 'cli-agent') ||
          (kind === 'local' && x.local)),
    )
    .sort(
      (a, b) =>
        Number(b.connected) - Number(a.connected) ||
        Number(b.status === 'active') - Number(a.status === 'active'),
    );

  const save = async () => {
    if (!p) return;
    setBusy(true);
    setStatus({ ok: true, text: t('testing') });
    let r: Awaited<ReturnType<OmniApi['ai']['saveProvider']>>;
    try {
      r = await api().ai.saveProvider(p.id, key || null, params);
    } catch (err) {
      setBusy(false);
      setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) });
      return;
    }
    setBusy(false);
    setKey('');
    setStatus(
      r.ok
        ? { ok: true, text: t('testOk', { n: r.models ?? 0 }) }
        : { ok: false, text: r.error ?? 'error' },
    );
    await reload();
    await refreshModels();
    await refreshSettings();
    if (r.ok && !getState().settings.defaultModel) {
      const first = getState().models.find((m) => m.provider === p.id);
      if (first) await chooseModel(`${first.provider}/${first.id}`);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="providers" onMouseDown={(e) => e.stopPropagation()}>
        <div className="providers-list">
          <input
            autoFocus
            placeholder={t('providerSearch')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="prov-chips">
            {(
              [
                ['all', t('provFilterAll')],
                [
                  'connected',
                  `● ${t('provFilterConnected')} (${list.filter((x) => x.connected).length})`,
                ],
                ['cli', 'CLI'],
                ['api', 'API'],
                ['local', t('provFilterLocal')],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                className={`prov-chip ${kind === k ? 'on' : ''}`}
                onClick={() => setKind(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="providers-scroll">
            {[
              {
                key: 'cli',
                title: t('providersCli'),
                items: shown.filter((x) => x.adapter === 'cli-agent'),
              },
              {
                key: 'api',
                title: t('providersApi'),
                items: shown.filter((x) => x.adapter !== 'cli-agent'),
              },
            ]
              .filter((g) => g.items.length)
              .map((g) => (
                <div key={g.key} className="provider-group">
                  <div className="provider-group-title">
                    {g.title} <span className="dim">{g.items.length}</span>
                    {g.items.some((x) => x.connected) && (
                      <span className="provider-group-on">
                        {t('provConnectedCount', { n: g.items.filter((x) => x.connected).length })}
                      </span>
                    )}
                  </div>
                  {g.items.map((x) => (
                    <div
                      key={x.id}
                      className={`provider-row ${x.id === selected ? 'active' : ''}`}
                      onClick={() => setSelected(x.id)}
                    >
                      <ProviderLogo id={x.id} name={x.name} size={22} />
                      <span className="provider-name">{x.name}</span>
                      <span className={`dot ${x.connected ? 'on' : ''}`} />
                      {x.status !== 'active' && (
                        <span className={`badge ${x.status}`}>{x.status}</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
          </div>
        </div>
        <div className="providers-detail">
          <button className="modal-x" onClick={close}>
            ×
          </button>
          {!p ? (
            <div className="dim">
              <h2>{t('providers')}</h2>
              <p>
                {list.filter((x) => x.connected).length} / {list.length}
              </p>
              <p>{t('providerPick')}</p>
            </div>
          ) : (
            <>
              <h2 className="provider-title">
                <ProviderLogo id={p.id} name={p.name} size={40} />
                {p.name} {p.connected && <span className="badge ok">{t('connected')}</span>}
              </h2>
              <div className="dim">
                {p.category} · {p.adapter} · {p.status}
              </div>
              {p.notes && <p className="provider-notes">{p.notes}</p>}
              {!p.implemented && <p className="err">{t('notImplemented')}</p>}
              {p.adapter === 'cli-agent' && <p className="provider-notes">{t('cliHint')}</p>}
              {p.params.map((bp) => (
                <label key={bp.name} className="field">
                  {bp.label}
                  {p.adapter === 'cli-agent' && bp.name === 'mode' ? (
                    <select
                      value={params[bp.name] || 'edit'}
                      disabled={busy}
                      onChange={(e) => {
                        const next = { ...params, [bp.name]: e.target.value };
                        setParams(next);
                        // Already verified: the new mode applies right away, no "Save and test".
                        if (p.connected)
                          void api()
                            .ai.saveProvider(p.id, null, next)
                            .then((r) =>
                              setStatus(
                                r.ok
                                  ? { ok: true, text: t('cliModeSaved', { mode: e.target.value }) }
                                  : { ok: false, text: r.error ?? 'error' },
                              ),
                            );
                      }}
                    >
                      <option value="read">{t('cliModeRead')}</option>
                      <option value="edit">{t('cliModeEdit')}</option>
                      <option value="full">{t('cliModeFull')}</option>
                    </select>
                  ) : (
                    <input
                      value={params[bp.name] ?? ''}
                      placeholder={bp.placeholder}
                      onChange={(e) => setParams({ ...params, [bp.name]: e.target.value })}
                    />
                  )}
                </label>
              ))}
              {p.needsKey || p.category === 'local' ? (
                <label className="field">
                  {t('apiKey')} {!p.needsKey && <span className="dim">{t('optional')}</span>}
                  {p.adapter === 'google-vertex' ? (
                    // Accepts an API key, a pasted service-account JSON or an access token.
                    <textarea
                      className="secret-area"
                      autoComplete="off"
                      spellCheck={false}
                      rows={4}
                      value={key}
                      placeholder={
                        p.store && p.store !== 'none'
                          ? t('keyStored', { store: p.store })
                          : t('vertexKeyHint')
                      }
                      onChange={(e) => setKey(e.target.value)}
                    />
                  ) : (
                    <input
                      type="password"
                      autoComplete="off"
                      value={key}
                      placeholder={
                        p.store && p.store !== 'none' ? t('keyStored', { store: p.store }) : 'sk-…'
                      }
                      onChange={(e) => setKey(e.target.value)}
                    />
                  )}
                </label>
              ) : null}
              <div className="row">
                <button
                  className="primary"
                  disabled={busy || !p.implemented}
                  onClick={() => void save()}
                >
                  {t('saveAndTest')}
                </button>
                {p.keyUrl && (
                  <button onClick={() => void api().app.openExternal(p.keyUrl!)}>
                    🔑 {t('getKey')}
                  </button>
                )}
                {p.docsUrl && (
                  <button onClick={() => void api().app.openExternal(p.docsUrl!)}>📖 Docs</button>
                )}
                {p.connected && p.store !== 'env' && (
                  <button
                    className="danger"
                    onClick={async () => {
                      await api().ai.removeProvider(p.id);
                      await reload();
                      await refreshModels();
                      setStatus(null);
                    }}
                  >
                    {t('disconnect')}
                  </button>
                )}
              </div>
              {status && <div className={status.ok ? 'ok-text' : 'err'}>{status.text}</div>}
              {p.adapter !== 'cli-agent' && <p className="dim small">{t('keyStoredNote')}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Ctrl+K: describe a change, stream the replacement, review it in a diff, accept or reject. */
function AiEdit() {
  const ed = getEditor();
  const model = ed?.getModel();
  const sel = ed?.getSelection();
  const [instruction, setInstruction] = useState('');
  const [phase, setPhase] = useState<'ask' | 'gen' | 'review'>('ask');
  const [result, setResult] = useState('');
  const [error, setError] = useState<string | null>(null);
  const diffHost = useRef<HTMLDivElement>(null);
  const requestRef = useRef<string | null>(null);
  const theme = useStore((s) => s.settings.theme);

  const original = model && sel ? model.getValueInRange(sel) : '';

  useEffect(() => {
    if (phase !== 'review' || !diffHost.current || !model) return;
    const diff = monaco.editor.createDiffEditor(diffHost.current, {
      readOnly: true,
      renderSideBySide: true,
      automaticLayout: true,
      theme: monacoTheme(theme),
      minimap: { enabled: false },
    });
    const a = monaco.editor.createModel(original, model.getLanguageId());
    const b = monaco.editor.createModel(result, model.getLanguageId());
    diff.setModel({ original: a, modified: b });
    return () => {
      diff.dispose();
      a.dispose();
      b.dispose();
    };
  }, [phase, model, original, result, theme]);

  if (!ed || !model || !sel || sel.isEmpty()) {
    setTimeout(() => {
      close();
      toast(t('selectFirst'));
    });
    return null;
  }

  const run = async () => {
    if (!instruction.trim()) return;
    setPhase('gen');
    setResult('');
    setError(null);
    const requestId = newRequestId();
    requestRef.current = requestId;
    let text = '';
    const off = api().on((ev) => {
      if (ev.type !== 'chat' || ev.requestId !== requestId) return;
      const e = ev.event;
      if (e.type === 'text') {
        text += e.delta;
        setResult(text);
      } else if (e.type === 'error') {
        off();
        setError(e.message);
        setPhase('ask');
      } else if (e.type === 'cost') {
        off();
        setResult(stripFences(text));
        setPhase('review');
        void refreshSettings();
      }
    });
    const full = model.getFullModelRange();
    try {
      await api().ai.edit(requestId, {
        model: undefined, // resolved for the 'inline' role in main
        instruction,
        path: getState().active ?? 'untitled',
        language: model.getLanguageId(),
        selection: original,
        before: model.getValueInRange({
          ...full,
          endLineNumber: sel.startLineNumber,
          endColumn: sel.startColumn,
        }),
        after: model.getValueInRange({
          ...full,
          startLineNumber: sel.endLineNumber,
          startColumn: sel.endColumn,
        }),
      });
    } catch (err) {
      // Rejected before streaming (validation, IPC failure): unlock the dialog and show why.
      off();
      if (requestRef.current === requestId) requestRef.current = null;
      setError(err instanceof Error ? err.message : String(err));
      setPhase('ask');
    }
  };

  const accept = () => {
    ed.executeEdits('omni-ai-edit', [{ range: sel, text: result, forceMoveMarkers: true }]);
    ed.pushUndoStop();
    close();
    ed.focus();
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={() => (
        phase === 'gen' && requestRef.current ? void api().ai.abort(requestRef.current) : undefined,
        close()
      )}
    >
      <div
        className={`ai-edit ${phase === 'review' ? 'wide' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ai-edit-head">
          ✨ {t('aiEdit')}{' '}
          <span className="dim">
            · {getState().settings.roles.inline ?? getState().settings.defaultModel ?? t('noModel')}{' '}
            · {sel.startLineNumber}–{sel.endLineNumber}
          </span>
        </div>
        {phase !== 'review' && (
          <input
            autoFocus
            value={instruction}
            disabled={phase === 'gen'}
            placeholder={t('aiEditPlaceholder')}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run();
              if (e.key === 'Escape') close();
            }}
          />
        )}
        {phase === 'gen' && <pre className="ai-edit-stream">{result || t('generating')}</pre>}
        {phase === 'review' && <div className="ai-edit-diff" ref={diffHost} />}
        {error && <div className="err">{error}</div>}
        {phase === 'review' && (
          <div className="row" onKeyDown={(e) => e.key === 'Escape' && close()}>
            <button className="primary" autoFocus onClick={accept}>
              ✓ {t('accept')}
            </button>
            <button onClick={close}>✗ {t('reject')}</button>
            <button onClick={() => setPhase('ask')}>↺</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function stripFences(text: string): string {
  const m = /^\s*```[\w+#.-]*\s*\n([\s\S]*?)\n?```\s*$/.exec(text);
  return m ? m[1]! : text;
}

function InputBox() {
  const box = useStore((s) => s.inputBox)!;
  const [value, setValue] = useState(box.value);
  const done = (v: string | null) => {
    setState({ inputBox: null });
    box.resolve(v);
  };
  return (
    <div className="modal-backdrop" onMouseDown={() => done(null)}>
      <div className="quick-pick" onMouseDown={(e) => e.stopPropagation()}>
        <div className="input-label">{box.label}</div>
        <input
          autoFocus
          value={value}
          onFocus={(e) => {
            const dot = e.target.value.lastIndexOf('.');
            e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
          }}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') done(value);
            if (e.key === 'Escape') done(null);
          }}
        />
      </div>
    </div>
  );
}

function Shortcuts() {
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{t('shortcuts')}</h2>
        <table>
          <tbody>
            {commands()
              .filter((c) => c.keys)
              .map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td>
                    <kbd>{c.keys}</kbd>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
