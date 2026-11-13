/**
 * The page the phone opens: pairing with the PIN, then the chats of the window (messages,
 * approvals, stop). Self-contained (no files, no outside requests); text is never parsed as
 * HTML.
 */
export function phonePage(nonce: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="theme-color" content="#131417" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Zinarix Studio</title>
<style nonce="${nonce}">
/* Same look as the chat of the desktop app (styles.css: dark / light, chat, tool cards). */
:root{
  --bg:#1a1b1e;--bg-2:#202125;--bg-3:#26272c;--bg-4:#32343c;--border:#33353d;
  --fg:#c8ccd4;--fg-dim:#8a8f9a;--strong:#fff;--hover:#26282e;
  --accent:#3b6fe0;--accent-fg:#fff;--focus:#6c8cff;
  --brand:#7c6cff;--grad:linear-gradient(135deg,#8b5cff,#3b82f6);
  --ok:#83d6a0;--warn:#e0b341;--danger:#f1595b;--code:#141519;
  --sel-soft:color-mix(in srgb,var(--brand) 18%,transparent);
  --ring:0 0 0 2px color-mix(in srgb,var(--focus) 38%,transparent);
  --shadow:0 12px 34px rgba(0,0,0,.55);
}
@media (prefers-color-scheme: light){:root{
  --bg:#fff;--bg-2:#f3f3f3;--bg-3:#ececec;--bg-4:#e4e6f1;--border:#d4d4d4;
  --fg:#333;--fg-dim:#717171;--strong:#000;--hover:#e8e8e8;
  --accent:#005fb8;--focus:#6d4df2;
  --brand:#6d4df2;--grad:linear-gradient(135deg,#7c3aed,#2563eb);
  --ok:#2e7d32;--warn:#8a6d00;--danger:#c72e2e;--code:#f6f8fa;
  --sel-soft:color-mix(in srgb,var(--brand) 14%,transparent);
  --ring:0 0 0 2px color-mix(in srgb,var(--focus) 30%,transparent);
  --shadow:0 12px 30px rgba(0,0,0,.16);
}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,"Segoe UI",Ubuntu,"Noto Sans",sans-serif;-webkit-font-smoothing:antialiased}
body{display:flex;flex-direction:column;height:100dvh;overflow:hidden}
button,textarea,input{font:inherit;color:inherit}
button{cursor:pointer;border:1px solid transparent;background:var(--bg-4);border-radius:6px;padding:8px 14px}
button:active{background:var(--hover)}
button:disabled{opacity:.45}
button.primary{background:var(--accent);color:var(--accent-fg);border:0;font-weight:500}
button.danger{background:transparent;color:var(--danger);border-color:var(--danger)}
svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
.hide{display:none!important}
.logo{width:28px;height:28px;border-radius:8px;background:var(--grad);display:grid;place-items:center;color:#fff;font-weight:800;font-size:15px;flex:none}

/* Header */
header{display:flex;align-items:center;gap:4px;padding:6px;padding-top:max(6px,env(safe-area-inset-top));background:var(--bg-2);border-bottom:1px solid var(--border)}
.icon{width:40px;height:40px;padding:0;border-radius:8px;display:grid;place-items:center;background:transparent;color:var(--fg-dim)}
#title{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:2px 6px;background:transparent;line-height:1.3}
#title b{font-size:14px;font-weight:600;color:var(--strong);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
#title small{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--fg-dim)}
.dot{width:7px;height:7px;border-radius:50%;background:var(--fg-dim)}
.dot.on{background:var(--ok)}

/* Drawer: chat list */
#scrim{position:fixed;inset:0;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .2s;z-index:10}
#drawer{position:fixed;top:0;bottom:0;left:0;width:min(84vw,320px);background:var(--bg-2);border-right:1px solid var(--border);z-index:11;transform:translateX(-102%);transition:transform .22s ease;display:flex;flex-direction:column;box-shadow:var(--shadow);padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}
body.open #scrim{opacity:1;pointer-events:auto}
body.open #drawer{transform:none}
.dhead{display:flex;align-items:center;gap:10px;padding:14px 14px 10px}
.dhead b{font-size:15px;color:var(--strong)}
.newbtn{margin:2px 12px 10px;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px}
.dtitle{padding:6px 16px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-dim)}
#list{flex:1;overflow-y:auto;padding:0 8px 12px}
.item{width:100%;display:flex;align-items:center;gap:8px;padding:10px;border-radius:6px;text-align:left;background:transparent;color:var(--fg)}
.item span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.item.cur{background:var(--sel-soft);color:var(--strong)}
.badge{flex:none!important;font-size:11px;padding:1px 8px;border-radius:999px;background:var(--bg-4);color:var(--fg-dim)}
.badge.wait{background:color-mix(in srgb,var(--warn) 20%,transparent);color:var(--warn)}

/* Messages (like .turn in the desktop chat) */
#log{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:14px 14px 8px;display:flex;flex-direction:column;gap:20px;user-select:text}
.turn{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%}
.user{align-self:flex-end;max-width:88%;padding:9px 13px;border-radius:14px 14px 4px 14px;background:var(--bg-3);border:1px solid var(--border);color:var(--strong);line-height:1.5}
.assistant{align-self:stretch}
.model{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--strong);margin-bottom:6px;white-space:nowrap}
.model .logo{width:18px;height:18px;border-radius:5px;font-size:10px}
pre{white-space:pre;overflow-x:auto;background:var(--code);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin:8px 0;font:12.5px/1.5 ui-monospace,"JetBrains Mono",Menlo,monospace}
code{font:12.5px ui-monospace,"JetBrains Mono",Menlo,monospace;background:var(--bg-4);padding:0 4px;border-radius:3px}
.err{color:var(--danger);font-size:13px;margin-top:6px}
.tool{margin:8px 0 0;border:1px solid var(--border);border-left:3px solid var(--focus);border-radius:4px;background:var(--bg);overflow:hidden;white-space:normal}
.tool.ok{border-left-color:var(--ok)}
.tool.error{border-left-color:var(--danger)}
.tool.approval{border-left-color:var(--warn);box-shadow:0 0 0 1px var(--warn)}
.thead{display:flex;align-items:center;gap:8px;padding:6px 8px;font-size:12.5px}
.ticon{display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:var(--sel-soft);color:var(--brand);flex:none}
.ticon svg{width:13px;height:13px}
.tname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace}
.tstat{display:grid;place-items:center;color:var(--fg-dim)}
.tstat svg{width:15px;height:15px}
.tool.ok .tstat{color:var(--ok)}
.tool.error .tstat{color:var(--danger)}
.tool.approval .tstat{color:var(--warn)}
.tool.running .tstat svg{animation:spin 1.6s linear infinite}
.tool.approval .tname{white-space:normal;overflow-wrap:anywhere}
.tactions{display:flex;gap:8px;padding:8px;border-top:1px solid var(--border)}
.tactions button{flex:1;padding:10px}
.typing{align-self:flex-start;display:inline-flex;gap:4px;padding:4px 2px}
.typing i{width:6px;height:6px;border-radius:50%;background:var(--brand);animation:dot 1.1s infinite ease-in-out}
.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
.empty{margin:auto;text-align:center;color:var(--fg-dim);padding:24px;display:flex;flex-direction:column;align-items:center;gap:10px;white-space:normal}
.empty .logo{width:56px;height:56px;border-radius:16px;font-size:28px;filter:drop-shadow(0 0 14px color-mix(in srgb,var(--brand) 40%,transparent))}
.empty b{color:var(--strong);font-size:17px}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes dot{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:none}}

