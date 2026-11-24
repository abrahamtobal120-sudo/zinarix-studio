import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LSP_LANGUAGES, installCommand, type LspStatus } from '../../shared/lsp';
import { tl } from '../i18nLsp';
import { lspStatuses, onLspStatus } from '../lsp';
import { api, getDoc, setState, toast, useStore } from '../store';
import { Icon } from './Icon';
import { runInTerminal } from './Terminal';
import './lsp-status.css';

const platform: 'win32' | 'darwin' | 'linux' = navigator.platform.toLowerCase().includes('win')
  ? 'win32'
  : navigator.platform.toLowerCase().includes('mac')
    ? 'darwin'
    : 'linux';

let snapshot: LspStatus[] = lspStatuses();
const subscribe = (l: () => void) =>
  onLspStatus(() => {
    snapshot = lspStatuses();
    l();
  });

/**
 * Fase 0 (plan de funciones): the language server of the file being edited, in the status bar.
 * When none is installed it says so (until now only a toast did) and installs one with a click:
 * the command goes to the built-in terminal, then "Look again" restarts the servers.
 */
export function LspStatusItem() {
  const active = useStore((s) => (s.active?.startsWith('::') ? null : s.active));
  const statuses = useSyncExternalStore(subscribe, () => snapshot);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const language = active ? getDoc(active)?.model.getLanguageId() : undefined;
  const status = language ? statuses.find((s) => s.language === language) : undefined;
  const entry = language ? LSP_LANGUAGES.find((l) => l.ids.includes(language)) : undefined;

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!status || status.state === 'off') return null;
  const label = status.label;
  const text =
    status.state === 'ready'
      ? tl('lspStatusReady', { label, server: status.server ?? '' })
      : status.state === 'missing'
        ? tl('lspStatusMissing', { label })
        : status.state === 'error'
          ? tl('lspStatusError', { label })
          : tl('lspStatusStarting', { label });

  const install = (cmd: string) => {
    setOpen(false);
    setState({ panelOpen: true });
    setTimeout(() => void runInTerminal(cmd), 300);
  };
  const retry = async () => {
    setBusy(true);
    toast(tl('lspRetrying'));
    try {
      await api().lsp.restart();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div className="lsp-status" ref={box}>
      <button
        type="button"
        className={`status-item lsp-trigger ${status.state}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={text}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon
          name={status.state === 'missing' || status.state === 'error' ? 'warning' : 'code'}
          size={13}
        />{' '}
        {status.state === 'ready' ? status.server : text}
      </button>
      {open && (
        <div className="lsp-pop" role="dialog" aria-label={text}>
          {status.state === 'ready' && (
            <p>{tl('lspPopReady', { label, server: status.server ?? '' })}</p>
          )}
          {status.state === 'error' && (
            <p>{tl('lspPopError', { label, detail: status.detail ?? '' })}</p>
          )}
          {(status.state === 'missing' || status.state === 'error') && entry && (
            <>
              {status.state === 'missing' && <p>{tl('lspPopMissing', { label })}</p>}
              <ul className="lsp-cands">
                {entry.candidates.map((c) => {
                  const cmd = installCommand(c.install, platform);
                  return (
                    <li key={c.name}>
                      <strong>{c.name}</strong>
                      {cmd ? (
                        <>
                          <code>{cmd}</code>
                          <button
                            className="btn"
                            title={tl('lspInstallHint')}
                            onClick={() => install(cmd)}
                          >
                            {tl('lspInstall')}
                          </button>
                        </>
                      ) : (
                        <span className="lsp-manual">{tl('lspManual', { hint: c.install })}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div className="lsp-actions">
            <button className="btn" disabled={busy} onClick={() => void retry()}>
              {busy
                ? tl('lspRetrying')
                : status.state === 'ready'
                  ? tl('lspRestart')
                  : tl('lspRetry')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
