import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { BotKind, BotsStatus, PhoneStatus, ThemeId } from '../../shared/api';
import { REMOTE_APP_APK, THEME_IDS } from '../../shared/api';
import { commands, defaultKeys, runCommand } from '../commands';
import { lang, t } from '../i18n';
import { confirmDialog } from '../confirm';
import { comboFromEvent } from '../keys';
import { qrEncode } from '../qr';
import { fold, searchSettings, type SettingEntry, type SettingHit } from '../settingsSearch';
import {
  api,
  getState,
  refreshSettings,
  setState,
  setTheme,
  toast,
  updatePrefs,
  useStore,
} from '../store';
import { THEMES } from '../themes';
import {
  activeExtTheme,
  extThemes,
  extensionsVersion,
  onExtensions,
  showExtTheme,
  type ExtThemeChoice,
} from '../extensions';
import { Icon, type IconName } from './Icon';
import { McpSection } from './McpSettings';
import { DocsSection, MemoriesSection } from './KnowledgeSettings';
import { HelperSettings } from './helper/HelperSettings';
import { CloudSection } from './CloudSettings';
import { BrowserSection } from './BrowserSettings';
import { SuggestionSettings } from './SuggestionSettings';
import { ModalShell } from './ModalShell';
import { tl } from '../layout/i18nLayout';
import { tl as tlsp } from '../i18nLsp';
import { OwnerKeysSection } from './OwnerKeys';
import { AccountSection, ta } from './AccountSection';

const close = () => setState({ modal: null });

/** Saves a custom shortcut; if another command already uses it, asks before taking it over. */
async function assignKey(id: string, combo: string): Promise<void> {
  const other = commands().find((x) => x.id !== id && x.keys === combo);
  if (other && !(await confirmDialog(t('setKeysConflict', { name: other.label, keys: combo })))) {
    return;
  }
  const current = getState().prefs.keybindings;
  const next: Record<string, string> = { ...current, [id]: combo };
  // The other command loses this combination (back to its built-in shortcut, if any).
  if (other && next[other.id] === combo) delete next[other.id];
  await updatePrefs({ keybindings: next });
}

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

type Section =
  | 'appearance'
  | 'editor'
  | 'ai'
  | 'memories'
  | 'docs'
  | 'mcp'
  | 'cloud'
  | 'browser'
  | 'phone'
  | 'account'
  | 'keys'
  /** Only for the app's owner: make and hand out license keys. */
  | 'owner';

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

