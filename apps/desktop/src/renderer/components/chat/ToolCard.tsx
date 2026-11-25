import { memo, useEffect, useRef, useState } from 'react';
import type { ToolDecision } from '../../../shared/api';
import { t } from '../../i18n';
import { languageFor, monaco } from '../../monaco';
import { monacoTheme } from '../../themes';
import { useStore } from '../../store';
import { Icon, type IconName } from '../Icon';
import { ProviderLogo } from '../ProviderLogo';
import { Markdown } from '../Markdown';
import { QuestionCard } from '../AgentPlan';
import type { ToolStep } from './types';

export const TOOL_ICON: Record<string, IconName> = {
  list_dir: 'folder',
  read_file: 'file',
  search: 'search',
  edit_file: 'edit',
  write_file: 'filePlus',
  run_command: 'terminal',
  tree: 'tree',
  glob: 'filter',
  read_many_files: 'books',
  browser_open: 'globe',
  browser_read: 'eye',
  browser_click: 'pointer',
  browser_type: 'keyboard',
  browser_scroll: 'arrowsV',
  browser_back: 'back',
  network_status: 'wifi',
  http_request: 'plug',
  sql_query: 'database',
  read_system_file: 'file',
  write_system_file: 'wrench',
  set_env_var: 'settings',
  security_scan_project: 'shield',
  audit_dependencies: 'package',
  security_check_system: 'monitor',
  port_scan: 'wifi',
  check_site_security: 'lock',
  file_hash: 'hash',
  list_ai_models: 'cpu',
  delegate_to_ai: 'users',
  mail_accounts: 'users',
  mail_folders: 'folder',
  mail_list: 'mail',
  mail_read: 'mail',
  mail_mark: 'star',
  mail_move: 'archive',
  mail_save_draft: 'mail',
  mail_send: 'send',
  supabase_accounts: 'users',
  supabase_projects: 'supabase',
  supabase_project_info: 'supabase',
  supabase_tables: 'database',
  supabase_columns: 'columns',
  supabase_query: 'database',
  supabase_pause: 'pause',
  supabase_restore: 'play',
  vercel_accounts: 'users',
  vercel_projects: 'vercel',
  vercel_project: 'vercel',
  vercel_deployments: 'cloud',
  vercel_logs: 'scroll',
  vercel_redeploy: 'refresh',
  vercel_promote: 'arrowDown',
  vercel_cancel: 'stop',
  vercel_set_env: 'key',
};

export const STATUS_ICON: Record<ToolStep['status'], IconName> = {
  running: 'clock',
  approval: 'pause',
  ok: 'check',
  error: 'x',
};

/** Account a mail / Supabase / Vercel tool works on, when the AI picked one ("" for the one open in the panel). */
export function mailFrom(a: Record<string, unknown>): string {
  return typeof a.account === 'string' && a.account ? `${a.account} · ` : '';
}