/* Composer (like .chat-input) */
footer{padding:0 10px;padding-bottom:max(10px,env(safe-area-inset-bottom));background:var(--bg)}
.composer{padding:8px 8px 6px;border-radius:10px;background:var(--bg);border:1px solid var(--border);transition:border-color .13s,box-shadow .13s}
.composer:focus-within{border-color:var(--focus);box-shadow:var(--ring)}
textarea{display:block;width:100%;resize:none;max-height:35vh;min-height:24px;border:0;outline:0;background:none;padding:2px 4px;line-height:1.45}
.bar{display:flex;align-items:center;gap:6px;margin-top:6px}
.pill{display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:transparent;color:var(--fg-dim);font-size:12.5px}
.pill.on{background:var(--bg-4);color:var(--strong)}
.pill.on svg{color:var(--brand)}
.pill svg{width:15px;height:15px}
.send{margin-left:auto;width:40px;height:34px;padding:0;display:grid;place-items:center;border-radius:8px}
.send svg{width:18px;height:18px}
.stopb{margin-left:auto;display:flex;align-items:center;gap:6px;padding:6px 12px}
.stopb svg{width:14px;height:14px}

/* Pairing */
#pair{margin:auto;padding:28px 24px;display:flex;flex-direction:column;align-items:center;gap:12px;width:min(380px,100%);text-align:center}
#pair .logo{width:60px;height:60px;border-radius:16px;font-size:30px;margin-bottom:6px}
#pair h1{margin:0;font-size:20px;color:var(--strong)}
#pair p{margin:0;color:var(--fg-dim);font-size:14px}
#pin{width:100%;font-size:28px;letter-spacing:12px;text-indent:12px;text-align:center;font-weight:600;background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:12px;outline:0;margin-top:8px}
#pin:focus{border-color:var(--focus);box-shadow:var(--ring)}
#go{width:100%;padding:12px;font-size:15px}
</style>
</head>
<body>
<header id="head" class="hide">
  <button class="icon" id="menu" aria-label="Chats"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
  <button id="title"><b id="tname">Zinarix</b><small><span class="dot" id="dot"></span><span id="state">Conectando…</span></small></button>
  <button class="icon" id="new" aria-label="Nuevo chat"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