/** QR of a link, drawn as SVG on white so any phone camera reads it. */
function QrCode({ text }: { text: string }) {
  const grid = useMemo(() => qrEncode(text), [text]);
  if (!grid) return null;
  const n = grid.length;
  let d = '';
  grid.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z`;
    }),
  );
  return (
    <svg className="phone-qr" viewBox={`0 0 ${n + 8} ${n + 8}`} shapeRendering="crispEdges">
      <rect width={n + 8} height={n + 8} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/** Remote control from a phone: start/stop, QR, address and PIN, on the Wi-Fi or from anywhere. */
function PhoneSection() {
  const status = useStore((s) => s.phone);
  const [busy, setBusy] = useState(false);
  const [where, setWhere] = useState<'lan' | 'remote'>('lan');
  useEffect(() => {
    void api()
      .phone.status()
      .then((phone) => {
        setState({ phone });
        if (phone.remote?.url) setWhere('remote');
      })
      .catch(() => undefined);
  }, []);
  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      const phone = on ? await api().phone.start() : await api().phone.stop();
      setState({ phone });
      if (phone.error) toast(phone.error);
    } finally {
      setBusy(false);
    }
  };
  const toggleRemote = async (on: boolean) => {
    setBusy(true);
    try {
      const phone = await api().phone.remote(on);
      setState({ phone });
      if (phone.remote?.error) toast(phone.remote.error);
    } finally {
      setBusy(false);
    }
  };
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast(t('copied'));
  };
  const remote = status.remote;
  const remoteOn = !!remote && !remote.error;
  const state = !status.running ? 'off' : status.phones > 0 ? 'ok' : 'wait';
  const link = where === 'lan' ? status.url : remote?.url;

  const pairing = (url: string, note: string) => (
    <div className="phone-pair">
      <QrCode text={url} />
      <div className="phone-steps">
        <div className="phone-step">
          <span className="phone-num">1</span>
          <span>{where === 'lan' ? t('phoneScanLan') : t('phoneScanRemote')}</span>
        </div>
        <div className="phone-url">
          <code title={url}>{url}</code>
          <button title={t('copy')} aria-label={t('copy')} onClick={() => copy(url)}>
            <Icon name="copy" size={14} />
          </button>
        </div>
        <div className="phone-step">
          <span className="phone-num">2</span>
          <span>{t('phoneStep3')}</span>
        </div>
        <div className="phone-pin">
          {(status.pin ?? '').split('').map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </div>
        <p className="settings-hint">{note}</p>
      </div>
    </div>
  );

  return (
    <>
      <h3>{t('phoneTitle')}</h3>
      <p className="dim small">{t('phoneHint')}</p>

      <div className={`phone-hero ${state}`}>
        <span className="phone-hero-icon">
          <Icon name="smartphone" size={22} />
        </span>
        <span className="phone-hero-text">
          <span className="settings-label">{t('phoneEnable')}</span>
          <span className="phone-status">
            <i />
            {state === 'off'
              ? t('phoneOff')
              : state === 'ok'
                ? t('phoneConnected', { n: status.phones })
                : t('phoneWaiting')}
          </span>
          <span className="settings-hint">{t('phoneEnableHint')}</span>
        </span>
        <label className="phone-switch">
          <input
            type="checkbox"
            checked={status.running}
            disabled={busy}
            onChange={(e) => void toggle(e.target.checked)}
          />
          <span />
        </label>
      </div>

      {status.running && (
        <div className="phone-card">
          <div className="phone-tabs">
            <button className={where === 'lan' ? 'on' : ''} onClick={() => setWhere('lan')}>
              <Icon name="wifi" size={14} /> {t('phoneLan')}
            </button>
            <button className={where === 'remote' ? 'on' : ''} onClick={() => setWhere('remote')}>
              <Icon name="globe" size={14} /> {t('phoneRemote')}
              {remote?.url && <span className="phone-dot" />}
            </button>
          </div>

          {where === 'lan' && link && pairing(link, `${t('phoneLanSame')} ${t('phoneFirewall')}`)}

          {where === 'remote' && (
            <>
              {remote?.url ? (
                pairing(
                  remote.url,
                  remote.fixed
                    ? `${t('phoneFixedOn', { host: status.fixedHost ?? '' })}. ${t('phoneRemoteWarn')}`
                    : remote.permanent
                      ? `${t('phonePermanentNote')} ${t('phoneRemoteWarn')}`
                      : `${remote.relayError ?? t('phoneRandomNote')} ${t('phoneRemoteWarn')}`,
                )
              ) : (
                <div className="phone-remote-off">
                  <Icon name="globe" size={28} />
                  <p className="small">{t('phoneRemoteHint')}</p>
                  {remote?.progress && <p className="dim small">{remote.progress}</p>}
                  {remote?.error && <p className="phone-error small">{remote.error}</p>}
                  <button
                    className="primary"
                    disabled={busy || (remoteOn && !remote?.url)}
                    onClick={() => void toggleRemote(true)}
                  >
                    {busy || (remoteOn && !remote?.url)
                      ? t('phoneRemoteStarting')
                      : t('phoneRemoteOn')}
                  </button>
                </div>
              )}
              {remote?.url && (
                <div className="phone-card-foot">
                  <button disabled={busy} onClick={() => void toggleRemote(false)}>
                    {t('phoneRemoteOff')}
                  </button>
                </div>
              )}
              <FixedLink status={status} />
            </>
          )}
        </div>
      )}

      <PhoneAppCard status={status} onCopy={copy} />

      {status.running && <PhoneDevices status={status} />}

      {status.running && <PhoneAllowCard status={status} />}

      {status.running && <BotsSection pin={status.pin} />}
    </>
  );
}

/**
 * The Android app of the remote. This Zinarix ships it: a QR to download it from this computer
 * (same Wi-Fi, while the remote is on) and a button to save the .apk. Builds without it fall
 * back to the latest one on GitHub.
 */
function PhoneAppCard({ status, onCopy }: { status: PhoneStatus; onCopy: (text: string) => void }) {
  const [info, setInfo] = useState<{ version: string; bytes: number } | null | undefined>();
  useEffect(() => {
    let live = true;
    api()
      .phone.appInfo()
      .then((i) => live && setInfo(i))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, []);
  const link = (info && status.apkUrl) || REMOTE_APP_APK;
  const save = async () => {
    try {
      if (await api().phone.saveApp()) toast(t('phoneAppSaved'));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="phone-card phone-app">
      <div className="phone-pair">
        <QrCode text={link} />
        <div className="phone-steps">
          <span className="settings-label">
            <Icon name="smartphone" size={14} /> {t('phoneAppTitle')}
            {info && <span className="dim small"> · v{info.version}</span>}
          </span>
          <p className="settings-hint">{t('phoneAppHint')}</p>
          <p className="settings-hint">
            {info && status.apkUrl ? t('phoneAppStepsLocal') : t('phoneAppSteps')}
          </p>
          <div className="phone-url">
            <code title={link}>{link}</code>
            <button title={t('copy')} aria-label={t('copy')} onClick={() => onCopy(link)}>
              <Icon name="copy" size={14} />
            </button>
          </div>
          {info && (
            <div className="phone-app-actions">
              <button className="btn ghost" onClick={() => void save()}>
                <Icon name="download" size={14} /> {t('phoneAppSave')} (
                {Math.max(1, Math.round(info.bytes / 1024))} KB)
              </button>
            </div>
          )}
          <p className="settings-hint phone-app-ios">
            <Icon name="info" size={13} /> {t('phoneAppIos')}
          </p>
        </div>
      </div>
    </div>
  );
}

/** "now", "5 min ago"… */
function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return t('phoneNow');
  const n =
    s < 3600
      ? `${Math.round(s / 60)} min`
      : s < 86400
        ? `${Math.round(s / 3600)} h`
        : `${Math.round(s / 86400)} d`;
  return t('phoneAgo', { n });
}

/** The paired phones (kept across restarts): disconnect one or all. */
function PhoneDevices({ status }: { status: PhoneStatus }) {
  const devices = status.devices ?? [];
  const forget = async (id: string | null) => {
    if (!id && !(await confirmDialog(t('phoneForgetAllConfirm')))) return;
    setState({ phone: await api().phone.forget(id) });
  };
  return (
    <div className="phone-card phone-devices">
      <div className="phone-devices-head">
        <b>{t('phoneDevices')}</b>
        {status.autostart && <span className="dim small">{t('phoneAuto')}</span>}
      </div>
      {!devices.length && <p className="dim small">{t('phoneNoDevices')}</p>}
      {devices.map((d) => (
        <div className="phone-device" key={d.id}>
          <Icon name="smartphone" size={16} />
          <span className="phone-device-name">
            {d.name}
            <small className="dim">
              {t('phoneSeen', { when: ago(d.seen ?? d.at) })}
              {d.remote ? ` · ${t('phoneViaNet')}` : ''}
            </small>
          </span>
          <button onClick={() => void forget(d.id)}>{t('phoneForget')}</button>
        </div>
      ))}
      {devices.length > 1 && (
        <div className="phone-card-foot">
          <button className="danger" onClick={() => void forget(null)}>
            {t('phoneForgetAll')}
          </button>
        </div>
      )}
    </div>
  );
}

/** What the paired phones may use besides the chats: files, terminal, git. */
function PhoneAllowCard({ status }: { status: PhoneStatus }) {
  const allow = status.allow ?? { files: true, terminal: true, git: true };
  const set = async (patch: Partial<typeof allow>) => {
    setState({ phone: await api().phone.allow({ ...allow, ...patch }) });
  };
  return (
    <div className="phone-card phone-devices">
      <div className="phone-devices-head">
        <b>{t('phoneAllowTitle')}</b>
      </div>
      <p className="dim small">{t('phoneAllowHint')}</p>
      <Toggle
        label={t('phoneAllowFiles')}
        hint={t('phoneAllowFilesHint')}
        checked={allow.files}
        onChange={(files) => void set({ files })}
      />
      <Toggle
        label={t('phoneAllowTerminal')}
        hint={t('phoneAllowTerminalHint')}
        checked={allow.terminal}
        onChange={(terminal) => void set({ terminal })}
      />
      <Toggle
        label={t('phoneAllowGit')}
        hint={t('phoneAllowGitHint')}
        checked={allow.git}
        onChange={(git) => void set({ git })}
      />
      <Toggle
        label={t('phoneAllowConfig')}
        hint={t('phoneAllowConfigHint')}
        checked={allow.config !== false}
        onChange={(config) => void set({ config })}
      />
    </div>
  );
}

/** The user's own Cloudflare tunnel: an internet link that never changes. */
function FixedLink({ status }: { status: PhoneStatus }) {
  const [host, setHost] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (tunnel: { host: string; token: string } | null) => {
    setBusy(true);
    try {
      const phone = await api().phone.fixed(tunnel);
      setState({ phone });
      if (phone.error) toast(phone.error);
      else setToken('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="phone-fixed">
      <b className="small">{t('phoneFixedTitle')}</b>
      {status.fixedHost ? (
        <div className="phone-fixed-row">
          <span className="small">{t('phoneFixedOn', { host: status.fixedHost })}</span>
          <button disabled={busy} onClick={() => void save(null)}>
            {t('phoneFixedRemove')}
          </button>
        </div>
      ) : (
        <>
          <p className="settings-hint">{t('phoneFixedHint')}</p>
          <input
            placeholder={t('phoneFixedHost')}
            value={host}
            spellCheck={false}
            onChange={(e) => setHost(e.target.value)}
          />
          <input
            type="password"
            placeholder={t('phoneFixedToken')}
            value={token}
            autoComplete="off"
            onChange={(e) => setToken(e.target.value)}
          />
          <button
            className="primary"
            disabled={busy || !host.trim() || !token.trim()}
            onClick={() => void save({ host, token })}
          >
            {t('phoneFixedSave')}
          </button>
        </>
      )}
    </div>
  );
}

/** Telegram and Discord bots (official APIs): paste the token, then link the chat with the PIN. */
function BotsSection({ pin }: { pin?: string }) {
  const [bots, setBots] = useState<BotsStatus | null>(null);
  const [tokens, setTokens] = useState<Record<BotKind, string>>({ telegram: '', discord: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api()
      .bots.status()
      .then(setBots)
      .catch(() => undefined);
    return api().on((ev) => {
      if (ev.type === 'bots:status') setBots(ev.status);
    });
  }, []);
  const run = async (fn: () => Promise<BotsStatus>) => {
    setBusy(true);
    try {
      setBots(await fn());
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (!bots) return null;
  const bot = (kind: BotKind, title: string, steps: string) => {
    const b = bots[kind];
    return (
      <div className="bot-card">
        <h4>{title}</h4>
        {b.saved ? (
          <>
            <p className="small">
              {b.error
                ? b.error
                : b.connected
                  ? t('botConnected', { name: b.name ?? '' })
                  : t('botConnecting')}
            </p>
            {b.connected && (
              <p className="dim small">
                {b.paired > 0
                  ? t('botPaired', { n: b.paired })
                  : t('botPairHint', { name: b.name ?? '', pin: pin ?? '' })}
              </p>
            )}
            {kind === 'discord' && b.invite && (
              <div className="phone-url">
                <span className="small">{t('botInvite')}</span>
                <button
                  title={t('botInvite')}
                  aria-label={t('botInvite')}
                  onClick={() => void api().app.openExternal(b.invite!)}
                >
                  <Icon name="external" size={14} />
                </button>
              </div>
            )}
            <button
              disabled={busy}
              onClick={async () => {
                if (
                  !(await confirmDialog(t('botDisconnectConfirm', { name: title }), {
                    danger: true,
                  }))
                )
                  return;
                void run(() => api().bots.disconnect(kind));
              }}
            >
              {t('botDisconnect')}
            </button>
          </>
        ) : (
          <>
            <p className="dim small">{steps}</p>
            <div className="phone-url">
              <input
                type="password"
                aria-label={`${title} · ${t('botToken')}`}
                placeholder={t('botToken')}
                value={tokens[kind]}
                onChange={(e) => setTokens({ ...tokens, [kind]: e.target.value })}
              />
              <button
                disabled={busy || tokens[kind].trim().length < 20}
                onClick={() =>
                  void run(async () => {
                    const r = await api().bots.connect(kind, tokens[kind]);
                    setTokens({ ...tokens, [kind]: '' });
                    return r;
                  })
                }
              >
                {t('botConnect')}
              </button>
            </div>
          </>
        )}
      </div>
    );
  };
  return (
    <>
      <h3>{t('botsTitle')}</h3>
      <p className="dim small">{t('botsHint')}</p>
      {bot('telegram', 'Telegram', t('botTelegramSteps'))}
      {bot('discord', 'Discord', t('botDiscordSteps'))}
    </>
  );
}

/** B6: a color theme of an installed extension, next to the built-in ones. */
function ExtThemeCard({ th, active }: { th: ExtThemeChoice; active: boolean }) {
  return (
    <button
      className={`theme-card ${active ? 'on' : ''}`}
      title={th.extension}
      onClick={() => void showExtTheme(th.id)}
    >
      <span className="theme-preview" style={{ background: th.preview.bg }}>
        <span className="theme-side" style={{ background: th.preview.side }} />
        <span className="theme-lines">
          <span style={{ background: th.preview.accent, width: '55%' }} />
          <span style={{ background: th.preview.fg, width: '80%', opacity: 0.5 }} />
          <span style={{ background: th.preview.fg, width: '40%', opacity: 0.5 }} />
        </span>
      </span>
      <span className="theme-name">{th.label}</span>
    </button>
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

/**
 * What the search box of the dialog looks through: every setting with its visible label (the
 * dialog scrolls to the row with that text), plus words people type that the label lacks.
 */
function settingEntries(isOwner: boolean): SettingEntry[] {
  const out: SettingEntry[] = [];
  const add = (
    section: Section,
    sectionLabel: string,
    rows: [label: string, hint?: string, keywords?: string][],
  ) => {
    for (const [label, hint, keywords] of rows) {
      out.push({ section, sectionLabel, label, hint, keywords });
    }
  };
  add('appearance', t('setAppearance'), [
    [t('setTheme'), undefined, 'theme tema color dark light oscuro claro'],
    [t('setLanguage'), t('setLanguageHint'), 'language idioma español english inglés'],
    [t('setUiZoom'), t('setUiZoomHint'), 'zoom scale escala tamaño interfaz'],
    [tl('lyWindowEffects'), tl('lyWindowEffectsHint'), 'animations animaciones blur transparencia'],
    [t('setFontSize'), undefined, 'font size fuente letra tamaño'],
    [t('setFontFamily'), undefined, 'font family fuente letra tipografía'],
  ]);
  add('editor', t('setEditor'), [
    [t('setTabSize'), undefined, 'tab indent sangría espacios tabulación'],
    [t('setWordWrap'), undefined, 'word wrap ajuste de línea'],
    [t('setMinimap'), undefined, 'minimap minimapa'],
    [t('setLineNumbers'), undefined, 'line numbers números de línea'],
    [t('setFormatOnSave'), t('setFormatOnSaveHint'), 'format prettier formatear'],
    [t('setAutoSave'), t('setAutoSaveHint'), 'autosave guardado automático'],
  ]);
  add('ai', t('setAi'), [
    [t('setInline'), t('setInlineHint'), 'autocomplete autocompletado copilot ghost text tab'],
    [t('setInlineModel'), undefined, 'model modelo autocomplete'],
    [tlsp('nextEditSetting'), tlsp('nextEditSettingHint'), 'next edit siguiente edición'],
    [tlsp('autoImportSetting'), tlsp('autoImportSettingHint'), 'import importar'],
    [t('setRules'), t('setRulesHint'), 'rules reglas agents.md instrucciones'],
    [t('setLocalOnly'), t('setLocalOnlyHint'), 'local offline privacy privacidad ollama'],
    [t('hlpSetTitle'), undefined, 'helper ayudante assistant'],
  ]);
  add('mcp', 'MCP', [['MCP', undefined, 'servers servidores tools herramientas plugins']]);
  add('memories', t('setMemories'), [
    [t('setMemories'), undefined, 'memory memoria recordar remember'],
  ]);
  add('docs', t('setDocsNav'), [
    [t('setDocs'), undefined, 'docs documentation documentación index indexar'],
    [t('setEmbed'), undefined, 'embeddings semantic search búsqueda semántica'],
  ]);
  add('cloud', t('cloudTitle'), [
    [t('cloudTitle'), undefined, 'sync sincronizar backup respaldo cuenta account'],
  ]);
  add('browser', t('setBrowser'), [
    [t('browserCookiesTitle'), undefined, 'cookies sesión login'],
    [t('browserCookiesDirectTitle'), undefined, 'cookies'],
    [t('browserDataTitle'), undefined, 'clear data borrar datos caché cache historial'],
  ]);
  add('phone', t('phoneTitle'), [
    [t('phoneEnable'), t('phoneEnableHint'), 'phone celular móvil remote remoto qr'],
    [t('botsTitle'), undefined, 'telegram discord bot'],
  ]);
  add('account', ta('title'), [
    [
      ta('title'),
      ta('lead'),
      'login sign in register cuenta sesión registrarse usuario contraseña',
    ],
    [ta('licenses'), undefined, 'license licencia clave key plan pro'],
    [ta('messages'), undefined, 'avisos noticias news notice'],
  ]);
  if (isOwner) {
    const owner = lang === 'en' ? 'Keys (owner)' : 'Claves (dueño)';
    add('owner', owner, [[owner, undefined, 'license licencia keys claves']]);
  }
  const defaults = defaultKeys();
  const custom = getState().prefs.keybindings;
  for (const c of commands()) {
    if (c.id === 'app.requestClose') continue;
    out.push({
      section: 'keys',
      sectionLabel: t('shortcuts'),
      label: c.label,
      keywords: custom[c.id] ?? defaults[c.id] ?? '',
      command: c.id,
    });
  }
  return out;
}

/** Scrolls the open section to the row with this label and flashes it once. */
function revealSetting(body: HTMLElement | null, label: string): void {
  if (!body) return;
  const want = fold(label).trim();
  const rows = body.querySelectorAll<HTMLElement>(
    '.settings-label, .settings-field > span:first-child, h3, h4, .settings-sub button, .keys-table td:first-child',
  );
  for (const el of rows) {
    const text = fold(el.textContent ?? '').trim();
    if (text !== want && !text.startsWith(want)) continue;
    const row =
      el.closest<HTMLElement>('.settings-toggle, .settings-field, .settings-sub, tr') ?? el;
    row.scrollIntoView({ block: 'center' });
    row.classList.remove('settings-hit');
    void row.offsetWidth;
    row.classList.add('settings-hit');
    setTimeout(() => row.classList.remove('settings-hit'), 1800);
    return;
  }
}

export function SettingsPanel() {
  const prefs = useStore((s) => s.prefs);
  const settings = useStore((s) => s.settings);
  // B6: the theme of an extension in use (and the list of them) changes outside the store.
  const extTheme = useSyncExternalStore(onExtensions, activeExtTheme);
  const extVersion = useSyncExternalStore(onExtensions, extensionsVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- extVersion is what changes the list
  const extChoices = useMemo(() => extThemes(), [extVersion]);
  const isOwner = useStore((s) => s.license.plan === 'owner');
  const [section, setSection] = useState<Section>(() => {
    const m = getState().modal;
    return m?.kind === 'settings' && m.section ? (m.section as Section) : 'appearance';
  });
  const [recording, setRecording] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Label to scroll to once the section it lives in has rendered. */
  const [reveal, setReveal] = useState<{ label: string; n: number } | null>(null);
  const searching = query.trim() !== '';
  // Built when the search starts; the labels do not change while the dialog is open.
  const entries = useMemo(() => (searching ? settingEntries(isOwner) : []), [searching, isOwner]);
  const hits = useMemo(() => searchSettings(entries, query), [entries, query]);
  const openHit = (hit: SettingHit) => {
    setSection(hit.section as Section);
    if (hit.command) setFilter(hit.label);
    setReveal({ label: hit.label, n: Date.now() });
  };
  useEffect(() => {
    if (!reveal) return;
    let done = false;
    // Sections that load their data first (MCP, cloud…) draw their rows a moment later.
    const timers = [0, 150, 500].map((ms) =>
      setTimeout(() => {
        if (done) return;
        revealSetting(bodyRef.current, reveal.label);
        done = !!bodyRef.current?.querySelector('.settings-hit');
      }, ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [reveal]);

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
    <ModalShell onClose={close} className="settings" labelledBy="settings-title">
      <nav className="settings-nav">
        <div className="settings-title" id="settings-title">
          <Icon name="settings" size={16} /> {t('settings')}
        </div>
        <input
          className="settings-search"
          type="search"
          role="combobox"
          aria-expanded={searching}
          aria-controls="settings-hits"
          aria-label={t('setSearch')}
          placeholder={t('setSearch')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPicked(0);
          }}
          onKeyDown={(e) => {
            if (!searching) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const step = e.key === 'ArrowDown' ? 1 : -1;
              setPicked((p) => Math.max(0, Math.min(hits.length - 1, p + step)));
            } else if (e.key === 'Enter' && hits[picked]) {
              e.preventDefault();
              openHit(hits[picked]!);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setQuery('');
            }
          }}
        />
        {searching && (
          <div className="settings-hits" id="settings-hits" role="listbox">
            {hits.length === 0 && <p className="dim small">{t('setSearchNone')}</p>}
            {hits.map((hit, i) => (
              <button
                key={`${hit.section}:${hit.command ?? hit.label}`}
                role="option"
                aria-selected={i === picked}
                className={i === picked ? 'on' : ''}
                onClick={() => {
                  setPicked(i);
                  openHit(hit);
                }}
              >
                <span className="settings-hit-label">{hit.label}</span>
                <span className="settings-hit-section">{hit.sectionLabel}</span>
              </button>
            ))}
          </div>
        )}
        {!searching && (
          <>
            {nav('appearance', t('setAppearance'), 'palette')}
            {nav('editor', t('setEditor'), 'edit')}
            {nav('ai', t('setAi'), 'agent')}
            {nav('mcp', 'MCP', 'plug')}
            {nav('memories', t('setMemories'), 'archive')}
            {nav('docs', t('setDocsNav'), 'books')}
            {nav('cloud', t('cloudTitle'), 'cloud')}
            {nav('browser', t('setBrowser'), 'globe')}
            {nav('phone', t('phoneTitle'), 'smartphone')}
            {nav('account', ta('title'), 'users')}
            {nav('keys', t('shortcuts'), 'keyboard')}
            {isOwner && nav('owner', lang === 'en' ? 'Keys (owner)' : 'Claves (dueño)', 'key')}
          </>
        )}
      </nav>
      <div className="settings-body" ref={bodyRef}>
        <button className="modal-x" onClick={close} aria-label={t('close')} title={t('close')}>
          <Icon name="close" size={16} />
        </button>
        {section === 'appearance' && (
          <>
            <div className="settings-quiz">
              <span className="dim small">
                {lang === 'en'
                  ? 'Answer the getting started questions again to adapt the panels and the help to you.'
                  : 'Responde otra vez las preguntas de inicio para adaptar los paneles y la ayuda a ti.'}
              </span>
              <button className="small" onClick={() => setState({ modal: { kind: 'quiz' } })}>
                <Icon name="refresh" size={13} />{' '}
                {lang === 'en' ? 'Repeat questionnaire' : 'Repetir cuestionario'}
              </button>
            </div>
            <h3>{t('setTheme')}</h3>
            <div className="theme-grid">
              {THEME_IDS.map((id) => (
                <ThemeCard key={id} id={id} active={!extTheme && settings.theme === id} />
              ))}
              {extChoices.map((th) => (
                <ExtThemeCard key={th.id} th={th} active={extTheme === th.id} />
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <button
                className="small"
                onClick={() => setState({ sidebar: 'extensions', modal: null })}
              >
                <Icon name="layers" size={13} /> {lang === 'en' ? 'More themes…' : 'Más temas…'}
              </button>
            </div>
            <h3>{t('setLanguage')}</h3>
            <label className="settings-field">
              <span>{t('setLanguageHint')}</span>
              <select
                value={lang}
                onChange={(e) => {
                  // Two languages: picking the other one is the palette's "switch language".
                  if (e.target.value !== lang) void runCommand('app.language');
                }}
              >
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </label>
            <h3>{t('setUiZoom')}</h3>
            <label className="settings-field">
              <span>{t('setUiZoomHint')}</span>
              <span className="settings-range">
                <input
                  type="range"
                  min={50}
                  max={300}
                  step={5}
                  value={prefs.uiZoom}
                  onChange={(e) => void updatePrefs({ uiZoom: Number(e.target.value) })}
                />
                <b>{prefs.uiZoom}%</b>
              </span>
            </label>
            <Toggle
              label={tl('lyWindowEffects')}
              hint={tl('lyWindowEffectsHint')}
              checked={prefs.windowEffects !== false}
              onChange={(v) => void updatePrefs({ windowEffects: v })}
            />
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
                {!FONTS.includes(prefs.fontFamily) && <option value="">{prefs.fontFamily}</option>}
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
            <SuggestionSettings />
            <Toggle
              label={t('setRules')}
              hint={t('setRulesHint')}
              checked={prefs.projectRules}
              onChange={(v) => void updatePrefs({ projectRules: v })}
            />
            <div className="settings-sub">
              <button onClick={() => (close(), void runCommand('ai.rules'))}>
                <Icon name="scroll" size={13} /> {t('rulesEdit')}
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
            <HelperSettings />
          </>
        )}

        {section === 'memories' && <MemoriesSection />}
        {section === 'docs' && <DocsSection />}
        {section === 'mcp' && <McpSection />}
        {section === 'cloud' && <CloudSection />}
        {section === 'browser' && <BrowserSection />}

        {section === 'phone' && <PhoneSection />}
        {section === 'account' && <AccountSection />}

        {section === 'owner' && isOwner && <OwnerKeysSection />}

        {section === 'keys' && (
          <>
            <h3>{t('shortcuts')}</h3>
            <p className="dim small">{t('setKeysHint')}</p>
            <input
              className="settings-filter"
              aria-label={t('setKeysFilter')}
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
                            aria-label={`${c.label} · ${t('setKeysPress')}`}
                            readOnly
                            value={t('setKeysPress')}
                            onBlur={() => setRecording(null)}
                            onKeyDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (e.key === 'Escape') return setRecording(null);
                              const combo = comboFromEvent(e.nativeEvent);
                              if (!combo) return;
                              setRecording(null);
                              void assignKey(c.id, combo);
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
                            aria-label={`${t('setKeysReset')}: ${c.label}`}
                            onClick={() => {
                              const { [c.id]: _gone, ...rest } = prefs.keybindings;
                              void updatePrefs({ keybindings: rest });
                            }}
                          >
                            <Icon name="undo" size={13} />
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
    </ModalShell>
  );
}
