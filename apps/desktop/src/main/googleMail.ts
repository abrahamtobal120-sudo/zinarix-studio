import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

/**
 * "Sign in with Google" for Gmail: OAuth for installed apps (loopback redirect + PKCE), then
 * IMAP/SMTP with XOAUTH2. No 2-step verification or app password needed on the account.
 *
 * The OAuth client is the user's own (Google Cloud → Credentials → "Desktop app"); it works
 * without Google's app verification: Google only shows an "unverified app" notice once.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://mail.google.com/ openid email profile';
const LOGIN_TIMEOUT = 5 * 60_000;

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

/** Where the OAuth client comes from: saved in the app, or OMNI_GOOGLE_CLIENT_ID/_SECRET. */
export class GoogleAuth {
  private readonly file: string;
  /** Access tokens by refresh token (they last about an hour). */
  private readonly cache = new Map<string, { token: string; until: number }>();

  constructor(dir: string) {
    this.file = join(dir, 'google-oauth.json');
  }

  client(): GoogleClient | null {
    if (existsSync(this.file)) {
      try {
        const c = JSON.parse(readFileSync(this.file, 'utf8')) as GoogleClient;
        if (c.clientId) return { clientId: c.clientId, clientSecret: c.clientSecret ?? '' };
      } catch {
        /* unreadable: fall back to the environment */
      }
    }
    const id = process.env.OMNI_GOOGLE_CLIENT_ID;
    return id ? { clientId: id, clientSecret: process.env.OMNI_GOOGLE_CLIENT_SECRET ?? '' } : null;
  }

  setClient(c: GoogleClient): void {
    writeFileSync(this.file, JSON.stringify(c, null, 2), { mode: 0o600 });
  }

  private need(): GoogleClient {
    const c = this.client();
    if (!c) throw new Error('Falta configurar el cliente OAuth de Google (Client ID).');
    return c;
  }

  private async token(params: Record<string, string>): Promise<Record<string, unknown>> {
    const c = this.need();
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.clientId,
        ...(c.clientSecret ? { client_secret: c.clientSecret } : {}),
        ...params,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) {
      if (j.error === 'invalid_grant')
        throw new Error('La sesión de Google caducó o se revocó: vuelve a iniciar sesión con Google.');
      throw new Error(`Google: ${String(j.error_description ?? j.error ?? r.status)}`);
    }
    return j;
  }

  /**
   * Opens Google's sign-in in the browser and waits for the answer on a local port.
   * Returns the account's address, name and refresh token.
   */
  async login(
    openUrl: (url: string) => void,
  ): Promise<{ email: string; name: string; refresh: string }> {
    const c = this.need();
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(16).toString('hex');

    let redirect = '';
    const code = await new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        const u = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (u.pathname !== '/') {
          res.writeHead(404).end();
          return;
        }
        const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Zinarix Studio</title>` +
            `<body style="font-family:system-ui;text-align:center;padding:4em">` +
            (ok
              ? '<h2>Listo ✔</h2><p>Ya puedes cerrar esta pestaña y volver a Zinarix Studio.</p>'
              : '<h2>No se pudo iniciar sesión</h2><p>Vuelve a intentarlo desde Zinarix Studio.</p>'),
        );
        done();
        if (ok) resolve(ok);
        else reject(new Error(`Google: ${u.searchParams.get('error') ?? 'inicio de sesión cancelado'}`));
      });
      const timer = setTimeout(() => {
        done();
        reject(new Error('Se agotó el tiempo para iniciar sesión con Google.'));
      }, LOGIN_TIMEOUT);
      const done = () => {
        clearTimeout(timer);
        server.close();
      };
      server.on('error', (e) => {
        done();
        reject(e);
      });
      server.listen(0, '127.0.0.1', () => {
        redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const q = new URLSearchParams({
          client_id: c.clientId,
          redirect_uri: redirect,
          response_type: 'code',
          scope: SCOPE,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          access_type: 'offline',
          // Always ask, so Google hands a refresh token every time.
          prompt: 'consent select_account',
          state,
        });
        openUrl(`${AUTH_URL}?${q}`);
      });
    });

    const j = await this.token({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirect,
    });
    const refresh = typeof j.refresh_token === 'string' ? j.refresh_token : '';
    if (!refresh) throw new Error('Google no devolvió un token de acceso sin conexión.');
    // The id_token comes straight from Google over TLS: its claims can be read as they are.
    const claims = JSON.parse(
      Buffer.from(String(j.id_token ?? '').split('.')[1] ?? '', 'base64url').toString() || '{}',
    ) as { email?: string; name?: string };
    if (!claims.email) throw new Error('Google no devolvió el correo de la cuenta.');
    if (typeof j.access_token === 'string')
      this.cache.set(refresh, {
        token: j.access_token,
        until: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60_000,
      });
    return { email: claims.email, name: claims.name ?? '', refresh };
  }

  /** A valid access token for this refresh token (renewed when it is about to expire). */
  async accessToken(refresh: string): Promise<string> {
    const hit = this.cache.get(refresh);
    if (hit && hit.until > Date.now()) return hit.token;
    const j = await this.token({ grant_type: 'refresh_token', refresh_token: refresh });
    const token = String(j.access_token ?? '');
    if (!token) throw new Error('Google no devolvió un token de acceso.');
    this.cache.set(refresh, {
      token,
      until: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60_000,
    });
    return token;
  }
}
