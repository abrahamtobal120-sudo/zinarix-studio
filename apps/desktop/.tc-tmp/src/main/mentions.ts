/**
 * Fase 8 — the content of the chat mentions that live in main: @git (the working diff, the
 * staged diff or one commit) and @web (one page as readable text). @terminal, @problems and
 * @docs are filled in by the renderer, which already has them.
 */
import { redact } from '@omni/security';
import type { Git } from './git.js';
import { htmlToText } from './knowledgeText.js';
import { assertNotMetadata, readCapped } from './system.js';

const WEB_MAX_BYTES = 2 * 1024 * 1024;
const WEB_MAX_CHARS = 40_000;
const WEB_TIMEOUT = 15_000;

/** "@git" = all uncommitted changes; "@git:staged"; "@git:<hash>" / "@git:HEAD~n" = a commit. */
export async function gitMention(git: Git, arg?: string): Promise<string> {
  if (!arg) {
    const [unstaged, staged] = await Promise.all([git.patch(false), git.patch(true)]);
    const parts = [];
    if (staged.trim()) parts.push(`# Staged\n${staged}`);
    if (unstaged.trim()) parts.push(`# Not staged\n${unstaged}`);
    return redact(parts.join('\n\n') || '(no uncommitted changes)');
  }
  if (arg.toLowerCase() === 'staged') return redact((await git.patch(true)) || '(nothing staged)');
  return redact(await git.showRef(arg));
}

/** "@web:https://…": the page as text (redirects followed up to 4 hops, never to cloud metadata). */
export async function webMention(url: string, signal: AbortSignal): Promise<string> {
  let current = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:')
      throw new Error('Solo http(s).');
    await assertNotMetadata(current.hostname);
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.any([signal, AbortSignal.timeout(WEB_TIMEOUT)]),
      headers: {
        'user-agent': 'ZinarixStudio/1.0 (+@web mention)',
        accept: 'text/html,text/plain,text/markdown,application/json',
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`HTTP ${res.status} sin destino`);
      current = new URL(loc, current);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!/html|text\/|json|xml/i.test(type)) throw new Error(`Tipo no admitido: ${type || '?'}`);
    const body = await readCapped(res, WEB_MAX_BYTES);
    let text: string;
    if (/html/i.test(type)) {
      const page = htmlToText(body);
      text = `${page.title ? `# ${page.title}\n` : ''}${current.toString()}\n\n${page.text}`;
    } else text = `${current.toString()}\n\n${body}`;
    text = text.length > WEB_MAX_CHARS ? `${text.slice(0, WEB_MAX_CHARS)}\n…` : text;
    return redact(text);
  }
  throw new Error('Demasiadas redirecciones');
}
