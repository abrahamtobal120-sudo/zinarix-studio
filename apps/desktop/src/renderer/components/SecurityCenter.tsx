import { useState } from 'react';
import { t } from '../i18n';
import { setState, useStore } from '../store';
import { askAgent } from './Chat';

interface Check {
  id: string;
  icon: string;
  title: string;
  desc: string;
  prompt: string;
  needsProject?: boolean;
  opensScanner?: boolean;
  input?: { placeholder: string; build: (v: string) => string };
}

const checks = (): Check[] => [
  {
    id: 'secrets',
    icon: '🔑',
    title: t('chkSecretsTitle'),
    desc: t('chkSecretsDesc'),
    prompt: t('chkSecretsPrompt'),
    needsProject: true,
  },
  {
    id: 'deps',
    icon: '📦',
    title: t('chkDepsTitle'),
    desc: t('chkDepsDesc'),
    prompt: t('chkDepsPrompt'),
    needsProject: true,
  },
  {
    id: 'system',
    icon: '💻',
    title: t('chkSystemTitle'),
    desc: t('chkSystemDesc'),
    prompt: t('chkSystemPrompt'),
  },
  {
    id: 'ports',
    icon: '📡',
    title: t('chkPortsTitle'),
    desc: t('chkPortsDesc'),
    prompt: '',
    opensScanner: true,
  },
  {
    id: 'site',
    icon: '🌐',
    title: t('chkSiteTitle'),
    desc: t('chkSiteDesc'),
    prompt: '',
    input: { placeholder: t('phSite'), build: (v) => t('chkSitePrompt', { url: v }) },
  },
  {
    id: 'hash',
    icon: '🧾',
    title: t('chkHashTitle'),
    desc: t('chkHashDesc'),
    prompt: '',
    input: { placeholder: t('phHashFile'), build: (v) => t('chkHashPrompt', { path: v }) },
  },
];

export function SecurityCenter() {
  const workspace = useStore((s) => s.workspace);
  const [values, setValues] = useState<Record<string, string>>({});
  const close = () => setState({ modal: null });
  const run = (prompt: string) => {
    close();
    askAgent(prompt);
  };
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="security" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={close} aria-label={t('close')}>
          ×
        </button>
        <h2>🛡️ {t('securityTitle')}</h2>
        <p className="dim">{t('securityIntro')}</p>
        <div className="sec-grid">
          {checks().map((c) => {
            const blocked = c.needsProject && !workspace;
            const v = values[c.id] ?? '';
            return (
              <div key={c.id} className={`sec-card ${blocked ? 'disabled' : ''}`}>
                <div className="sec-head">
                  <span className="sec-icon">{c.icon}</span>
                  <strong>{c.title}</strong>
                </div>
                <p>{c.desc}</p>
                {c.opensScanner ? (
                  <button
                    className="primary"
                    onClick={() => setState({ modal: { kind: 'scanner' } })}
                  >
                    {t('securityRun')}
                  </button>
                ) : c.input ? (
                  <form
                    className="sec-input"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (v.trim()) run(c.input!.build(v.trim()));
                    }}
                  >
                    <input
                      value={v}
                      placeholder={c.input.placeholder}
                      spellCheck={false}
                      onChange={(e) => setValues({ ...values, [c.id]: e.target.value })}
                    />
                    <button className="primary" disabled={!v.trim()}>
                      {t('securityRun')}
                    </button>
                  </form>
                ) : (
                  <button className="primary" disabled={blocked} onClick={() => run(c.prompt)}>
                    {blocked ? t('securityNeedsFolder') : t('securityRun')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="sec-legal">⚖️ {t('securityLegal')}</p>
      </div>
    </div>
  );
}
