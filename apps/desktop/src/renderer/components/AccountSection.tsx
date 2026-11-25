import { useEffect, useState, type FormEvent } from 'react';
import type { AccountStatus } from '../../shared/account';
import { lang } from '../i18n';
import { api, refreshLicense, toast } from '../store';
import { Icon } from './Icon';
import './account.css';

/**
 * Settings → Cuenta: register or sign in to the Zinarix account (optional). The keys linked
 * to the account activate by themselves, and the owner's messages are listed here.
 */

const es = {
  title: 'Cuenta de Zinarix',
  lead: 'Opcional. Con una cuenta, las licencias que te asignen se activan solas en esta app y en tus otras computadoras.',
  tabLogin: 'Iniciar sesión',
  tabRegister: 'Crear cuenta',
  email: 'Correo',
  name: 'Nombre',
  password: 'Contraseña',
  passwordHint: 'Mínimo 8 caracteres.',
  password2: 'Repite la contraseña',
  mismatch: 'Las contraseñas no coinciden.',
  login: 'Entrar',
  register: 'Crear cuenta',
  forgot: '¿Olvidaste tu contraseña? Escríbenos y te damos una temporal.',
  welcome: 'Sesión iniciada como {email}',
  created: 'Cuenta creada',
  signedAs: 'Sesión iniciada',
  since: 'Cuenta creada el {date}',
  refresh: 'Actualizar',
  logout: 'Cerrar sesión',
  loggedOut: 'Sesión cerrada',
  licenses: 'Licencias de tu cuenta',
  noLicenses:
    'Tu cuenta todavía no tiene licencias. Cuando actives una clave en esta app, queda ligada a tu cuenta.',
  never: 'no vence',
  until: 'vence el {date}',
  changePass: 'Cambiar contraseña',
  current: 'Contraseña actual',
  newPass: 'Contraseña nueva',
  save: 'Guardar',
  passChanged: 'Contraseña cambiada. Tus otras computadoras tendrán que iniciar sesión de nuevo.',
  messages: 'Mensajes de Zinarix',
  noMessages: 'No hay mensajes.',
  more: 'Ver más',
  loading: 'Cargando…',
};
const en: typeof es = {
  title: 'Zinarix account',
  lead: 'Optional. With an account, the licenses assigned to you activate by themselves in this app and on your other computers.',
  tabLogin: 'Sign in',
  tabRegister: 'Create account',
  email: 'Email',
  name: 'Name',
  password: 'Password',
  passwordHint: 'At least 8 characters.',
  password2: 'Repeat the password',
  mismatch: 'The passwords do not match.',
  login: 'Sign in',
  register: 'Create account',
  forgot: 'Forgot your password? Write to us and we will give you a temporary one.',
  welcome: 'Signed in as {email}',
  created: 'Account created',
  signedAs: 'Signed in',
  since: 'Account created on {date}',
  refresh: 'Refresh',
  logout: 'Sign out',
  loggedOut: 'Signed out',
  licenses: 'Licenses of your account',
  noLicenses:
    'Your account has no licenses yet. When you activate a key in this app, it is linked to your account.',
  never: 'never expires',
  until: 'expires on {date}',
  changePass: 'Change password',
  current: 'Current password',
  newPass: 'New password',
  save: 'Save',
  passChanged: 'Password changed. Your other computers will have to sign in again.',
  messages: 'Messages from Zinarix',
  noMessages: 'No messages.',
  more: 'Learn more',
  loading: 'Loading…',
};
export function ta(key: keyof typeof es, vars: Record<string, string | number> = {}): string {
  return (lang === 'en' ? en : es)[key].replace(/\{(\w+)\}/g, (m, k: string) =>
    k in vars ? String(vars[k]) : m,
  );
}

const PLAN = { pro: 'Pro', ai: 'AI', proai: 'Pro + AI' } as const;
const errText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );
const day = (ms: number) => new Date(ms).toLocaleDateString();