export function toolTitle(step: ToolStep): string {
  const a = step.args;
  switch (step.name) {
    case 'run_command':
      return String(a.command ?? '');
    case 'search':
      return `"${String(a.query ?? '')}"`;
    case 'glob':
      return String(a.pattern ?? '');
    case 'read_many_files':
      return Array.isArray(a.paths) ? a.paths.join(', ') : String(a.pattern ?? '');
    case 'browser_open':
      return String(a.url ?? '');
    case 'browser_click':
      return `[${String(a.ref ?? '')}]`;
    case 'browser_type':
      return `[${String(a.ref ?? '')}] "${String(a.text ?? '')}"`;
    case 'browser_scroll':
      return String(a.direction ?? '');
    case 'browser_read':
    case 'browser_back':
      return '';
    case 'network_status':
    case 'port_scan':
      return String(a.target ?? '');
    case 'check_site_security':
      return String(a.url ?? '');
    case 'http_request':
      return `${String(a.method ?? 'GET')} ${String(a.url ?? '')}`;
    case 'sql_query':
      return String(a.query ?? '');
    case 'set_env_var':
      return `${String(a.name ?? '')} (${a.scope === 'user' ? t('envPermanent') : t('envSession')})`;
    case 'list_ai_models':
      return '';
    case 'delegate_to_ai':
      return `${String(a.model ?? '')} · ${String(a.task ?? '').slice(0, 120)}`;
    case 'mail_accounts':
    case 'supabase_accounts':
    case 'vercel_accounts':
      return '';
    case 'supabase_projects':
    case 'vercel_projects':
      return [a.account, a.team].filter(Boolean).map(String).join(' · ');
    case 'supabase_project_info':
    case 'supabase_tables':
    case 'supabase_pause':
    case 'supabase_restore':
      return `${mailFrom(a)}${String(a.ref ?? '')}`;
    case 'supabase_columns':
      return `${mailFrom(a)}${String(a.ref ?? '')} · ${String(a.schema ?? 'public')}.${String(a.table ?? '')}`;
    case 'supabase_query':
      return `${mailFrom(a)}${String(a.ref ?? '')} · ${String(a.sql ?? '').slice(0, 160)}`;
    case 'vercel_project':
    case 'vercel_deployments':
      return `${mailFrom(a)}${String(a.project ?? '')}`;
    case 'vercel_logs':
    case 'vercel_cancel':
      return `${mailFrom(a)}${String(a.deployment ?? '')}`;
    case 'vercel_redeploy':
      return `${mailFrom(a)}${String(a.deployment ?? '')}${a.production === true ? ' → production' : ''}`;
    case 'vercel_promote':
      return `${mailFrom(a)}${String(a.project ?? '')} → ${String(a.deployment ?? '')}`;
    case 'vercel_set_env':
      return `${mailFrom(a)}${String(a.project ?? '')} · ${String(a.key ?? '')}`;
    case 'mail_folders':
      return mailFrom(a).replace(/ · $/, '');
    case 'mail_list':
      return `${mailFrom(a)}${String(a.folder ?? 'INBOX')}${a.query ? ` · "${String(a.query)}"` : ''}`;
    case 'mail_read':
    case 'mail_mark':
      return `${mailFrom(a)}${String(a.folder ?? 'INBOX')} #${String(a.uid ?? '')}`;
    case 'mail_move':
      return `${mailFrom(a)}${String(a.folder ?? 'INBOX')} #${String(a.uid ?? '')} → ${String(a.to ?? '')}`;
    case 'mail_save_draft':
    case 'mail_send':
      return `${mailFrom(a)}${String(a.to ?? '')} · ${String(a.subject ?? '')}`;
    default:
      return String(a.path ?? '.');
  }
}

