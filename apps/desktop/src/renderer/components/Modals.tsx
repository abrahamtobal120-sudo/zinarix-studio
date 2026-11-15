import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import type { CustomProviderSpec, OmniApi, ProviderView } from '../../shared/api';
import { commands } from '../commands';
import { pressable } from '../a11y';
import { t } from '../i18n';
import { openLink } from '../links';
import { confirmDialog } from '../confirm';
import { monaco } from '../monaco';
import { monacoTheme } from '../themes';
import {
  api,
  chooseModel,
  getEditor,
  getState,
  newRequestId,
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
import { Icon } from './Icon';
import { ModalShell } from './ModalShell';
import { clearProvidersOptions, peekProvidersOptions } from './providersNav';
import { QuickPick } from './QuickPick';
import { Palette as UnifiedPalette } from './Palette';
import { describeTask, detectRunTasks, runTask, type RunTask } from './RunPanel';
import { ProviderLogo } from './ProviderLogo';
import { LicensePanel, Onboarding, UpgradeModal, WhatsNew } from './Plan';
import { Licenses } from './Licenses';

const close = () => setState({ modal: null });

/** Provider status / category / adapter from the catalog, in words (unknown ids as they are). */
function provStatus(s: string): string {
  return s === 'active'
    ? t('provStatusActive')
    : s === 'unverified'
      ? t('provStatusUnverified')
      : s;
}
function provCategory(c: string): string {
  const m: Record<string, string> = {
    lab: t('provCatLab'),
    enterprise: t('provCatEnterprise'),
    asia: t('provCatAsia'),
    aggregator: t('provCatAggregator'),
    local: t('provCatLocal'),
    cli: t('provCatCli'),
  };
  return m[c] ?? c;
}
const ADAPTERS: Record<string, string> = {
  'openai-compatible': 'OpenAI-compatible',
  'openai-responses': 'OpenAI Responses',
  anthropic: 'Anthropic',
  'google-gemini': 'Google Gemini',
  'google-vertex': 'Google Vertex AI',
  'azure-openai': 'Azure OpenAI',
  'aws-bedrock': 'AWS Bedrock',
  cohere: 'Cohere',
  huggingface: 'Hugging Face',
  replicate: 'Replicate',
  'ibm-watsonx': 'IBM watsonx',
  writer: 'Writer',
};
function provAdapter(a: string): string {
  return a === 'cli-agent' ? t('provAdapterCli') : (ADAPTERS[a] ?? a);
}

export function Modals() {
  const modal = useStore((s) => s.modal);
  const inputBox = useStore((s) => s.inputBox);
  return (
    <>
      {modal?.kind === 'palette' && <UnifiedPalette initial=">" />}
      {modal?.kind === 'tasks' && <TaskPick />}
      {modal?.kind === 'quickOpen' && <UnifiedPalette />}
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
      {modal?.kind === 'licenses' && <Licenses />}
      {inputBox && <InputBox />}
    </>
  );
}

function TaskPick() {
  const [tasks, setTasks] = useState<RunTask[] | null>(null);
  useEffect(() => {
    void detectRunTasks()
      .then((d) => {
        if (!d.tasks.length) {
          close();
          toast(t('taskNone'));
        } else setTasks(d.tasks);
      })
      .catch(() => setTasks([]));
  }, []);
  const items = useMemo(
    () =>
      (tasks ?? []).map((task, i) => ({
        id: String(i),
        label: task.label,
        detail: describeTask(task),
        hint: task.file,
      })),
    [tasks],
  );
  if (!tasks) return null;
  return (
    <QuickPick
      placeholder={t('taskPick')}
      items={items}
      onClose={close}
      onPick={(it) => {
        close();
        const task = tasks[Number(it.id)];
        if (task) runTask(task);
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
          aria-pressed={kind === 'api'}
          onClick={() => setKind('api')}
        >
          {t('provAddApi')}
        </button>
        <button
          className={`prov-chip ${kind === 'cli' ? 'on' : ''}`}
          aria-pressed={kind === 'cli'}
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
          placeholder={kind === 'api' ? t('provAddNamePhApi') : t('provAddNamePhCli')}
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
              placeholder={t('phAgentCommand')}
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
      {error && (
        <div className="err" role="alert">
          {error}
        </div>
      )}
    </>
  );
}

function Providers({ focus }: { focus?: string }) {
  // Opened through openProviders(): a kind filter and where to go back when closed.
  const [opts] = useState(peekProvidersOptions);
  useEffect(() => clearProvidersOptions(), []);
  const closeProviders = () => {
    close();
    opts.onClose?.();
  };
  const [list, setList] = useState<ProviderView[]>([]);
  const [selected, setSelected] = useState<string | undefined>(focus);
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<'all' | 'connected' | 'cli' | 'api' | 'local'>(
    opts.kind ?? 'all',
  );
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
        : { ok: false, text: r.error ?? t('provError') },
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
    <ModalShell onClose={closeProviders} className="providers" label={t('providers')}>
      <div className="providers-list">
        <input
          autoFocus
          aria-label={t('providerSearch')}
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
              aria-pressed={kind === k}
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
                    {...pressable(() => (setAdding(false), setSelected(x.id)))}
                  >
                    <ProviderLogo id={x.id} name={x.name} size={22} />
                    <span className="provider-name">{x.name}</span>
                    <span className={`dot ${x.connected ? 'on' : ''}`} />
                    {x.status !== 'active' && (
                      <span className={`badge ${x.status}`}>{provStatus(x.status)}</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>
      <div className="providers-detail">
        <button
          className="modal-x"
          onClick={closeProviders}
          aria-label={t('close')}
          title={t('close')}
        >
          <Icon name="close" size={16} />
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
              {provCategory(p.category)} · {provAdapter(p.adapter)} · {provStatus(p.status)}
              {p.custom && ` · ${t('provCustom')}`}
            </div>
            {p.notes && <p className="provider-notes">{p.notes}</p>}
            {!p.implemented && (
              <p className="err" role="alert">
                {t('notImplemented')}
              </p>
            )}
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
                                : { ok: false, text: r.error ?? t('provError') },
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
                <button onClick={() => openLink(p.keyUrl!)}>
                  <Icon name="key" size={13} /> {t('getKey')}
                </button>
              )}
              {p.docsUrl && (
                <button onClick={() => openLink(p.docsUrl!)}>
                  <Icon name="books" size={13} /> {t('provDocs')}
                </button>
              )}
              {p.connected && p.store !== 'env' && (
                <button
                  className="danger"
                  onClick={async () => {
                    if (
                      !(await confirmDialog(t('provDisconnectConfirm', { name: p.name }), {
                        danger: true,
                      }))
                    )
                      return;
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
                    if (
                      !(await confirmDialog(t('provDeleteConfirm', { name: p.name }), {
                        danger: true,
                      }))
                    )
                      return;
                    await api().ai.deleteCustomProvider(p.id);
                    setSelected(undefined);
                    await reload();
                    await refreshModels();
                    await refreshSettings();
                  }}
                >
                  <Icon name="trash" size={13} /> {t('provDelete')}
                </button>
              )}
            </div>
            {status && (
              <div className={status.ok ? 'ok-text' : 'err'} role={status.ok ? 'status' : 'alert'}>
                {status.text}
              </div>
            )}
            {p.adapter !== 'cli-agent' && <p className="dim small">{t('keyStoredNote')}</p>}
          </>
        )}
      </div>
    </ModalShell>
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
  /** Unsubscribes the stream of the request in flight (null = none). */
  const offRef = useRef<(() => void) | null>(null);
  const theme = useStore((s) => s.settings.theme);

  const original = model && sel ? model.getValueInRange(sel) : '';
  const noSelection = !ed || !model || !sel || sel.isEmpty();

  // Closed (Esc, click outside, accept) while generating: stop listening and stop the request.
  useEffect(
    () => () => {
      offRef.current?.();
      offRef.current = null;
      if (requestRef.current) void api().ai.abort(requestRef.current);
      requestRef.current = null;
    },
    [],
  );

  // Nothing selected: close with a hint (an effect, not a timer per render: one toast).
  const warned = useRef(false);
  useEffect(() => {
    if (!noSelection || warned.current) return;
    warned.current = true;
    close();
    toast(t('selectFirst'));
  }, [noSelection]);

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

  if (noSelection) return null;

  const run = async () => {
    if (!instruction.trim()) return;
    setPhase('gen');
    setResult('');
    setError(null);
    const requestId = newRequestId();
    requestRef.current = requestId;
    let text = '';
    offRef.current?.();
    const unsubscribe = api().on((ev) => {
      if (ev.type !== 'chat' || ev.requestId !== requestId) return;
      const e = ev.event;
      if (e.type === 'text') {
        text += e.delta;
        setResult(text);
      } else if (e.type === 'error') {
        off();
        if (requestRef.current === requestId) requestRef.current = null;
        setError(e.message);
        setPhase('ask');
      } else if (e.type === 'cost') {
        off();
        if (requestRef.current === requestId) requestRef.current = null;
        setResult(stripFences(text));
        setPhase('review');
        void refreshSettings();
      }
    });
    const off = () => {
      unsubscribe();
      if (offRef.current === off) offRef.current = null;
    };
    offRef.current = off;
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
    <ModalShell
      onClose={() => (
        phase === 'gen' && requestRef.current ? void api().ai.abort(requestRef.current) : undefined,
        close()
      )}
      className={`ai-edit ${phase === 'review' ? 'wide' : ''}`}
      labelledBy="ai-edit-head"
    >
      <div className="ai-edit-head" id="ai-edit-head">
        <Icon name="sparkle" size={14} /> {t('aiEdit')}{' '}
        <span className="dim">
          · {getState().settings.roles.inline ?? getState().settings.defaultModel ?? t('noModel')} ·{' '}
          {sel.startLineNumber}–{sel.endLineNumber}
        </span>
      </div>
      {phase !== 'review' && (
        <input
          autoFocus
          value={instruction}
          disabled={phase === 'gen'}
          aria-label={t('aiEditPlaceholder')}
          placeholder={t('aiEditPlaceholder')}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run();
          }}
        />
      )}
      {phase === 'gen' && <pre className="ai-edit-stream">{result || t('generating')}</pre>}
      {phase === 'review' && <div className="ai-edit-diff" ref={diffHost} />}
      {error && (
        <div className="err" role="alert">
          {error}
        </div>
      )}
      {phase === 'review' && (
        <div className="row">
          <button className="primary" autoFocus onClick={accept}>
            <Icon name="check" size={13} /> {t('accept')}
          </button>
          <button onClick={close}>
            <Icon name="x" size={13} /> {t('reject')}
          </button>
          <button
            onClick={() => setPhase('ask')}
            aria-label={t('aiEditAgain')}
            title={t('aiEditAgain')}
          >
            <Icon name="undo" size={13} />
          </button>
        </div>
      )}
    </ModalShell>
  );
}

export function stripFences(text: string): string {
  const m = /^\s*```[\w+#.-]*\s*\n([\s\S]*?)\n?```\s*$/.exec(text);
  return m ? m[1]! : text;
}

function InputBox() {
  const box = useStore((s) => s.inputBox)!;
  const [value, setValue] = useState(box.value);
  const labelId = useId();
  const done = (v: string | null) => {
    setState({ inputBox: null });
    box.resolve(v);
  };
  return (
    <ModalShell onClose={() => done(null)} className="quick-pick" labelledBy={labelId}>
      <div className="input-label" id={labelId}>
        {box.label}
      </div>
      <input
        autoFocus
        aria-labelledby={labelId}
        value={value}
        onFocus={(e) => {
          const dot = e.target.value.lastIndexOf('.');
          e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
        }}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') done(value);
        }}
      />
    </ModalShell>
  );
}

function Shortcuts() {
  return (
    <ModalShell onClose={close} className="shortcuts" labelledBy="shortcuts-title">
      <h2 id="shortcuts-title">{t('shortcuts')}</h2>
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
    </ModalShell>
  );
}
