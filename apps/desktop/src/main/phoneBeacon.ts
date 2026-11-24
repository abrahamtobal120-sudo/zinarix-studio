import { execFile } from 'node:child_process';
import { bin } from './bin.js';

/**
 * The permanent link of the phone remote (without a domain of one's own).
 *
 * The free Cloudflare tunnel gets a new random address each time it opens. So that the link
 * on the phone never changes, Zinarix writes the current address in a secret gist of the
 * user's GitHub account (through `gh`), and the link points to a small page of the Zinarix
 * website that reads that gist and goes on to the current address. The gist only holds the
 * address: the key of the link travels after the #, and pairing still needs the PIN and the
 * OK on the computer.
 */
export const RELAY_PAGE = 'https://zinarix-studio.vercel.app/p';
export const BEACON_FILE = 'zinarix-remote.json';

/** The Android app of the remote (link shown on the phone page). */
export { REMOTE_APP_APK as APP_APK } from '../shared/api.js';

/** Publishes the address (null: the remote is off); returns the gist id (new or the same). */
export type PhoneBeacon = (url: string | null, id?: string) => Promise<string>;

function gh(args: string[], input?: string): Promise<string> {
  return new Promise((ok, fail) => {
    const child = execFile(
      bin('gh'),
      args,
      { timeout: 30_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) return ok(stdout);
        const msg = `${stderr || ''} ${err.message}`;
        fail(
          new Error(
            /ENOENT|not recognized|no se reconoce/i.test(msg)
              ? 'gh-missing'
              : /auth login|not logged|authentication|HTTP 401/i.test(msg)
                ? 'gh-login'
                : /HTTP 404/.test(msg)
                  ? 'gh-404'
                  : /scope|HTTP 403/i.test(msg)
                    ? 'gh-scope'
                    : msg.trim().slice(0, 300),
          ),
        );
      },
    );
    child.stdin?.end(input ?? '');
  });
}

export const githubBeacon: PhoneBeacon = async (url, id) => {
  const content = JSON.stringify({ url, at: Date.now() });
  const files = { [BEACON_FILE]: { content } };
  if (id && /^[0-9a-f]{20,40}$/.test(id)) {
    try {
      await gh(
        ['api', '--method', 'PATCH', `gists/${id}`, '--input', '-'],
        JSON.stringify({ files }),
      );
      return id;
    } catch (e) {
      // Deleted by hand: a new one is made (the link changes only this once).
      if (!(e instanceof Error) || e.message !== 'gh-404') throw e;
    }
  }
  if (url === null) return id ?? '';
  const out = await gh(
    ['api', '--method', 'POST', 'gists', '--input', '-'],
    JSON.stringify({
      public: false,
      description: 'Zinarix Studio · dirección actual del control remoto (no la borres)',
      files,
    }),
  );
  const made = (JSON.parse(out) as { id?: unknown }).id;
  if (typeof made !== 'string' || !/^[0-9a-f]{20,40}$/.test(made))
    throw new Error('GitHub no devolvió el gist.');
  return made;
};

/** The permanent link: the relay page with the gist and the key after the #. */
export function relayLink(gist: string, key: string): string {
  return `${RELAY_PAGE}#g=${gist}&k=${key}`;
}

/** Words for the user when the permanent link could not be made. */
export function beaconError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (m === 'gh-missing')
    return 'Para un enlace que nunca cambie, instala GitHub CLI (gh) e inicia sesión, o usa un dominio propio abajo.';
  if (m === 'gh-login')
    return 'Para un enlace que nunca cambie, inicia sesión en GitHub (panel Git → GitHub, o "gh auth login").';
  if (m === 'gh-scope')
    return 'Tu sesión de GitHub no puede crear gists: ejecuta "gh auth refresh -s gist".';
  return `No se pudo crear el enlace permanente: ${m}`;
}
