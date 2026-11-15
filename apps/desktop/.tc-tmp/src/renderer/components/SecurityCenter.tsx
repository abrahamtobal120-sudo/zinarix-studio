import { useState } from 'react';
import { t } from '../i18n';
import { setState, useStore } from '../store';
import { askAgent } from './Chat';
import { Icon, type IconName } from './Icon';
import { ModalShell } from './ModalShell';

interface Check {
  id: string;
  icon: IconName;
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
    icon: 'key',
    title: t('chkSecretsTitle'),
    desc: t('chkSecretsDesc'),
    prompt: t('chkSecretsPrompt'),
    needsProject: true,
  },
  {
    id: 'deps',
    icon: 'package',
    title: t('chkDepsTitle'),
    desc: t('chkDepsDesc'),
    prompt: t('chkDepsPrompt'),
    needsProject: true,
  },
  {
    id: 'system',
    icon: 'monitor',
    title: t('chkSystemTitle'),
    desc: t('chkSystemDesc'),
    prompt: t('chkSystemPrompt'),
  },
  {
    id: 'ports',
    icon: 'wifi',
    title: t('chkPortsTitle'),
    desc: t('chkPortsDesc'),
    prompt: '',
    opensScanner: true,
  },
  {
    id: 'site',
    icon: 'globe',
    title: t('chkSiteTitle'),
    desc: t('chkSiteDesc'),
    prompt: '',
    input: { placeholder: t('phSite'), build: (v) => t('chkSitePrompt', { url: v }) },
  },
  {
    id: 'hash',
    icon: 'hash',
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
    <ModalShell onClose={close} className="security" labelledBy="security-title">
      <button className="modal-x" onClick={close} aria-label={t('close')} title={t('close')}>
        <Icon name="close" size={16} />
      </button>
      <h2 id="security-title">
        <Icon name="shield" size={16} /> {t('securityTitle')}
      </h2>
      <p className="dim">{t('securityIntro')}</p>
      <div className="sec-grid">
        {checks().map((c) => {
          const blocked = c.needsProject && !workspace;
          const v = values[c.id] ?? '';
          return (
            <div key={c.id} className={`sec-card ${blocked ? 'disabled' : ''}`}>
              <div className="sec-head">
                <span className="sec-icon">
                  <Icon name={c.icon} size={16} />
                </span>
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
                    aria-label={`${c.title}: ${c.input.placeholder}`}
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
      <p className="sec-legal">{t('securityLegal')}</p>
    </ModalShell>
  );
}
