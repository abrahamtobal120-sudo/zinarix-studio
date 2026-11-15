import { useEffect, useState } from 'react';
import type { McpProjectView, McpServerView } from '../../shared/api';
import { confirmDialog } from '../confirm';
import { t } from '../i18n';
import { api, toast } from '../store';
import { Icon } from './Icon';

/** "name: command args" / "name: url" lines of the servers an MCP file would start. */
async function projectServers(file: string): Promise<string[] | null> {
  try {
    const f = await api().workspace.readFile(file);
    if (f.binary || f.tooLarge) return null;
    const json = JSON.parse(f.content) as Record<string, unknown> | null;
    const list = (json?.mcpServers ?? json?.servers) as Record<string, unknown> | undefined;
    if (!list || typeof list !== 'object') return [];
    return Object.entries(list).map(([name, raw]) => {
      const c = (raw ?? {}) as { command?: unknown; args?: unknown; url?: unknown };
      const target =
        typeof c.url === 'string'
          ? c.url
          : [c.command ?? '', ...(Array.isArray(c.args) ? c.args : [])].map(String).join(' ');
      return `• ${name}: ${target.slice(0, 300)}`;
    });
  } catch {
    return null;
  }
}

const EXAMPLE = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/ruta/a/carpeta"]
    },
    "remoto": {
      "url": "https://ejemplo.com/mcp",
      "headers": { "Authorization": "Bearer TU_TOKEN" }
    }
  }
}
`;

/** Settings → MCP: servers whose tools Zinarix's agent can use (Cursor / Claude format). */
export function McpSection() {
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [project, setProject] = useState<McpProjectView | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const r = await api().mcp.status();
      setServers(r.servers);
      setProject(r.project);
    } catch {
      // window closing
    }
  };

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, []);

  const edit = async () => setText(await api().mcp.config());
  const save = async () => {
    if (text === null) return;
    let r: Awaited<ReturnType<ReturnType<typeof api>['mcp']['saveConfig']>>;
    try {
      r = await api().mcp.saveConfig(text);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
      return;
    }
    setErrors(r.errors);
    if (!r.errors.length) {
      setText(null);
      toast(t('mcpSaved'));
    }
    void refresh();
  };

  /** Trusting runs the project's commands on this computer: shown and confirmed first. */
  const toggleTrust = async (p: McpProjectView) => {
    if (!p.trusted && p.file) {
      const lines = await projectServers(p.file);
      const what =
        lines === null
          ? t('mcpTrustUnreadable')
          : lines.length
            ? lines.join('\n')
            : t('mcpTrustNone');
      if (
        !(await confirmDialog(t('mcpTrustConfirm', { file: p.file, list: what }), {
          danger: true,
          okLabel: t('mcpTrust'),
        }))
      )
        return;
    }
    try {
      await api().mcp.trustProject(!p.trusted);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
    await refresh();
  };

  const state = (s: McpServerView) =>
    s.state === 'connected'
      ? t('mcpConnected', { n: s.tools.length })
      : s.state === 'error'
        ? t('mcpError')
        : s.state === 'off'
          ? t('mcpOff')
          : t('mcpConnecting');

  return (
    <>
      <h3>MCP</h3>
      <p className="dim small">{t('mcpHint')}</p>
      {project?.file && (
        <div className={`mcp-project ${project.trusted ? 'ok' : 'warn'}`}>
          <div>
            <b>{t('mcpProjectFile')}</b> <code>{project.file}</code>
          </div>
          {!project.trusted && <div className="small">{t('mcpProjectWarn')}</div>}
          {project.errors.length > 0 && (
            <div role="alert">
              {project.errors.map((e) => (
                <div key={e} className="small mcp-err">
                  {e}
                </div>
              ))}
            </div>
          )}
          <button onClick={() => void toggleTrust(project)}>
            {project.trusted ? t('mcpUntrust') : t('mcpTrust')}
          </button>
        </div>
      )}
      <div className="mcp-list">
        {servers.length === 0 && <p className="dim small">{t('mcpNone')}</p>}
        {servers.map((s) => (
          <div key={s.id} className="mcp-server">
            <div className="mcp-row">
              <span className={`mcp-dot ${s.state}`} />
              <b>{s.name}</b>
              <span className="dim small">
                {s.scope === 'project' ? t('mcpScopeProject') : t('mcpScopeGlobal')} · {s.kind}
              </span>
              <span className="mcp-state small">{state(s)}</span>
              <span className="mcp-actions">
                {s.tools.length > 0 && (
                  <button
                    aria-expanded={open === s.id}
                    onClick={() => setOpen(open === s.id ? null : s.id)}
                  >
                    {t('mcpTools')}
                  </button>
                )}
                <button
                  title={t('mcpRestart')}
                  aria-label={`${t('mcpRestart')}: ${s.name}`}
                  onClick={() => void api().mcp.restart(s.id).then(refresh)}
                >
                  <Icon name="undo" size={13} />
                </button>
                {s.scope === 'global' && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!s.disabled}
                      onChange={(e) =>
                        void api().mcp.setEnabled(s.name, e.target.checked).then(refresh)
                      }
                    />
                    {t('mcpEnabled')}
                  </label>
                )}
              </span>
            </div>
            <div className="dim small mcp-target">{s.target}</div>
            {s.error && <div className="small mcp-err">{s.error}</div>}
            {open === s.id && (
              <ul className="mcp-tools small">
                {s.tools.map((x) => (
                  <li key={x.name}>
                    <code>{x.name}</code>{' '}
                    {x.description && <span className="dim">— {x.description}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {text === null ? (
        <div className="settings-sub">
          <button onClick={() => void edit()}>
            <Icon name="edit" size={13} /> {t('mcpEdit')}
          </button>
        </div>
      ) : (
        <div className="mcp-editor">
          <textarea
            spellCheck={false}
            aria-label={t('mcpEdit')}
            value={text}
            rows={16}
            onChange={(e) => setText(e.target.value)}
          />
          {errors.length > 0 && (
            <div role="alert">
              {errors.map((e) => (
                <div key={e} className="small mcp-err">
                  {e}
                </div>
              ))}
            </div>
          )}
          <div className="mcp-editor-bar">
            <button className="primary" onClick={() => void save()}>
              {t('cmdSave')}
            </button>
            <button onClick={() => setText(null)}>{t('cancel')}</button>
            <button onClick={() => setText(EXAMPLE)}>{t('mcpExample')}</button>
          </div>
          <p className="dim small">{t('mcpSecretsNote')}</p>
        </div>
      )}
    </>
  );
}