</header>
<div id="scrim"></div>
<nav id="drawer" aria-label="Chats">
  <div class="dhead"><span class="logo">Z</span><b>Zinarix Studio</b></div>
  <button class="newbtn primary" id="new2"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Nuevo chat</button>
  <div class="dtitle">Chats</div>
  <div id="list"></div>
</nav>
<div id="pair">
  <span class="logo">Z</span>
  <h1>Conecta tu celular</h1>
  <p>Escribe el PIN que aparece en Zinarix Studio<br><small>Configuración → Celular</small></p>
  <input id="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="······">
  <button id="go" class="primary">Conectar</button>
  <p id="pwait" class="hide">Si el PIN es correcto, acepta la conexión en la ventana de Zinarix de la computadora…</p>
  <div class="err" id="perr"></div>
</div>
<div id="log" class="hide"></div>
<footer id="foot" class="hide">
  <div class="composer">
    <textarea id="text" rows="1" placeholder="Pregunta o pide un cambio…"></textarea>
    <div class="bar">
      <button class="pill" id="agent" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/></svg>Agente</button>
      <button class="danger stopb hide" id="stop"><svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>Detener</button>
      <button class="primary send" id="send" aria-label="Enviar" disabled><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
    </div>
  </div>
</footer>
<script nonce="${nonce}">
const $ = (id) => document.getElementById(id);
let token = localStorage.getItem('zx.token') || '';
let snap = null, es = null, stick = true, online = false;
const PANELS = ['head', 'log', 'foot'];
const ICONS = {
  running: '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
  ok: '<path d="M20 6 9 17l-5-5"/>',
  error: '<path d="M18 6 6 18M6 6l12 12"/>',
  approval: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.3-.6-.6-2.3Z"/>',
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
/** A fixed icon from ICONS (never text from the computer). */
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = ICONS[name] || '';
  return s;
}
/** Text with \`\`\`code blocks\`\`\` and \`inline code\`, built with textContent only. */
function rich(text) {
  const f = document.createDocumentFragment();
  text.split(/\`\`\`[^\\n]*\\n?/).forEach((part, i) => {
    if (i % 2) return void f.append(el('pre', '', part.replace(/\\n$/, '')));
    part.split(/(\`[^\`\\n]+\`)/).forEach((p, j) => f.append(j % 2 ? el('code', '', p.slice(1, -1)) : p));
  });
  return f;
}
async function post(path, data) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(data),
  });
  if (r.status === 401) unpair();
  return r;
}
const act = (a) => post('/api/action', a);

function setOnline(on) {
  online = on;
  $('dot').classList.toggle('on', on);
  status();
}
function status() {
  $('state').textContent = !online ? 'Sin conexión' : snap && snap.busy ? 'Trabajando…' : 'Conectado';
}
function drawer(open) { document.body.classList.toggle('open', open); }

function unpair() {
  token = '';
  localStorage.removeItem('zx.token');
  if (es) es.close();
  es = null;
  for (const id of PANELS) $(id).classList.add('hide');
  $('pair').classList.remove('hide');
  drawer(false);
  setOnline(false);
}
function paired() {
  $('pair').classList.add('hide');
  for (const id of PANELS) $(id).classList.remove('hide');
  connect();
}
// Through the internet (the https tunnel) live events are held back on the way: long polling.
let polling = 0;
async function poll(gen) {
  let v = -1;
  while (gen === polling && token) {
    try {
      const r = await fetch('/api/poll?v=' + v, { headers: { Authorization: 'Bearer ' + token } });
      if (gen !== polling) return;
      if (r.status === 401) return unpair();
      if (!r.ok) throw new Error();
      setOnline(true);
      if (r.status === 200) { const d = await r.json(); v = d.v; snap = d.snapshot; render(); }
    } catch {
      setOnline(false);
      await new Promise((ok) => setTimeout(ok, 3000));
    }
  }
}
function connect() {
  if (location.protocol === 'https:') return void poll(++polling);
  if (es) es.close();
  es = new EventSource('/api/events?token=' + encodeURIComponent(token));
  es.onopen = () => setOnline(true);
  es.onmessage = (m) => { snap = JSON.parse(m.data); render(); };
  es.onerror = () => {
    setOnline(false);
    // A 401 closes the stream for good: check whether the pairing is still valid.
    if (es.readyState === 2)
      fetch('/api/events?token=' + encodeURIComponent(token)).then((r) => {
        if (r.body) r.body.cancel();
        if (r.status === 401) unpair(); else setTimeout(connect, 2000);
      }).catch(() => setTimeout(connect, 3000));
  };
}

function renderList() {
  const list = $('list');
  list.textContent = '';
  for (const c of snap.chats) {
    const b = el('button', 'item' + (c.id === snap.chatId ? ' cur' : ''));
    b.append(el('span', '', c.title || 'Chat nuevo'));
    if (c.waiting) b.append(el('span', 'badge wait', 'Aprobar'));
    else if (c.busy) b.append(el('span', 'badge', 'Trabajando'));
    b.onclick = () => { drawer(false); if (c.id !== snap.chatId) act({ kind: 'select', chatId: c.id }); };
    list.append(b);
  }
}
function renderTool(tool) {
  const c = el('div', 'tool ' + tool.status);
  const head = el('div', 'thead');
  const ic = el('span', 'ticon');
  ic.append(icon('tool'));
  const st = el('span', 'tstat');
  st.append(icon(tool.status));
  head.append(ic, el('span', 'tname', tool.title), st);
  c.append(head);
  if (tool.status === 'approval') {
    const row = el('div', 'tactions');
    const yes = el('button', 'primary', 'Aprobar');
    const no = el('button', 'danger', 'Rechazar');
    yes.onclick = () => { yes.disabled = no.disabled = true; act({ kind: 'decide', toolCallId: tool.id, decision: 'approve' }); };
    no.onclick = () => { yes.disabled = no.disabled = true; act({ kind: 'decide', toolCallId: tool.id, decision: 'deny' }); };
    row.append(yes, no);
    c.append(row);
  }
  return c;
}
function render() {
  if (!snap) return;
  renderList();
  const cur = snap.chats.find((c) => c.id === snap.chatId);
  $('tname').textContent = (cur && cur.title) || 'Chat nuevo';
  $('agent').classList.toggle('on', !!snap.agent);
  $('agent').setAttribute('aria-pressed', String(!!snap.agent));
  status();
  $('stop').classList.toggle('hide', !snap.busy);
  $('send').classList.toggle('hide', snap.busy);
  const log = $('log');
  stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  log.textContent = '';
  if (!snap.turns.length) {
    const e = el('div', 'empty');
    e.append(el('span', 'logo', 'Z'), el('b', '', '¿En qué te ayudo?'), el('span', '', 'Escribe abajo para hablar con la IA de tu computadora.'));
    log.append(e);
  }
  for (const t of snap.turns) {
    let m;
    if (t.role === 'user') {
      m = el('div', 'turn user');
      m.append(t.text);
    } else {
      m = el('div', 'turn assistant');
      const h = el('div', 'model');
      h.append(el('span', 'logo', 'Z'), 'Zinarix');
      m.append(h, rich(t.text));
    }
    if (t.error) m.append(el('div', 'err', t.error));
    for (const tool of t.tools) m.append(renderTool(tool));
    log.append(m);
  }
  if (snap.busy) { const d = el('div', 'typing'); d.append(el('i'), el('i'), el('i')); log.append(d); }
  if (stick) log.scrollTop = log.scrollHeight;
}

function send() {
  const text = $('text').value.trim();
  if (!text) return;
  $('text').value = '';
  grow();
  stick = true;
  act({ kind: 'send', text });
}
function grow() {
  const t = $('text');
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 'px';
  $('send').disabled = !t.value.trim();
}

$('go').onclick = async () => {
  if ($('go').disabled) return;
  $('perr').textContent = '';
  // The answer waits until the user accepts (or rejects) the device on the computer.
  $('go').disabled = true;
  $('pwait').classList.remove('hide');
  try {
    const key = new URLSearchParams(location.hash.slice(1)).get('k') || undefined;
    const r = await post('/api/pair', { pin: $('pin').value, key });
    if (!r.ok) { $('perr').textContent = (await r.json().catch(() => ({}))).error || 'PIN incorrecto'; return; }
    token = (await r.json()).token;
    localStorage.setItem('zx.token', token);
    paired();
  } catch { $('perr').textContent = 'No se pudo conectar con la computadora'; }
  finally { $('go').disabled = false; $('pwait').classList.add('hide'); }
};
$('pin').onkeydown = (e) => { if (e.key === 'Enter') $('go').click(); };
$('pin').oninput = (e) => { e.target.value = e.target.value.replace(/\\D/g, ''); if (e.target.value.length === 6) $('go').click(); };
$('menu').onclick = $('title').onclick = () => drawer(true);
$('scrim').onclick = () => drawer(false);
$('new').onclick = $('new2').onclick = () => { drawer(false); act({ kind: 'newChat' }); };
$('agent').onclick = () => act({ kind: 'agent', on: !(snap && snap.agent) });
$('stop').onclick = () => act({ kind: 'stop' });
$('send').onclick = send;
$('text').oninput = grow;
if (token) paired();
</script>
</body>
</html>`;
}
