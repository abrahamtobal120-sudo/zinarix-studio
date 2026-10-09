import { useState } from 'react';
import { t } from '../i18n';
import { setState, useStore } from '../store';
import { askAgent } from './Chat';

interface Check {
  icon: string;
  title: string;
  desc: string;
  prompt: string;
  needsProject?: boolean;
  input?: { placeholder: string; build: (v: string) => string };
}

const CHECKS: Check[] = [
  {
    icon: '🔑',
    title: 'Secretos y código inseguro',
    desc: 'Busca llaves, tokens y contraseñas filtradas, archivos .env subidos a git y patrones peligrosos (inyección SQL, eval, TLS desactivado…).',
    prompt:
      'Haz una auditoría de seguridad de este proyecto con security_scan_project. Explícame los hallazgos ordenados por gravedad, con palabras sencillas, y ofréceme corregir los más graves.',
    needsProject: true,
  },
  {
    icon: '📦',
    title: 'Dependencias vulnerables',
    desc: 'Compara tus librerías con la base pública de vulnerabilidades (osv.dev) y te dice a qué versión actualizar.',
    prompt:
      'Revisa las dependencias de este proyecto con audit_dependencies. Dime cuáles tienen vulnerabilidades, qué tan graves son y a qué versión actualizar; ofrécete a actualizarlas.',
    needsProject: true,
  },
  {
    icon: '💻',
    title: 'Mi equipo',
    desc: 'Puertos abiertos a la red, firewall, actualizaciones pendientes, SSH, cifrado de disco y permisos.',
    prompt:
      'Revisa la seguridad de mi computadora con security_check_system. Explícame cada problema en palabras sencillas y dime cómo corregirlo (ofrécete a hacerlo con mi permiso).',
  },
  {
    icon: '📡',
    title: 'Mi red local',
    desc: 'Descubre qué dispositivos de tu red tienen servicios expuestos (cámaras, impresoras, bases de datos…). Solo tu red.',
    prompt:
      'Averigua mi red local con network_status y luego escanea mi red privada (/24) con port_scan para ver qué dispositivos tienen puertos abiertos. Dime cuáles son riesgosos y cómo protegerlos.',
  },
  {
    icon: '🌐',
    title: 'Mi sitio web',
    desc: 'Certificado HTTPS, versión de TLS, encabezados de seguridad, cookies y archivos expuestos como .env o .git.',
    prompt: '',
    input: {
      placeholder: 'https://misitio.com',
      build: (v) =>
        `Revisa la seguridad de mi sitio ${v} con check_site_security. Ordena los hallazgos por gravedad y dime exactamente qué configurar en el servidor para corregirlos.`,
    },
  },
  {
    icon: '🧾',
    title: 'Verificar un archivo',
    desc: 'Calcula el SHA-256 de un archivo descargado y lo compara con el publicado para saber si fue alterado.',
    prompt: '',
    input: {
      placeholder: '~/Descargas/archivo.iso',
      build: (v) =>
        `Calcula el hash del archivo ${v} con file_hash y dime cómo comprobar que coincide con el oficial.`,
    },
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
        <button className="modal-x" onClick={close} aria-label="Cerrar">
          ×
        </button>
        <h2>🛡️ {t('securityTitle')}</h2>
        <p className="dim">{t('securityIntro')}</p>
        <div className="sec-grid">
          {CHECKS.map((c) => {
            const blocked = c.needsProject && !workspace;
            const v = values[c.title] ?? '';
            return (
              <div key={c.title} className={`sec-card ${blocked ? 'disabled' : ''}`}>
                <div className="sec-head">
                  <span className="sec-icon">{c.icon}</span>
                  <strong>{c.title}</strong>
                </div>
                <p>{c.desc}</p>
                {c.input ? (
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
                      onChange={(e) => setValues({ ...values, [c.title]: e.target.value })}
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
