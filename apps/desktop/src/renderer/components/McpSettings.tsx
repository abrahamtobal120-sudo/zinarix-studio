import { useEffect, useState } from 'react';
import type { McpProjectView, McpServerView } from '../../shared/api';
import { t } from '../i18n';
import { api, toast } from '../store';
import { Icon } from './Icon';

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
    const r = await api().mcp.saveConfig(text);
    setErrors(r.errors);
    if (!r.errors.length) {
      setText(null);
      toast(t('mcpSaved'));
    }
    void refresh();
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
          {project.errors.map((e) => (
            <div key={e} className="small mcp-err">
              {e}
            </div>
          ))}
          <button onClick={() => void api().mcp.trustProject(!project.trusted).then(refresh)}>
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
                  <button onClick={() => setOpen(open === s.id ? null : s.id)}>
                    {t('mcpTools')}
                  </button>
                )}
                <button title={t('mcpRestart')} onClick={() => void api().mcp.restart(s.id).then(refresh)}>
                  <Icon name="undo" size={13} />
                </button>
                {s.scope === 'global' && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!s.disabled}
                      onChange={(e) => void api().mcp.setEnabled(s.name, e.target.checked).then(refresh)}
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
                    <code>{x.name}</code> {x.description && <span className="dim">— {x.description}</span>}
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
            value={text}
            rows={16}
            onChange={(e) => setText(e.target.value)}
          />
          {errors.map((e) => (
            <div key={e} className="small mcp-err">
              {e}
            </div>
          ))}
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
