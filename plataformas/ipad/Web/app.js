/* Zinarix Studio on the iPad, on its own: chats with the AI providers the user connects
   (their keys stay in the Keychain of the iPad), a project folder (the app's folder in
   Files) and an agent that reads and edits those files with the user's approval.

   The page runs inside the app (LocalViewController.swift), which gives it `zx`: the
   keys, a small store, the files and the network. Opened in a normal browser (to try it
   on a computer) it falls back to the browser's storage and fetch. */
'use strict';
(() => {
  // ───────────────────────────── Texts ─────────────────────────────

  const EN = (navigator.language || 'es').toLowerCase().startsWith('en');
  const TEXTS = {
    newChat: ['＋ Nuevo chat', '＋ New chat'],
    files: ['📁 Archivos', '📁 Files'],
    settings: ['⚙️ Modelos y llaves', '⚙️ Models and keys'],
    send: ['Enviar', 'Send'],
    stop: ['Detener', 'Stop'],
    agent: ['Agente', 'Agent'],
    placeholder: ['Escribe un mensaje…', 'Write a message…'],
    untitled: ['Chat nuevo', 'New chat'],
    pickModel: ['Elegir modelo', 'Choose model'],
    emptyTitle: ['Zinarix Studio', 'Zinarix Studio'],
    emptyText: [
      'Este iPad trabaja solo: no necesita tu computadora. Escribe abajo para empezar.',
      'This iPad works on its own: it does not need your computer. Write below to start.',
    ],
    emptyNoKey: [
      'Para empezar conecta una IA: toca «Modelos y llaves» y pega tu llave de API.',
      'To start, connect an AI: tap “Models and keys” and paste your API key.',
    ],
    settingsTitle: ['Modelos y llaves', 'Models and keys'],
    settingsHint: [
      'Pega la llave de API de los proveedores que uses. Se guarda en el llavero de este iPad y solo se manda a ese proveedor.',
      'Paste the API key of the providers you use. It is kept in the keychain of this iPad and only sent to that provider.',
    ],
    settingsFoot: [
      'Los chats y los archivos se quedan en este iPad. Los archivos están en la app Archivos → En mi iPad → Zinarix Studio.',
      'Chats and files stay on this iPad. The files are in the Files app → On My iPad → Zinarix Studio.',
    ],
    key: ['Llave de API', 'API key'],
    keyOptional: ['Llave de API (si tu servidor la pide)', 'API key (if your server asks for one)'],
    baseUrl: [
      'Dirección, p. ej. http://192.168.1.20:11434/v1',
      'Address, e.g. http://192.168.1.20:11434/v1',
    ],
    save: ['Guardar', 'Save'],
    remove: ['Quitar', 'Remove'],
    connected: ['Conectado', 'Connected'],
    notConnected: ['Sin conectar', 'Not connected'],
    checking: ['Probando…', 'Checking…'],
    modelsFound: ['modelos', 'models'],
    modelsTitle: ['Modelo', 'Model'],
    search: ['Buscar o escribir un modelo…', 'Search or type a model…'],
    refresh: ['Actualizar', 'Refresh'],
    useTyped: ['Usar', 'Use'],
    noProviders: [
      'Todavía no hay ninguna IA conectada. Ve a «Modelos y llaves».',
      'No AI is connected yet. Go to “Models and keys”.',
    ],
    needModel: ['Primero elige un modelo.', 'Choose a model first.'],
    cancel: ['Cancelar', 'Cancel'],
    ok: ['Aceptar', 'OK'],
    delete: ['Borrar', 'Delete'],
    deleteChat: ['¿Borrar este chat?', 'Delete this chat?'],
    deleteFile: ['¿Borrar?', 'Delete?'],
    newFile: ['Nombre del archivo', 'File name'],
    newFolder: ['Nombre de la carpeta', 'Folder name'],
    emptyFolder: ['Carpeta vacía', 'Empty folder'],
    root: ['Proyecto', 'Project'],
    saved: ['Guardado', 'Saved'],
    copy: ['Copiar', 'Copy'],
    copied: ['Copiado', 'Copied'],
    allow: ['Permitir', 'Allow'],
    allowAlways: ['Permitir siempre en este chat', 'Always allow in this chat'],
    deny: ['Rechazar', 'Deny'],
    wantsWrite: ['La IA quiere escribir el archivo', 'The AI wants to write the file'],
    wantsEdit: ['La IA quiere cambiar el archivo', 'The AI wants to change the file'],
    wantsDelete: ['La IA quiere borrar', 'The AI wants to delete'],
    denied: ['El usuario rechazó esta acción.', 'The user denied this action.'],
    stopped: ['Detenido.', 'Stopped.'],
    tooManySteps: [
      'La IA hizo demasiados pasos seguidos; se detuvo.',
      'The AI took too many steps in a row; it was stopped.',
    ],
    error: ['Error', 'Error'],
  };
  const t = (k) => (TEXTS[k] ? TEXTS[k][EN ? 1 : 0] : k);
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // ───────────────────────────── Bridge ─────────────────────────────

  const native = !!(
    window.webkit &&
    window.webkit.messageHandlers &&
    window.webkit.messageHandlers.zx
  );
  const call = (op, args) =>
    window.webkit.messageHandlers.zx.postMessage(Object.assign({ op }, args || {}));
  const streams = new Map();
  let streamSeq = 0;
  window.__zxEvent = (sid, kind, data) => {
    const s = streams.get(sid);
    if (s) s(kind, data);
  };
  const fromB64 = (s) => {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  /** Browser fallback (no app around it): everything in localStorage. */
  const ls = {
    get: (k) => localStorage.getItem('zx:' + k),
    set: (k, v) => localStorage.setItem('zx:' + k, v),
    del: (k) => localStorage.removeItem('zx:' + k),
    json: (k, d) => {
      try {
        return JSON.parse(localStorage.getItem('zx:' + k)) || d;
      } catch {
        return d;
      }
    },
  };
  const memFiles = () => ls.json('fs', {});
  const memDirs = () => ls.json('dirs', []);

  const zx = native
    ? {
        keys: {
          list: () => call('keys.list'),
          set: (id, key, host) => call('keys.set', { id, key, host }),
          del: (id) => call('keys.del', { id }),
        },
        store: {
          get: (name) => call('store.get', { name }),
          set: (name, value) => call('store.set', { name, value }),
          del: (name) => call('store.del', { name }),
        },
        fs: {
          list: (path) => call('fs.list', { path }),
          read: (path) => call('fs.read', { path }),
          write: (path, text) => call('fs.write', { path, text }),
          mkdir: (path) => call('fs.mkdir', { path }),
          remove: (path) => call('fs.remove', { path }),
        },
        ui: (action, value) => call('ui', { action, value: value || '' }).catch(() => {}),
        http(req, onText) {
          const sid = 's' + ++streamSeq;
          let status = 0;
          const done = new Promise((resolve, reject) => {
            const dec = new TextDecoder();
            streams.set(sid, (kind, data) => {
              if (kind === 'head') status = data;
              else if (kind === 'chunk') onText(dec.decode(fromB64(data), { stream: true }));
              else {
                streams.delete(sid);
                if (kind === 'end') resolve(status);
                else reject(new Error(String(data || 'network')));
              }
            });
            call('http', Object.assign({ sid }, req)).catch((e) => {
              streams.delete(sid);
              reject(e instanceof Error ? e : new Error(String(e)));
            });
          });
          return { done, abort: () => call('http.abort', { sid }).catch(() => {}) };
        },
      }
    : {
        keys: {
          list: async () => {
            const out = {};
            const all = ls.json('keys', {});
            for (const id in all) out[id] = all[id].h;
            return out;
          },
          set: async (id, key, host) => {
            const all = ls.json('keys', {});
            all[id] = { k: key, h: host };
            ls.set('keys', JSON.stringify(all));
          },
          del: async (id) => {
            const all = ls.json('keys', {});
            delete all[id];
            ls.set('keys', JSON.stringify(all));
          },
        },
        store: {
          get: async (name) => ls.get('s:' + name),
          set: async (name, value) => ls.set('s:' + name, value),
          del: async (name) => ls.del('s:' + name),
        },
        fs: {
          list: async (path) => {
            const files = memFiles();
            const pre = path ? path + '/' : '';
            const seen = new Map();
            for (const d of memDirs()) {
              if (d.startsWith(pre) && d !== path)
                seen.set(d.slice(pre.length).split('/')[0], { dir: true, size: 0 });
            }
            for (const p in files) {
              if (!p.startsWith(pre)) continue;
              const rest = p.slice(pre.length).split('/');
              if (rest.length > 1) seen.set(rest[0], { dir: true, size: 0 });
              else seen.set(rest[0], { dir: false, size: files[p].length });
            }
            if (path && !seen.size && !memDirs().includes(path)) throw new Error('not found');
            return [...seen].map(([name, v]) => ({ name, dir: v.dir, size: v.size }));
          },
          read: async (path) => {
            const files = memFiles();
            if (!(path in files)) throw new Error('not found');
            return files[path];
          },
          write: async (path, text) => {
            const files = memFiles();
            files[path] = text;
            ls.set('fs', JSON.stringify(files));
          },
          mkdir: async (path) => {
            const dirs = memDirs();
            if (!dirs.includes(path)) dirs.push(path);
            ls.set('dirs', JSON.stringify(dirs));
          },
          remove: async (path) => {
            const files = memFiles();
            for (const p in files) if (p === path || p.startsWith(path + '/')) delete files[p];
            ls.set('fs', JSON.stringify(files));
            ls.set(
              'dirs',
              JSON.stringify(memDirs().filter((d) => d !== path && !d.startsWith(path + '/'))),
            );
          },
        },
        ui: async () => {},
        http(req, onText) {
          const ctl = new AbortController();
          const headers = Object.assign({}, req.headers);
          const saved = req.keyOf ? ls.json('keys', {})[req.keyOf] : null;
          for (const h in headers) {
            if (headers[h].includes('{{key}}')) {
              if (saved && saved.h === new URL(req.url).host)
                headers[h] = headers[h].replace('{{key}}', saved.k);
              else delete headers[h];
            }
          }
          if (/anthropic\.com/.test(req.url))
            headers['anthropic-dangerous-direct-browser-access'] = 'true';
          const done = (async () => {
            const res = await fetch(req.url, {
              method: req.method,
              headers,
              body: req.body || undefined,
              signal: ctl.signal,
            });
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            for (;;) {
              const { value, done: end } = await reader.read();
              if (end) break;
              onText(dec.decode(value, { stream: true }));
            }
            return res.status;
          })();
          return { done, abort: () => ctl.abort() };
        },
      };

  // ───────────────────────────── Providers ─────────────────────────────

  const PROVIDERS = [
    { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1' },
    {
      id: 'anthropic',
      name: 'Anthropic',
      base: 'https://api.anthropic.com/v1',
      style: 'anthropic',
    },
    {
      id: 'google',
      name: 'Google Gemini',
      base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    },
    { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1' },
    { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1' },
    { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1' },
    { id: 'mistral', name: 'Mistral', base: 'https://api.mistral.ai/v1' },
    { id: 'xai', name: 'xAI', base: 'https://api.x.ai/v1' },
    { id: 'together', name: 'Together', base: 'https://api.together.xyz/v1' },
    {
      id: 'custom',
      name: EN ? 'Your own server (Ollama, LM Studio…)' : 'Tu propio servidor (Ollama, LM Studio…)',
      custom: true,
    },
  ];
  const provider = (id) => PROVIDERS.find((p) => p.id === id);
  const NOT_CHAT =
    /embed|tts|whisper|dall-e|image|audio|moderation|realtime|transcri|babbage|davinci|sora|rerank|guard/i;

  /** settings: { model: 'provider/model', models: {provider: [ids]}, customBase: '' } */
  let settings = { model: '', models: {}, customBase: '' };
  /** provider id → host its key belongs to ('' = no key). */
  let keys = {};

  const baseOf = (p) => (p.custom ? settings.customBase.replace(/\/+$/, '') : p.base);
  const usable = (p) => (p.custom ? !!settings.customBase : p.id in keys);
  const hostOf = (url) => {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  };

  function headersFor(p) {
    const h = { 'Content-Type': 'application/json' };
    if (p.style === 'anthropic') {
      h['x-api-key'] = '{{key}}';
      h['anthropic-version'] = '2023-06-01';
    } else if (p.id in keys) {
      h['Authorization'] = 'Bearer {{key}}';
    }
    return h;
  }

  /** A whole (not streamed) request. Returns the parsed JSON, or throws with the provider's message. */
  async function request(p, method, path, body) {
    let raw = '';
    const r = zx.http(
      {
        url: baseOf(p) + path,
        method,
        headers: headersFor(p),
        body: body ? JSON.stringify(body) : '',
        keyOf: p.id,
      },
      (s) => (raw += s),
    );
    const status = await r.done;
    if (status < 200 || status >= 300) throw new Error(errorText(status, raw));
    return JSON.parse(raw);
  }

  function errorText(status, raw) {
    let msg = raw.slice(0, 400);
    try {
      const j = JSON.parse(raw);
      const e = Array.isArray(j) ? j[0] && j[0].error : j.error;
      msg = (e && (e.message || (typeof e === 'string' ? e : ''))) || j.message || msg;
    } catch {}
    return status + ': ' + String(msg).trim();
  }

  async function fetchModels(p) {
    const j = await request(p, 'GET', p.style === 'anthropic' ? '/models?limit=200' : '/models');
    const list = (j.data || j.models || [])
      .map((m) => String(m.id || m.name || '').replace(/^models\//, ''))
      .filter(Boolean);
    const ids = [...new Set(list)].filter((id) => !NOT_CHAT.test(id)).sort();
    settings.models[p.id] = ids;
    await saveSettings();
    return ids;
  }

  // ───────────────────────────── Storage ─────────────────────────────

  const saveSettings = () => zx.store.set('settings', JSON.stringify(settings));
  /** [{id, title, updated}] newest first. */
  let index = [];
  /** The open chat: {id, title, model, agent, auto, messages}. */
  let chat = null;

  async function loadIndex() {
    try {
      index = JSON.parse((await zx.store.get('chats')) || '[]');
    } catch {
      index = [];
    }
  }

  /** Another window of the app may have saved chats: merge with what is stored. */
  async function saveChat() {
    if (!chat || !chat.messages.length) return;
    await zx.store.set('chat-' + chat.id, JSON.stringify(chat));
    await loadIndex();
    index = index.filter((c) => c.id !== chat.id);
    index.unshift({ id: chat.id, title: chat.title, updated: Date.now() });
    await zx.store.set('chats', JSON.stringify(index));
    renderChats();
  }

  function newChat() {
    chat = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: '',
      model: settings.model,
      agent: true,
      auto: false,
      messages: [],
    };
    renderAll();
  }

  async function openChat(id) {
    if (busy) return;
    try {
      const c = JSON.parse(await zx.store.get('chat-' + id));
      if (!c || !Array.isArray(c.messages)) throw new Error('bad');
      chat = c;
    } catch {
      index = index.filter((c) => c.id !== id);
      await zx.store.set('chats', JSON.stringify(index));
    }
    renderAll();
    if (narrow()) setSide(false);
  }

  async function deleteChat(id) {
    if (busy) return;
    if (!(await ask(t('deleteChat'), '', null, t('delete')))) return;
    await zx.store.del('chat-' + id);
    await loadIndex();
    index = index.filter((c) => c.id !== id);
    await zx.store.set('chats', JSON.stringify(index));
    if (chat && chat.id === id) newChat();
    else renderChats();
  }

  // ───────────────────────────── Files ─────────────────────────────

  /** A path inside the project folder: no leading slash, no "..". */
  function cleanPath(p) {
    const parts = String(p || '')
      .replace(/\\/g, '/')
      .split('/')
      .filter((s) => s && s !== '.');
    if (parts.includes('..'))
      throw new Error('".." is not allowed: paths are inside the project folder');
    return parts.join('/');
  }

  async function listDir(path) {
    const items = await zx.fs.list(path);
    return items
      .filter((i) => !i.name.startsWith('.'))
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  }

  const TOOLS = [
    {
      name: 'list_files',
      description:
        'List the files and folders of a folder of the project ("" is the project root).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Folder path relative to the project root' },
        },
      },
    },
    {
      name: 'read_file',
      description: 'Read a text file of the project.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
    {
      name: 'search_files',
      description:
        'Search the text files of the project for a text (case-insensitive). Returns path:line: text.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          path: { type: 'string', description: 'Folder to search in (default: all)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'write_file',
      description:
        'Create a file or replace its whole content. Missing folders are created. The user approves it.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
    {
      name: 'edit_file',
      description:
        'Replace one exact piece of text of a file (old_text must appear exactly once). The user approves it.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_text: { type: 'string' },
          new_text: { type: 'string' },
        },
        required: ['path', 'old_text', 'new_text'],
      },
    },
    {
      name: 'delete_file',
      description: 'Delete a file or a folder (with everything inside). The user approves it.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  ];
  const WRITES = new Set(['write_file', 'edit_file', 'delete_file']);
  const LIMIT = 60000;
  const clip = (s) => (s.length > LIMIT ? s.slice(0, LIMIT) + '\n… (truncated)' : s);

  async function searchFiles(query, root) {
    const q = String(query || '').toLowerCase();
    if (!q) throw new Error('empty query');
    const out = [];
    let seen = 0;
    const walk = async (dir) => {
      for (const item of await listDir(dir)) {
        if (out.length >= 60 || seen >= 400) return;
        const p = dir ? dir + '/' + item.name : item.name;
        if (item.dir) {
          if (item.name !== 'node_modules') await walk(p);
          continue;
        }
        if (item.size > 400000) continue;
        seen++;
        let text;
        try {
          text = await zx.fs.read(p);
        } catch {
          continue;
        }
        const lines = text.split('\n');
        for (let i = 0; i < lines.length && out.length < 60; i++) {
          if (lines[i].toLowerCase().includes(q))
            out.push(p + ':' + (i + 1) + ': ' + lines[i].trim().slice(0, 200));
        }
      }
    };
    await walk(root);
    return out.length ? out.join('\n') : 'No matches.';
  }

  /** Runs one tool call. Returns {text, error}. */
  async function runTool(c) {
    try {
      if (c.bad) throw new Error('The arguments were not valid JSON.');
      const a = c.args || {};
      const path = cleanPath(a.path);
      if (WRITES.has(c.name)) {
        if (!path) throw new Error('path is required');
        let before = null;
        if (c.name === 'edit_file') {
          before = await zx.fs.read(path);
          const n = before.split(String(a.old_text)).length - 1;
          if (!a.old_text || n === 0)
            throw new Error('old_text was not found in the file. Read the file again.');
          if (n > 1)
            throw new Error(
              'old_text appears ' + n + ' times. Give more surrounding text so it is unique.',
            );
        }
        if (!chat.auto && !(await approve(c, path))) return { text: t('denied'), error: true };
        if (c.name === 'write_file')
          await zx.fs.write(path, String(a.content == null ? '' : a.content));
        else if (c.name === 'edit_file')
          await zx.fs.write(
            path,
            before.replace(String(a.old_text), () => String(a.new_text == null ? '' : a.new_text)),
          );
        else await zx.fs.remove(path);
        refreshFiles();
        return { text: 'OK' };
      }
      if (c.name === 'list_files') {
        const items = await listDir(path);
        return {
          text: items.length
            ? items
                .map((i) => (i.dir ? i.name + '/' : i.name + '  (' + i.size + ' bytes)'))
                .join('\n')
            : '(empty folder)',
        };
      }
      if (c.name === 'read_file') return { text: clip(await zx.fs.read(path)) };
      if (c.name === 'search_files') return { text: await searchFiles(a.query, path) };
      throw new Error('Unknown tool: ' + c.name);
    } catch (e) {
      return { text: 'Error: ' + (e && e.message ? e.message : String(e)), error: true };
    }
  }

  // ───────────────────────────── Talking to the AI ─────────────────────────────

  function systemPrompt() {
    let s =
      "You are Zinarix AI, the assistant of Zinarix Studio, running on the user's iPad. Answer in the language the user writes in. Be concise and use Markdown.";
    if (chat.agent) {
      s +=
        ' You can work on the project folder of this iPad with the tools: list, read, search, write, edit and delete files (paths are relative to the project root). There is no terminal on the iPad: you cannot run commands, install packages or run the code; say so when it matters. Read a file before editing it. The user approves every write.';
    }
    return s;
  }

  function toOpenAI() {
    const out = [{ role: 'system', content: systemPrompt() }];
    for (const m of chat.messages) {
      if (m.role === 'user') out.push({ role: 'user', content: m.text });
      else if (m.role === 'assistant') {
        const calls = m.calls || [];
        if (!m.text && !calls.length) continue;
        const o = { role: 'assistant', content: m.text || '' };
        if (calls.length)
          o.tool_calls = calls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
          }));
        out.push(o);
      } else out.push({ role: 'tool', tool_call_id: m.id, content: m.result });
    }
    return out;
  }

  function toAnthropic() {
    const out = [];
    for (const m of chat.messages) {
      if (m.role === 'user') out.push({ role: 'user', content: m.text });
      else if (m.role === 'assistant') {
        const calls = m.calls || [];
        if (!m.text && !calls.length) continue;
        const blocks = [];
        if (m.text) blocks.push({ type: 'text', text: m.text });
        for (const c of calls)
          blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} });
        out.push({ role: 'assistant', content: blocks });
      } else {
        const block = { type: 'tool_result', tool_use_id: m.id, content: m.result || '(empty)' };
        if (m.error) block.is_error = true;
        const last = out[out.length - 1];
        if (
          last &&
          last.role === 'user' &&
          Array.isArray(last.content) &&
          last.content[0].type === 'tool_result'
        )
          last.content.push(block);
        else out.push({ role: 'user', content: [block] });
      }
    }
    return out;
  }

  let current = null; // the running request (to stop it)
  let stopped = false;

  /** Streams one answer into `msg` ({text, calls}); `tick` is called as it grows. */
  async function streamReply(msg, tick) {
    const [pid, ...rest] = chat.model.split('/');
    const model = rest.join('/');
    const p = provider(pid);
    if (!p || !usable(p) || !model) throw new Error(t('needModel'));
    const anth = p.style === 'anthropic';
    const body = anth
      ? { model, max_tokens: 8192, system: systemPrompt(), messages: toAnthropic(), stream: true }
      : { model, messages: toOpenAI(), stream: true };
    if (chat.agent) {
      body.tools = anth
        ? TOOLS.map((x) => ({
            name: x.name,
            description: x.description,
            input_schema: x.parameters,
          }))
        : TOOLS.map((x) => ({ type: 'function', function: x }));
    }

    const slots = [];
    let failure = '';
    let raw = '';
    let buf = '';
    let block = null;
    const onEvent = (j) => {
      if (j.error) {
        failure = String(j.error.message || j.error.type || JSON.stringify(j.error));
        return;
      }
      if (anth) {
        if (j.type === 'content_block_start') {
          block = null;
          if (j.content_block && j.content_block.type === 'tool_use') {
            block = { id: j.content_block.id, name: j.content_block.name, raw: '' };
            slots.push(block);
          }
        } else if (j.type === 'content_block_delta' && j.delta) {
          if (j.delta.type === 'text_delta') msg.text += j.delta.text || '';
          else if (j.delta.type === 'input_json_delta' && block)
            block.raw += j.delta.partial_json || '';
        }
        return;
      }
      const d = j.choices && j.choices[0] && j.choices[0].delta;
      if (!d) return;
      if (typeof d.content === 'string') msg.text += d.content;
      for (const tc of d.tool_calls || []) {
        let slot;
        if (typeof tc.index === 'number')
          slot = slots[tc.index] || (slots[tc.index] = { id: '', name: '', raw: '' });
        else if (tc.id) slot = slots.find((s) => s && s.id === tc.id);
        else slot = slots[slots.length - 1];
        if (!slot) {
          slot = { id: '', name: '', raw: '' };
          slots.push(slot);
        }
        if (tc.id) slot.id = tc.id;
        const f = tc.function || {};
        if (f.name && !slot.name) slot.name = f.name;
        if (typeof f.arguments === 'string') slot.raw += f.arguments;
      }
    };
    const onText = (s) => {
      if (raw.length < 4000) raw += s;
      buf += s;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          onEvent(JSON.parse(data));
        } catch {}
      }
      tick();
    };

    current = zx.http(
      {
        url: baseOf(p) + (anth ? '/messages' : '/chat/completions'),
        method: 'POST',
        headers: headersFor(p),
        body: JSON.stringify(body),
        keyOf: p.id,
      },
      onText,
    );
    let status;
    try {
      status = await current.done;
    } catch (e) {
      if (stopped) return;
      throw e;
    } finally {
      current = null;
    }
    if (status < 200 || status >= 300) throw new Error(errorText(status, raw));
    if (failure) throw new Error(failure);
    if (stopped) return;
    msg.calls = slots
      .filter((s) => s && s.name)
      .map((s, i) => {
        const c = { id: s.id || 'call_' + Date.now().toString(36) + i, name: s.name, args: {} };
        try {
          c.args = s.raw.trim() ? JSON.parse(s.raw) : {};
        } catch {
          c.bad = true;
        }
        return c;
      });
  }

  let busy = false;

  async function run() {
    busy = true;
    stopped = false;
    renderComposer();
    try {
      for (let step = 0; ; step++) {
        if (step >= 40) {
          notice(t('tooManySteps'));
          break;
        }
        const msg = { role: 'assistant', text: '', calls: [] };
        chat.messages.push(msg);
        const view = addAssistant(msg, true);
        let queued = false;
        const tick = () => {
          if (queued) return;
          queued = true;
          requestAnimationFrame(() => {
            queued = false;
            view.update(true);
          });
        };
        try {
          await streamReply(msg, tick);
        } finally {
          view.update(false);
          if (!msg.text && !msg.calls.length) {
            chat.messages.splice(chat.messages.indexOf(msg), 1);
            view.root.remove();
          }
        }
        if (stopped || !msg.calls.length) break;
        for (const c of msg.calls) {
          const res = stopped ? { text: t('stopped'), error: true } : await runTool(c);
          const tm = { role: 'tool', id: c.id, name: c.name, result: res.text, error: !!res.error };
          chat.messages.push(tm);
          addTool(c, tm);
          scrollDown();
        }
        await saveChat();
        if (stopped) break;
      }
    } catch (e) {
      notice(t('error') + ': ' + (e && e.message ? e.message : String(e)));
    }
    busy = false;
    renderComposer();
    await saveChat();
  }

  function stop() {
    stopped = true;
    if (current) current.abort();
    if (pendingApproval) pendingApproval(false);
  }

  async function send() {
    const input = $('input');
    const text = input.value.trim();
    if (!text || busy) return;
    if (!chat.model) chat.model = settings.model;
    const p = provider(chat.model.split('/')[0]);
    if (!p || !usable(p)) {
      if (PROVIDERS.some(usable)) openModels();
      else openSettings();
      return;
    }
    input.value = '';
    autoGrow();
    if (!chat.messages.length) {
      chat.title = text.replace(/\s+/g, ' ').slice(0, 48);
      $('msgs').textContent = '';
      $('title').textContent = chat.title;
    }
    const m = { role: 'user', text };
    chat.messages.push(m);
    addUser(m);
    scrollDown(true);
    await run();
  }

  // ───────────────────────────── Markdown ─────────────────────────────

  const esc = (s) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  /** `s` is already escaped. */
  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (_, c) => {
      codes.push(c);
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    s = s
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s(])\*([^*\s][^*\n]*)\*/g, '$1<i>$2</i>')
      .replace(
        /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
      );
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + codes[+i] + '</code>');
  }

  function markdown(src) {
    const lines = src.replace(/\u0000/g, '').split('\n');
    let html = '';
    let para = [];
    let list = '';
    const flush = () => {
      if (para.length) html += '<p>' + inline(esc(para.join('\n'))).replace(/\n/g, '<br>') + '</p>';
      para = [];
    };
    const endList = () => {
      if (list) html += '</' + list + '>';
      list = '';
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = line.match(/^\s*```/);
      if (fence) {
        flush();
        endList();
        const code = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        html += '<pre><code>' + esc(code.join('\n')) + '</code></pre>';
        continue;
      }
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      const li = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
      if (h) {
        flush();
        endList();
        const n = Math.min(3, h[1].length);
        html += '<h' + n + '>' + inline(esc(h[2])) + '</h' + n + '>';
      } else if (li) {
        flush();
        const kind = /\d/.test(li[1]) ? 'ol' : 'ul';
        if (list !== kind) {
          endList();
          html += '<' + kind + '>';
          list = kind;
        }
        html += '<li>' + inline(esc(li[2])) + '</li>';
      } else if (!line.trim()) {
        flush();
        endList();
      } else {
        endList();
        para.push(line);
      }
    }
    flush();
    endList();
    return html;
  }

  // ───────────────────────────── Chat view ─────────────────────────────

  const msgs = $('msgs');
  const nearBottom = () => msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 120;
  const scrollDown = (force) => {
    if (force || nearBottom()) msgs.scrollTop = msgs.scrollHeight;
  };

  function addUser(m) {
    const root = el('div', 'msg user');
    root.appendChild(el('div', 'bubble', m.text));
    msgs.appendChild(root);
  }

  function addAssistant(m, live) {
    const root = el('div', 'msg assistant');
    msgs.appendChild(root);
    const update = (running) => {
      const stick = nearBottom();
      root.innerHTML = markdown(m.text) + (running && !m.text ? '<span class="dots"></span>' : '');
      for (const pre of root.querySelectorAll('pre')) {
        const b = el('button', 'btn small copy', t('copy'));
        b.onclick = () => {
          copyText(pre.querySelector('code').textContent);
          b.textContent = t('copied');
          setTimeout(() => (b.textContent = t('copy')), 1200);
        };
        pre.appendChild(b);
      }
      if (stick) msgs.scrollTop = msgs.scrollHeight;
    };
    update(!!live);
    return { root, update };
  }

  function addTool(c, tm) {
    const root = el('div', 'tool' + (tm.error ? ' bad' : ''));
    root.appendChild(el('b', '', c.name));
    const a = c.args || {};
    const what = a.path != null ? a.path || '/' : a.query != null ? '“' + a.query + '”' : '';
    root.appendChild(
      document.createTextNode(
        ' ' + what + (tm.error ? ' — ' + String(tm.result).slice(0, 300) : ''),
      ),
    );
    msgs.appendChild(root);
  }

  function notice(text) {
    msgs.appendChild(el('div', 'notice', text));
    scrollDown(true);
  }

  let pendingApproval = null;

  function approve(c, path) {
    return new Promise((resolve) => {
      const a = c.args || {};
      const card = el('div', 'card');
      const title =
        c.name === 'write_file'
          ? t('wantsWrite')
          : c.name === 'edit_file'
            ? t('wantsEdit')
            : t('wantsDelete');
      card.appendChild(el('h3', '', title + ': ' + path));
      const show = (text, cls) => {
        const pre = el('pre', cls);
        const s = String(text == null ? '' : text);
        pre.appendChild(el('code', '', s.length > 6000 ? s.slice(0, 6000) + '\n…' : s));
        card.appendChild(pre);
      };
      if (c.name === 'write_file') show(a.content, 'add');
      if (c.name === 'edit_file') {
        show(a.old_text, 'del');
        show(a.new_text, 'add');
      }
      const row = el('div', 'row');
      const done = (ok, always) => {
        pendingApproval = null;
        if (always) chat.auto = true;
        card.remove();
        resolve(ok);
      };
      const mk = (cls, label, ok, always) => {
        const b = el('button', 'btn ' + cls, label);
        b.onclick = () => done(ok, always);
        row.appendChild(b);
      };
      mk('primary', t('allow'), true, false);
      mk('', t('allowAlways'), true, true);
      mk('danger', t('deny'), false, false);
      card.appendChild(row);
      msgs.appendChild(card);
      pendingApproval = (ok) => done(ok, false);
      scrollDown(true);
    });
  }

  function renderMessages() {
    msgs.textContent = '';
    if (!chat.messages.length) {
      const e = el('div', 'empty');
      e.appendChild(el('h1', '', t('emptyTitle')));
      e.appendChild(el('p', '', PROVIDERS.some(usable) ? t('emptyText') : t('emptyNoKey')));
      msgs.appendChild(e);
      return;
    }
    const calls = new Map();
    for (const m of chat.messages) {
      if (m.role === 'user') addUser(m);
      else if (m.role === 'assistant') {
        if (m.text) addAssistant(m, false);
        for (const c of m.calls || []) calls.set(c.id, c);
      } else addTool(calls.get(m.id) || { name: m.name, args: {} }, m);
    }
    msgs.scrollTop = msgs.scrollHeight;
  }

  function renderChats() {
    const box = $('chats');
    box.textContent = '';
    for (const c of index) {
      const row = el('div', 'chat-row' + (chat && chat.id === c.id ? ' on' : ''));
      const name = el('span', '', c.title || t('untitled'));
      name.onclick = () => openChat(c.id);
      const del = el('button', 'icon', '🗑');
      del.onclick = () => deleteChat(c.id);
      row.appendChild(name);
      row.appendChild(del);
      box.appendChild(row);
    }
  }

  function modelLabel(id) {
    if (!id) return t('pickModel');
    const [pid, ...rest] = id.split('/');
    const p = provider(pid);
    return p && usable(p) ? rest.join('/') : t('pickModel');
  }

  function renderTop() {
    $('title').textContent = chat.title || t('untitled');
    $('modelBtn').textContent = modelLabel(chat.model || settings.model);
    $('agent').checked = !!chat.agent;
  }

  function renderComposer() {
    $('send').textContent = busy ? t('stop') : t('send');
    $('send').classList.toggle('danger', busy);
  }

  function renderAll() {
    renderChats();
    renderTop();
    renderMessages();
    renderComposer();
  }

  function copyText(s) {
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(s).catch(() => zx.ui('copy', s));
    else zx.ui('copy', s);
  }

  // ───────────────────────────── Small dialog ─────────────────────────────

  /** With `value` (a string) it asks for a text and resolves to it; with null it is a yes/no. */
  function ask(title, text, value, okLabel) {
    return new Promise((resolve) => {
      const d = $('ask');
      $('askTitle').textContent = title;
      $('askText').textContent = text || '';
      $('askText').hidden = !text;
      const input = $('askInput');
      input.hidden = value == null;
      input.value = value || '';
      $('askOk').textContent = okLabel || t('ok');
      $('askCancel').textContent = t('cancel');
      const finish = (v) => {
        d.close();
        $('askOk').onclick = $('askCancel').onclick = d.oncancel = input.onkeydown = null;
        resolve(v);
      };
      $('askOk').onclick = () => finish(value == null ? true : input.value.trim());
      $('askCancel').onclick = () => finish(value == null ? false : '');
      d.oncancel = (e) => {
        e.preventDefault();
        finish(value == null ? false : '');
      };
      input.onkeydown = (e) => {
        if (e.key === 'Enter') $('askOk').click();
      };
      d.showModal();
      if (value != null) input.focus();
    });
  }

  // ───────────────────────────── Settings (keys) ─────────────────────────────

  function openSettings() {
    $('settingsTitle').textContent = t('settingsTitle');
    $('settingsHint').textContent = t('settingsHint');
    $('settingsFoot').textContent = t('settingsFoot');
    renderProviders();
    $('settings').showModal();
  }

  function renderProviders() {
    const box = $('providers');
    box.textContent = '';
    for (const p of PROVIDERS) {
      const root = el('div', 'provider');
      const head = el('div', 'head');
      head.appendChild(el('b', '', p.name));
      const count = (settings.models[p.id] || []).length;
      const state = el(
        'span',
        'state' + (usable(p) ? ' ok' : ''),
        usable(p)
          ? t('connected') + (count ? ' · ' + count + ' ' + t('modelsFound') : '')
          : t('notConnected'),
      );
      head.appendChild(state);
      root.appendChild(head);

      const row = el('div', 'row');
      let url = null;
      if (p.custom) {
        url = el('input');
        url.type = 'url';
        url.placeholder = t('baseUrl');
        url.value = settings.customBase;
        url.autocapitalize = 'off';
        row.appendChild(url);
      }
      const key = el('input');
      key.type = 'password';
      key.placeholder = p.id in keys ? '••••••••' : p.custom ? t('keyOptional') : t('key');
      key.autocomplete = 'off';
      row.appendChild(key);
      const save = el('button', 'btn primary small', t('save'));
      row.appendChild(save);
      if (usable(p)) {
        const rm = el('button', 'btn danger small', t('remove'));
        rm.onclick = async () => {
          await zx.keys.del(p.id);
          if (p.custom) settings.customBase = '';
          delete settings.models[p.id];
          await saveSettings();
          keys = await zx.keys.list();
          renderProviders();
          renderTop();
        };
        row.appendChild(rm);
      }
      save.onclick = async () => {
        const k = key.value.trim();
        if (p.custom) {
          const base = url.value.trim().replace(/\/+$/, '');
          if (!/^https?:\/\/[^\s/]+/.test(base)) return void url.focus();
          settings.customBase = base;
          await saveSettings();
        } else if (!k) return void key.focus();
        if (k) await zx.keys.set(p.id, k, hostOf(baseOf(p)));
        keys = await zx.keys.list();
        state.className = 'state';
        state.textContent = t('checking');
        save.disabled = true;
        try {
          const ids = await fetchModels(p);
          if (!settings.model && ids.length) {
            settings.model = p.id + '/' + ids[0];
            await saveSettings();
          }
          if (chat && !chat.messages.length && !modelLabelOk(chat.model))
            chat.model = settings.model;
          renderProviders();
          renderTop();
          if (chat && !chat.messages.length) renderMessages();
        } catch (e) {
          state.className = 'state bad';
          state.textContent = String((e && e.message) || e).slice(0, 160);
          save.disabled = false;
        }
      };
      root.appendChild(row);
      box.appendChild(root);
    }
  }

  const modelLabelOk = (id) => {
    const p = id && provider(id.split('/')[0]);
    return !!(p && usable(p));
  };

  // ───────────────────────────── Model picker ─────────────────────────────

  function openModels() {
    if (!PROVIDERS.some(usable)) return openSettings();
    $('modelsTitle').textContent = t('modelsTitle');
    $('modelSearch').placeholder = t('search');
    $('modelSearch').value = '';
    renderModels();
    $('models').showModal();
  }

  function pickModel(id) {
    chat.model = id;
    settings.model = id;
    saveSettings();
    $('models').close();
    renderTop();
  }

  function renderModels() {
    const box = $('modelList');
    box.textContent = '';
    const q = $('modelSearch').value.trim().toLowerCase();
    for (const p of PROVIDERS.filter(usable)) {
      const group = el('div', 'model-group');
      group.appendChild(el('span', '', p.name));
      const refresh = el('button', 'btn small ghost', t('refresh'));
      refresh.onclick = async () => {
        refresh.disabled = true;
        try {
          await fetchModels(p);
        } catch (e) {
          refresh.textContent = String((e && e.message) || e).slice(0, 80);
        }
        renderModels();
      };
      group.appendChild(refresh);
      box.appendChild(group);
      const ids = (settings.models[p.id] || []).filter((id) => !q || id.toLowerCase().includes(q));
      for (const id of ids.slice(0, 200)) {
        const full = p.id + '/' + id;
        const row = el('div', 'model' + (chat.model === full ? ' on' : ''), id);
        row.onclick = () => pickModel(full);
        box.appendChild(row);
      }
      // A model the list does not have (new, or a server that does not list): type its name.
      if (q && !ids.some((id) => id.toLowerCase() === q)) {
        const typed = $('modelSearch').value.trim();
        const row = el('div', 'model', t('useTyped') + ' “' + typed + '”');
        row.onclick = () => pickModel(p.id + '/' + typed);
        box.appendChild(row);
      }
    }
  }

  // ───────────────────────────── Files panel ─────────────────────────────

  let cwd = '';
  let openFile = null;

  async function refreshFiles() {
    if ($('files').hidden) return;
    const crumbs = $('crumbs');
    crumbs.textContent = '';
    const parts = cwd ? cwd.split('/') : [];
    const crumb = (label, path) => {
      const b = el('button', '', label);
      b.onclick = () => {
        cwd = path;
        refreshFiles();
      };
      crumbs.appendChild(b);
    };
    crumb(t('root'), '');
    parts.forEach((name, i) => {
      crumbs.appendChild(document.createTextNode(' / '));
      crumb(name, parts.slice(0, i + 1).join('/'));
    });
    const box = $('entries');
    let items;
    try {
      items = await listDir(cwd);
    } catch {
      if (cwd) {
        cwd = '';
        return refreshFiles();
      }
      items = [];
    }
    box.textContent = '';
    if (!items.length) box.appendChild(el('div', 'hint', t('emptyFolder'))).style.padding = '12px';
    for (const item of items) {
      const row = el('div', 'entry');
      row.appendChild(el('span', '', item.dir ? '📁' : '📄'));
      row.appendChild(el('span', 'name', item.name));
      if (!item.dir)
        row.appendChild(
          el(
            'span',
            'size',
            item.size < 1024 ? item.size + ' B' : Math.round(item.size / 1024) + ' KB',
          ),
        );
      const path = cwd ? cwd + '/' + item.name : item.name;
      row.onclick = () => {
        if (item.dir) {
          cwd = path;
          refreshFiles();
        } else edit(path);
      };
      if (item.dir) {
        const del = el('button', 'icon', '🗑');
        del.onclick = async (e) => {
          e.stopPropagation();
          if (!(await ask(t('deleteFile'), path, null, t('delete')))) return;
          await zx.fs.remove(path);
          refreshFiles();
        };
        row.appendChild(del);
      }
      box.appendChild(row);
    }
  }

  async function edit(path) {
    let text;
    try {
      text = await zx.fs.read(path);
    } catch (e) {
      notice(path + ': ' + ((e && e.message) || e));
      return;
    }
    openFile = path;
    $('editorName').textContent = path;
    $('editorText').value = text;
    $('editorSave').textContent = t('save');
    $('editorDelete').textContent = t('delete');
    $('editor').hidden = false;
  }

  function showFiles(on) {
    $('files').hidden = !on;
    if (on) {
      if (narrow()) setSide(false);
      refreshFiles();
    }
  }

  async function createEntry(folder) {
    const name = await ask(t(folder ? 'newFolder' : 'newFile'), '', '');
    if (!name) return;
    let path;
    try {
      path = cleanPath((cwd ? cwd + '/' : '') + name);
    } catch {
      return;
    }
    if (!path) return;
    if (folder) await zx.fs.mkdir(path);
    else await zx.fs.write(path, '');
    await refreshFiles();
    if (!folder) edit(path);
  }

  // ───────────────────────────── Layout and events ─────────────────────────────

  const narrow = () => window.innerWidth <= 760;
  const setSide = (on) => $('app').classList.toggle('no-side', !on);

  function autoGrow() {
    const i = $('input');
    i.style.height = 'auto';
    i.style.height = Math.min(i.scrollHeight + 2, window.innerHeight * 0.4) + 'px';
  }

  function fitViewport() {
    const vv = window.visualViewport;
    document.documentElement.style.setProperty(
      '--vh',
      (vv ? vv.height : window.innerHeight) + 'px',
    );
    window.scrollTo(0, 0);
  }

  function wire() {
    $('newChat').textContent = t('newChat');
    $('openFiles').textContent = t('files');
    $('openSettings').textContent = t('settings');
    $('agentLabel').textContent = t('agent');
    $('input').placeholder = t('placeholder');

    $('newChat').onclick = () => {
      if (busy) return;
      newChat();
      if (narrow()) setSide(false);
      $('input').focus();
    };
    $('openSettings').onclick = openSettings;
    $('openFiles').onclick = () => showFiles(true);
    $('filesBtn').onclick = () => showFiles($('files').hidden);
    $('closeFiles').onclick = () => showFiles(false);
    $('toggleSide').onclick = () => setSide($('app').classList.contains('no-side'));
    $('shade').onclick = () => setSide(false);
    $('modelBtn').onclick = openModels;
    $('modelSearch').oninput = renderModels;
    $('agent').onchange = (e) => {
      chat.agent = e.target.checked;
    };
    $('send').onclick = () => (busy ? stop() : send());
    $('input').oninput = autoGrow;
    $('input').onkeydown = (e) => {
      // Enter sends with a keyboard attached; Shift+Enter is a new line.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    };
    $('newFile').onclick = () => createEntry(false);
    $('newFolder').onclick = () => createEntry(true);
    $('editorClose').onclick = () => {
      $('editor').hidden = true;
      openFile = null;
    };
    $('editorSave').onclick = async () => {
      if (!openFile) return;
      await zx.fs.write(openFile, $('editorText').value);
      $('editorSave').textContent = t('saved');
      setTimeout(() => ($('editorSave').textContent = t('save')), 1200);
      refreshFiles();
    };
    $('editorDelete').onclick = async () => {
      if (!openFile || !(await ask(t('deleteFile'), openFile, null, t('delete')))) return;
      await zx.fs.remove(openFile);
      $('editorClose').click();
      refreshFiles();
    };
    $('editorText').onkeydown = (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        document.execCommand('insertText', false, '  ');
      } else if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        $('editorSave').click();
      }
    };
    for (const b of document.querySelectorAll('[data-close]'))
      b.onclick = () => b.closest('dialog').close();
    for (const d of document.querySelectorAll('dialog.sheet')) {
      d.addEventListener('click', (e) => {
        if (e.target === d && d.id !== 'ask') d.close();
      });
    }

    if (window.visualViewport) window.visualViewport.addEventListener('resize', fitViewport);
    // Split View / Stage Manager change the width: the side bar hides when it gets narrow.
    let wasNarrow = narrow();
    window.addEventListener('resize', () => {
      fitViewport();
      if (narrow() !== wasNarrow) {
        wasNarrow = narrow();
        setSide(!wasNarrow);
      }
    });
    fitViewport();
    // Another window may have added chats or keys while this one was behind.
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden || busy) return;
      await loadIndex();
      keys = await zx.keys.list();
      renderChats();
      renderTop();
    });
  }

  async function start() {
    wire();
    if (narrow()) setSide(false);
    try {
      const s = JSON.parse((await zx.store.get('settings')) || '{}');
      settings = { model: s.model || '', models: s.models || {}, customBase: s.customBase || '' };
    } catch {}
    try {
      keys = (await zx.keys.list()) || {};
    } catch {
      keys = {};
    }
    await loadIndex();
    newChat();
  }

  start();
})();
