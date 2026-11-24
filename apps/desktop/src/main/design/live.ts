import { EditError } from './htmlSource.js';

/**
 * Live preview of framework projects (Vite, Next, Astro…): the panel's frame loads
 * zxp://w<n>/… and every request is passed on to the project's dev server on this computer,
 * with the editing script added to its pages. Only addresses of this computer are allowed.
 */

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$/i;

/**
 * "localhost:5173", "http://127.0.0.1:3000/app" → "http://localhost:5173" (origin only).
 * Throws a plain-words EditError for anything that is not a server of this computer.
 */
export function localOrigin(input: string): string {
  const s = input.trim();
  if (!s)
    throw new EditError(
      'Escribe la dirección donde funciona tu proyecto, por ejemplo http://localhost:5173',
    );
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`);
  } catch {
    throw new EditError(`«${s}» no es una dirección válida. Usa algo como http://localhost:5173`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new EditError(
      'La dirección debe empezar con http:// (por ejemplo http://localhost:5173).',
    );
  if (!LOCAL_HOST.test(url.hostname))
    throw new EditError(
      'El Panel de Edición solo muestra proyectos que funcionan en esta computadora (localhost). Para ver un sitio publicado usa el Navegador.',
    );
  // 0.0.0.0 is "every network card" for a server; to connect, it is this computer.
  if (url.hostname === '0.0.0.0') url.hostname = 'localhost';
  return url.origin;
}

export interface ProbeResult {
  ok: boolean;
  /** Plain words about what went wrong, when not ok. */
  problem?: string;
}

/** Asks the dev server for its home page: is something there, and is it a web page? */
export async function probe(origin: string, timeoutMs = 4000): Promise<ProbeResult> {
  try {
    const r = await fetch(`${origin}/`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'text/html' },
    });
    await r.body?.cancel().catch(() => undefined);
    if (r.status >= 500)
      return {
        ok: false,
        problem: `El proyecto en ${origin} respondió con un error (${r.status}). Mira la terminal: seguramente hay un error en el código; puedes pedirle a la IA que lo arregle.`,
      };
    const type = r.headers.get('content-type') ?? '';
    if (!/html/i.test(type))
      return {
        ok: false,
        problem: `En ${origin} hay un programa funcionando, pero no es una página web (responde ${type || 'sin tipo'}). Revisa la dirección: quizá es la de tu API y no la de tu sitio.`,
      };
    return { ok: true };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    const code = err.cause?.code ?? err.name;
    if (code === 'TimeoutError' || code === 'AbortError')
      return {
        ok: false,
        problem: `${origin} no respondió a tiempo. Si el proyecto está arrancando, espera unos segundos y vuelve a intentarlo.`,
      };
    return {
      ok: false,
      problem: `No hay nada funcionando en ${origin}. Primero inicia el proyecto (botón «Iniciar proyecto»); cuando en la terminal aparezca la dirección, conéctate.`,
    };
  }
}

/** Ports dev servers usually take, the project's own first. */
const PORTS = [5173, 5174, 5175, 3000, 3001, 4321, 4200, 8080, 8000, 5000, 4173, 1234];

/** First address of this computer with a web page answering (the expected one first). */
export async function findServer(prefer: string | null): Promise<string | null> {
  const list = [
    ...new Set([...(prefer ? [prefer] : []), ...PORTS.map((p) => `http://localhost:${p}`)]),
  ];
  const results = await Promise.all(list.map((o) => probe(o, 1500).then((r) => r.ok)));
  const i = results.indexOf(true);
  return i >= 0 ? list[i]! : null;
}

/** Response headers that would stop the page from showing inside the panel, or lie after we change it. */
const DROP = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'set-cookie',
  'access-control-allow-origin',
  'access-control-allow-credentials',
]);

/** Request headers worth passing on to the dev server. */
const PASS = [
  'accept',
  'accept-language',
  'content-type',
  'range',
  'x-requested-with',
  'rsc',
  'next-router-state-tree',
  'next-router-prefetch',
  'next-url',
];

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': '*',
};

/** Adds the editing script to a page (before </body>, or at the end). */
export function inject(html: string, tag: string): string {
  const body = html.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
  return body >= 0 ? html.slice(0, body) + tag + html.slice(body) : html + tag;
}

/** One request of the frame, passed on to the dev server at `origin`. */
export async function proxy(origin: string, req: Request, tag: string): Promise<Response> {
  const from = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const headers = new Headers();
  for (const k of PASS) {
    const v = req.headers.get(k);
    if (v) headers.set(k, v);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let r: Response;
  try {
    r = await fetch(origin + from.pathname + from.search, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return page(
      502,
      'El proyecto dejó de responder',
      `No hay respuesta de ${origin}. Puede que el proyecto se haya detenido: revisa la terminal, inícialo otra vez y pulsa «Recargar».`,
    );
  }
  const out = new Headers(CORS);
  r.headers.forEach((v, k) => {
    if (!DROP.has(k.toLowerCase())) out.set(k, v);
  });
  out.set('cache-control', 'no-store');
  if ([101, 204, 205, 304].includes(r.status))
    return new Response(null, { status: r.status, headers: out });
  const type = r.headers.get('content-type') ?? '';
  if (/text\/html/i.test(type) && req.method === 'GET') {
    const html = await r.text();
    return new Response(inject(html, tag), { status: r.status, headers: out });
  }
  return new Response(r.body, { status: r.status, headers: out });
}

/** A short page in plain words, shown inside the frame. */
export function page(status: number, title: string, text: string): Response {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(
    `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui,sans-serif;padding:40px;color:#444;max-width:640px"><h2>${esc(title)}</h2><p style="line-height:1.5">${esc(text)}</p></body>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...CORS },
    },
  );
}