export function AccountSection() {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void api()
      .account.status()
      .then((s) => alive && setStatus(s))
      .catch(() => undefined);
    // The server may have news (a key assigned, a message) since the last hourly check.
    void api()
      .account.sync()
      .then((s) => alive && setStatus(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /** Runs a server call, shows its error under the form and refreshes the plan. */
  const run = async (work: () => Promise<AccountStatus>, done?: string) => {
    setBusy(true);
    setError('');
    try {
      setStatus(await work());
      await refreshLicense();
      if (done) toast(done);
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'register' && password !== password2) {
      setError(ta('mismatch'));
      return;
    }
    const ok = await run(
      () =>
        mode === 'register'
          ? api().account.register({ email, password, name })
          : api().account.login({ email, password }),
      mode === 'register' ? ta('created') : ta('welcome', { email: email.trim().toLowerCase() }),
    );
    if (ok) {
      setPassword('');
      setPassword2('');
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api().account.password(current, next), ta('passChanged'));
    if (ok) {
      setCurrent('');
      setNext('');
    }
  };

  if (!status) return <p className="dim small">{ta('loading')}</p>;

  return (
    <div className="account">
      <h3>{ta('title')}</h3>
      <p className="dim small">{ta('lead')}</p>

      {status.signedIn && status.user ? (
        <>
          <div className="account-card">
            <div className="account-who">
              <strong data-account-email>{status.user.email}</strong>
              {status.user.name && <span>{status.user.name}</span>}
              <span className="dim small">{ta('since', { date: day(status.user.createdAt) })}</span>
            </div>
            <div className="account-actions">
              <button disabled={busy} onClick={() => void run(() => api().account.sync())}>
                <Icon name="sync" size={13} /> {ta('refresh')}
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  // Whoever signs out here already has an account: offer sign-in, not sign-up.
                  setMode('login');
                  void run(() => api().account.logout(), ta('loggedOut'));
                }}
              >
                {ta('logout')}
              </button>
            </div>
          </div>

          <h4>{ta('licenses')}</h4>
          {status.licenses.length === 0 ? (
            <p className="dim small">{ta('noLicenses')}</p>
          ) : (
            <ul className="account-list">
              {status.licenses.map((l) => (
                <li key={l.id}>
                  <Icon name="key" size={14} /> <strong>{PLAN[l.plan]}</strong>
                  {l.name && <span>{l.name}</span>}
                  <span className="dim small">
                    {l.expiresAt ? ta('until', { date: day(l.expiresAt) }) : ta('never')}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <details className="account-pass">
            <summary>{ta('changePass')}</summary>
            <form onSubmit={(e) => void changePassword(e)}>
              <label>
                {ta('current')}
                <input
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  required
                />
              </label>
              <label>
                {ta('newPass')}
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  required
                />
              </label>
              <button className="primary" disabled={busy}>
                {ta('save')}
              </button>
            </form>
          </details>
        </>
      ) : (
        <div className="account-card account-form">
          <div className="account-tabs" role="tablist">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={mode === m ? 'on' : ''}
                onClick={() => {
                  setMode(m);
                  setError('');
                }}
              >
                {m === 'login' ? ta('tabLogin') : ta('tabRegister')}
              </button>
            ))}
          </div>
          <form onSubmit={(e) => void submit(e)}>
            <label>
              {ta('email')}
              <input
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            {mode === 'register' && (
              <label>
                {ta('name')}
                <input
                  name="name"
                  autoComplete="name"
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            <label>
              {ta('password')}
              <input
                type="password"
                name="password"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                minLength={mode === 'register' ? 8 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {mode === 'register' && <span className="dim small">{ta('passwordHint')}</span>}
            </label>
            {mode === 'register' && (
              <label>
                {ta('password2')}
                <input
                  type="password"
                  name="password2"
                  autoComplete="new-password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  required
                />
              </label>
            )}
            <button className="primary" disabled={busy}>
              {mode === 'register' ? ta('register') : ta('login')}
            </button>
            {mode === 'login' && <p className="dim small">{ta('forgot')}</p>}
          </form>
        </div>
      )}
      {error && (
        <p className="small account-error" role="alert">
          {error}
        </p>
      )}

      <h4>{ta('messages')}</h4>
      {status.messages.length === 0 ? (
        <p className="dim small">{ta('noMessages')}</p>
      ) : (
        <ul className="account-list account-messages">
          {status.messages.map((m) => (
            <li key={m.id}>
              <span className="account-msg-text">{m.text}</span>
              <span className="dim small">{day(m.at)}</span>
              {m.url && (
                <button className="link" onClick={() => void api().app.openExternal(m.url!)}>
                  {ta('more')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
