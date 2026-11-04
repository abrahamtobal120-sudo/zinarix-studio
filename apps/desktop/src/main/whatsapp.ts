import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebContentsView, session, shell } from 'electron';
import type { BrowserWindow, Rectangle, Session } from 'electron';
import type { WhatsAppEvent, WhatsAppStatus } from '../shared/api.js';

const URL_HOME = 'https://web.whatsapp.com/';
const PARTITION = 'persist:zinarix-whatsapp';
const POLL_MS = 1500;
/** Marks the messages Zinarix writes, so they are never read back as orders. */
const MARK = '[Zinarix]';
/** Longest message WhatsApp Web takes comfortably in one go. */
export const WHATSAPP_LIMIT = 3000;

/**
 * WhatsApp Web refuses browsers it does not know: the view presents itself as the Chrome
 * Electron is built on, for the system it runs on.
 */
function chromeAgent(): string {
  const os =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
}

/** Finds a chat of the list by its name ("Ana (Tú)" also matches "Ana"). Page code. */
const FIND_ROW = `
  const norm = (s) => (s || '').replace(/\\s*\\((t[uú]|you)\\)\\s*$/i, '').trim().toLowerCase();
  const findRow = (want) => {
    const w = norm(want);
    if (!w) return null;
    for (const sp of document.querySelectorAll('#pane-side span[title]')) {
      if (norm(sp.getAttribute('title')) !== w) continue;
      return sp.closest('[role="listitem"],[role="row"],[role="gridcell"]') || sp;
    }
    return null;
  };`;

/**
 * Runs in the page (isolated world): whether the account is logged in, how long ago the user
 * touched the page, the rows of the allowed chats in the list, by name (a row's text changes
 * with each new message), the chat open now (id from the messages' data-id, and its name)
 * and its last messages, in order. Emojis are images with their character in "alt": put
 * back as text.
 */
function readJs(titles: string[]): string {
  return `(() => {
  ${FIND_ROW}
  const W = window;
  if (!W.__zx) {
    W.__zx = { last: 0 };
    for (const ev of ['keydown', 'pointerdown', 'wheel'])
      document.addEventListener(ev, (e) => { if (e.isTrusted) W.__zx.last = Date.now(); }, true);
  }
  const idle = W.__zx.last ? Date.now() - W.__zx.last : 1e9;
  const logged = Boolean(document.querySelector('#pane-side'));
  const sigs = {};
  for (const t of ${JSON.stringify(titles)}) {
    const row = findRow(t);
    if (row) sigs[t] = (row.textContent || '').slice(0, 400);
  }
  const main = document.querySelector('#main');
  if (!main) return { logged, idle, sigs, chat: '', title: '', msgs: [] };
  const textOf = (node) => {
    if (!node) return '';
    let s = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) s += n.nodeValue;
      else if (n.nodeName === 'IMG') s += n.getAttribute('alt') || '';
      else if (n.nodeName === 'BR') s += '\\n';
      else s += textOf(n);
    }
    return s;
  };
  let chat = '';
  const seen = new Set();
  const msgs = [];
  for (const el of [...main.querySelectorAll('[data-id]')].slice(-60)) {
    const m = /^(true|false)_([^_]+@[\\w.]+)_([^_]+)/.exec(el.getAttribute('data-id') || '');
    if (!m || seen.has(m[3])) continue;
    seen.add(m[3]);
    chat = m[2];
    const body = el.querySelector('[data-pre-plain-text] span.selectable-text') || el.querySelector('span.selectable-text');
    msgs.push({ id: m[3], mine: m[1] === 'true', text: textOf(body).trim() });
  }
  const title = ((main.querySelector('header span[dir="auto"]') || {}).textContent || '').trim();
  return { logged, idle, sigs, chat, title, msgs };
})()`;
}

/** Clicks the chosen chat in the list; its center, for a real click when that fails. */
function openJs(chosen: string): string {
  return `(() => {
  ${FIND_ROW}
  const row = findRow(${JSON.stringify(chosen)});
  if (!row) return null;
  row.scrollIntoView({ block: 'center' });
  for (const t of ['mousedown', 'mouseup', 'click'])
    row.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
  const r = row.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;
}

/** Puts the cursor in the search box of the chat list, emptied (clear=true: just empties it). */
const SEARCH_JS = `(() => {
  const el = document.querySelector('#side [contenteditable="true"], #side input[type="text"]');
  if (!el) return false;
  el.focus();
  if (el.select) el.select(); else document.execCommand('selectAll');
  document.execCommand('delete');
  return document.activeElement === el;
})()`;

/** Puts the cursor in the message box of the open chat. */
const FOCUS_JS = `(() => {
  const el = document.querySelector('#main footer [contenteditable="true"]');
  if (!el) return false;
  el.focus();
  return document.activeElement === el;
})()`;

/**
 * Writes a message in the open chat and sends it from inside the page, so it works with the
 * window hidden or in the background (real key presses only reach a window in front):
 * the text goes in as typing (Shift+Enter between lines) and the send button is pressed.
 * "sent", "stuck" (written but still in the box) or "empty" (could not write).
 */
function sendJs(text: string): string {
  return `(async () => {
  const el = document.querySelector('#main footer [contenteditable="true"]');
  if (!el) return 'empty';
  el.focus();
  const key = (shiftKey) =>
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey, bubbles: true, cancelable: true });
  ${JSON.stringify(text)}.split('\\n').forEach((line, i) => {
    if (i) {
      const ev = key(true);
      el.dispatchEvent(ev);
      if (!ev.defaultPrevented) document.execCommand('insertLineBreak');
    }
    if (line) document.execCommand('insertText', false, line);
  });
  const left = () => (el.innerText || el.textContent || '').trim();
  if (!left()) return 'empty';
  await new Promise((r) => setTimeout(r, 200));
  const icon = document.querySelector('#main footer [data-icon="send"], #main footer [data-icon*="send"]');
  const btn =
    (icon && icon.closest('button, [role="button"]')) ||
    document.querySelector('#main footer button[aria-label="Enviar"], #main footer button[aria-label="Send"]');
  if (btn) btn.click();
  else el.dispatchEvent(key(false));
  await new Promise((r) => setTimeout(r, 400));
  return left() ? 'stuck' : 'sent';
})()`;
}

/** Empties the message box of the open chat (a message that could not be sent). */
const CLEAR_JS = `(() => {
  const el = document.querySelector('#main footer [contenteditable="true"]');
  if (!el) return false;
  el.focus();
  document.execCommand('selectAll');
  document.execCommand('delete');
  return true;
})()`;

/** What is left in the message box of the open chat. */
const readBoxJs = `(() => {
  const el = document.querySelector('#main footer [contenteditable="true"]');
  return el ? (el.innerText || el.textContent || '').trim() : '';
})()`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