export function DiffView({ before, after, path }: { before: string; after: string; path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useStore((s) => s.settings.theme);
  useEffect(() => {
    if (!host.current) return;
    const lang = languageFor(path);
    const a = monaco.editor.createModel(before, lang);
    const b = monaco.editor.createModel(after, lang);
    const diff = monaco.editor.createDiffEditor(host.current, {
      readOnly: true,
      renderSideBySide: false,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      theme: monacoTheme(theme),
      hideUnchangedRegions: { enabled: true },
      fontSize: 12,
    });
    diff.setModel({ original: a, modified: b });
    return () => {
      diff.dispose();
      a.dispose();
      b.dispose();
    };
  }, [before, after, path, theme]);
  return <div className="tool-diff" ref={host} />;
}

export const ToolCard = memo(function ToolCard({
  step,
  rid,
  onDecide: decideFor,
  onAnswer,
}: {
  step: ToolStep;
  rid?: string;
  onDecide: (toolCallId: string, d: ToolDecision, rid?: string) => void;
  onAnswer: (toolCallId: string, answer: string[] | null, rid?: string) => void;
}) {
  const onDecide = (d: ToolDecision) => decideFor(step.id, d, rid);
  const [open, setOpen] = useState(step.status === 'approval');
  useEffect(() => {
    if (step.status === 'approval') setOpen(true);
  }, [step.status]);
  const icon = TOOL_ICON[step.name] ?? 'wrench';
  const p = step.preview;
  return (
    <div className={`tool-card ${step.status} ${p?.risk ? `risk-${p.risk}` : ''}`}>
      <button
        type="button"
        className="tool-head plain-btn"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="tool-icon">
          <Icon name={icon} size={14} />
        </span>
        {step.agent && (
          <span className="tool-helper" title={t('helperTitle', { model: step.agent })}>
            <ProviderLogo id={step.agent.split('/')[0]!} size={12} />
            {step.agent.split('/').slice(1).join('/')}
          </span>
        )}
        <span className="tool-name">{step.name}</span>
        <span className="tool-arg" title={toolTitle(step)}>
          {toolTitle(step)}
        </span>
        <span className="tool-status">
          {step.summary ? `${step.summary} ` : ''}
          <Icon
            name={STATUS_ICON[step.status]}
            size={13}
            className={step.status === 'running' ? 'spin-slow' : undefined}
          />
        </span>
        <span className={`tool-chevron ${open ? 'open' : ''}`}>
          <Icon name="chevron" size={12} />
        </span>
      </button>
      {open && (
        <div className="tool-body">
          {p?.warning && step.status === 'approval' && (
            <div className={`tool-warning ${p.risk ?? 'medium'}`}>
              <span className="tool-risk">
                {p.risk === 'high' ? t('riskHigh') : t('riskMedium')}
              </span>
              <span>{p.warning}</span>
            </div>
          )}
          {p?.delegate && (
            <div className="tool-delegate">
              <ProviderLogo id={p.delegate.model.split('/')[0]!} size={18} />
              <div>
                <b>{p.delegate.model}</b>
                <span>{p.delegate.mode === 'agent' ? t('delegateAgent') : t('delegateChat')}</span>
              </div>
            </div>
          )}
          {p?.action && p.url === undefined && !p.delegate && (
            <div className="tool-web">
              <b>{p.action}</b>
              {p.path && p.before === undefined ? (
                <>
                  {' '}
                  · <span className="tool-url">{p.path}</span>
                </>
              ) : null}
            </div>
          )}
          {p?.command !== undefined && (
            <pre className={`tool-cmd ${p.delegate ? 'tool-task' : ''}`}>
              {step.name === 'run_command' ? `$ ${p.command}` : p.command}
            </pre>
          )}
          {p?.url !== undefined && (
            <div className="tool-web">
              <Icon name="globe" size={13} /> <b>{p.action}</b> ·{' '}
              <span className="tool-url">{p.url}</span>
            </div>
          )}
          {p?.path !== undefined && p.before !== undefined && p.after !== undefined && (
            <DiffView before={p.before} after={p.after} path={p.path} />
          )}
          {step.output &&
            (step.name === 'delegate_to_ai' ? (
              <div className="tool-output tool-helper-answer">
                <Markdown text={step.output.slice(-20000)} streaming={step.status === 'running'} />
              </div>
            ) : (
              <pre className="tool-output">{step.output.slice(-20000)}</pre>
            ))}
        </div>
      )}
      {step.status === 'approval' && step.name === 'ask_user' && p?.question && (
        <QuestionCard q={p.question} onAnswer={(a) => onAnswer(step.id, a, rid)} />
      )}
      {step.status === 'approval' && step.name !== 'ask_user' && (
        <div className="tool-actions" role="alert" aria-label={t('approve')}>
          <button className="primary" onClick={() => onDecide('approve')}>
            <Icon name="check" size={14} /> {t('approve')}
          </button>
          {!p?.noAlways && (
            // "Always" for run_command only covers this exact command (approvalKey in main/agent.ts).
            <button
              title={
                step.name === 'run_command'
                  ? t('approveAlwaysCmdTitle')
                  : step.name === 'delegate_to_ai'
                    ? t('approveAlwaysDelegateTitle')
                    : t('approveAlwaysTitle')
              }
              onClick={() => onDecide('always')}
            >
              {step.name === 'run_command' ? t('approveAlwaysCmd') : t('approveAlways')}
            </button>
          )}
          <button className="danger" onClick={() => onDecide('deny')}>
            <Icon name="x" size={14} /> {t('reject')}
          </button>
        </div>
      )}
    </div>
  );
});
