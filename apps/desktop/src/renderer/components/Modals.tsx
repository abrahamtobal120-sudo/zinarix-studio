import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { CustomProviderSpec, OmniApi, ProviderView } from '../../shared/api';
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
import { LicensePanel, Onboarding, UpgradeModal, WhatsNew } from './Plan';

const close = () => setState({ modal: null });

export function Modals() {
  const modal = useStore((s) => s.modal);
  const inputBox = useStore((s) => s.inputBox);
  return (
    <>
      {modal?.kind === 'palette' && <Palette />}
      {modal?.kind === 'quickOpen' && <QuickOpen />}
      {modal?.kind === 'models' && <ModelPicker role={modal.role} pick={modal.pick} />}
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
      {modal?.kind === 'license' && <LicensePanel />}
      {modal?.kind === 'upgrade' && <UpgradeModal feature={modal.feature} />}
      {modal?.kind === 'welcome' && <Onboarding />}
      {modal?.kind === 'whatsNew' && <WhatsNew />}
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

const CLI_PROFILES: [string, string][] = [
  ['claude', 'Claude Code'],
  ['codex', 'Codex'],
  ['gemini', 'Gemini CLI'],
  ['qwen', 'Qwen Code'],
  ['cursor', 'Cursor Agent'],
  ['copilot', 'Copilot CLI'],
  ['opencode', 'OpenCode'],
  ['amp', 'Amp'],
];

/** Form to add an API endpoint or a terminal agent that is not in the catalog. */
function AddProvider({
  onAdded,
  onCancel,
}: {
  onAdded: (id: string, key: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<'api' | 'cli'>('api');
  const [name, setName] = useState('');
  const [adapter, setAdapter] =
    useState<Extract<CustomProviderSpec, { kind: 'api' }>['adapter']>('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('');
  const [authHeader, setAuthHeader] = useState('');
  const [noAuth, setNoAuth] = useState(false);
  const [local, setLocal] = useState(false);
  const [models, setModels] = useState('');
  const [key, setKey] = useState('');
  const [command, setCommand] = useState('');
  const [profile, setProfile] = useState('generic');
  const [args, setArgs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = (v: string, sep: RegExp) =>
    v
      .split(sep)
      .map((x) => x.trim())
      .filter(Boolean);
  const ready = name.trim() && (kind === 'api' ? baseUrl.trim() : command.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    const spec: CustomProviderSpec =
      kind === 'api'
        ? {
            kind,
            name: name.trim(),
            adapter,
            baseUrl: baseUrl.trim(),
            authHeader: authHeader.trim() || undefined,
            noAuth,
            local,
            models: list(models, /,/),
          }
        : {
            kind,
            name: name.trim(),
            command: command.trim(),
            profile,
            args: profile === 'generic' ? list(args, /\s+/) : undefined,
            models: list(models, /,/),
          };
    try {
      const id = await api().ai.addCustomProvider(spec);
      await onAdded(id, kind === 'api' && !noAuth ? key : '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  return (
    <>
      <h2>{t('provAddTitle')}</h2>
      <div className="prov-chips">
        <button
          className={`prov-chip ${kind === 'api' ? 'on' : ''}`}
          onClick={() => setKind('api')}
        >
          {t('provAddApi')}
        </button>
        <button
          className={`prov-chip ${kind === 'cli' ? 'on' : ''}`}
          onClick={() => setKind('cli')}
        >
          {t('provAddCli')}
        </button>
      </div>
      <label className="field">
        {t('provAddName')}
        <input
          autoFocus
          value={name}
          placeholder={kind === 'api' ? 'Mi servidor' : 'Mi agente'}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {kind === 'api' ? (
        <>
          <label className="field">
            {t('provAddAdapter')}
            <select
              value={adapter}
              onChange={(e) => {
                const v = e.target.value as typeof adapter;
                setAdapter(v);
                if (!authHeader || ['x-api-key', 'x-goog-api-key'].includes(authHeader))
                  setAuthHeader(
                    v === 'anthropic' ? 'x-api-key' : v === 'google-gemini' ? 'x-goog-api-key' : '',
                  );
              }}
            >
              <option value="openai-compatible">OpenAI-compatible (/chat/completions)</option>
              <option value="openai-responses">OpenAI Responses (/responses)</option>
              <option value="anthropic">Anthropic (/messages)</option>
              <option value="google-gemini">Google Gemini</option>
            </select>
          </label>
          <label className="field">
            {t('provAddBaseUrl')}
            <input
              value={baseUrl}
              placeholder="https://…/v1"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
          <label className="settings-toggle">
            <span>{t('provAddNoAuth')}</span>
            <input type="checkbox" checked={noAuth} onChange={(e) => setNoAuth(e.target.checked)} />
          </label>
          {!noAuth && (
            <>
              <label className="field">
                {t('apiKey')}
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  placeholder="sk-…"
                  onChange={(e) => setKey(e.target.value)}
                />
              </label>
              <label className="field">
                {t('provAddAuthHeader')}
                <input
                  value={authHeader}
                  placeholder="Authorization"
                  onChange={(e) => setAuthHeader(e.target.value)}
                />
              </label>
            </>
          )}
          <label className="settings-toggle">
            <span>{t('provAddLocal')}</span>
            <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} />
          </label>
        </>
      ) : (
        <>
          <p className="provider-notes">{t('provAddCliHint')}</p>
          <label className="field">
            {t('provAddCommand')}
            <input
              value={command}
              placeholder="aider, /usr/local/bin/mi-agente…"
              onChange={(e) => setCommand(e.target.value)}
            />
          </label>
          <label className="field">
            {t('provAddProfile')}
            <select value={profile} onChange={(e) => setProfile(e.target.value)}>
              <option value="generic">{t('provAddGeneric')}</option>
              {CLI_PROFILES.map(([id, label]) => (
                <option key={id} value={id}>
                  {t('provAddLike', { name: label })}
                </option>
              ))}
            </select>
          </label>
          {profile === 'generic' && (
            <label className="field">
              {t('provAddArgs')}
              <input
                value={args}
                placeholder="--message-stdin --no-color"
                onChange={(e) => setArgs(e.target.value)}
              />
            </label>
          )}
        </>
      )}
      <label className="field">
        {t('provAddModels')}
        <input
          value={models}
          placeholder={kind === 'api' ? 'llama-3.3-70b, qwen-2.5-coder' : 'sonnet, gpt-5'}
          onChange={(e) => setModels(e.target.value)}
        />
      </label>
      <div className="row">
        <button className="primary" disabled={busy || !ready} onClick={() => void submit()}>
          {t('provAddSave')}
        </button>
        <button onClick={onCancel}>{t('provAddCancel')}</button>
      </div>
      {error && <div className="err">{error}</div>}
    </>
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

  const [adding, setAdding] = useState(false);

  const save = () => (p ? connect(p.id, key, params) : Promise.resolve());
  const connect = async (id: string, key: string, params: Record<string, string>) => {
    setBusy(true);
    setStatus({ ok: true, text: t('testing') });
    let r: Awaited<ReturnType<OmniApi['ai']['saveProvider']>>;
    try {
      r = await api().ai.saveProvider(id, key || null, params);
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
      const first = getState().models.find((m) => m.provider === id);
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
          <button className="prov-add" onClick={() => setAdding(true)}>
            {t('provAdd')}
          </button>
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
                      onClick={() => (setAdding(false), setSelected(x.id))}
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
          {adding ? (
            <AddProvider
              onCancel={() => setAdding(false)}
              onAdded={async (id, newKey) => {
                await reload();
                setAdding(false);
                setSelected(id);
                await connect(id, newKey, {});
              }}
            />
          ) : !p ? (
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
                {p.custom && ` · ${t('provCustom')}`}
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
                {p.custom && (
                  <button
                    className="danger"
                    onClick={async () => {
                      await api().ai.deleteCustomProvider(p.id);
                      setSelected(undefined);
                      await reload();
                      await refreshModels();
                      await refreshSettings();
                    }}
                  >
                    🗑 {t('provDelete')}
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
