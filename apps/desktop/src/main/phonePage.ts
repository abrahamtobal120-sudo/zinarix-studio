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
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#16161a">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Zinarix Studio</title>
<style nonce="${nonce}">
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#16161a;color:#e6e6ea;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
body{display:flex;flex-direction:column;height:100dvh}
header{display:flex;align-items:center;gap:8px;padding:10px 12px;padding-top:max(10px,env(safe-area-inset-top));background:#1f1f25;border-bottom:1px solid #2c2c35}
header b{font-size:16px}
.dot{width:9px;height:9px;border-radius:50%;background:#777}
.dot.on{background:#3ecf8e}
.sp{flex:1}
select,button,textarea,input{font:inherit;color:inherit}
select{max-width:46vw;background:#2a2a33;border:1px solid #393945;border-radius:8px;padding:6px}
button{background:#2a2a33;border:1px solid #393945;border-radius:8px;padding:8px 12px}
button.primary{background:#6d5dfc;border-color:#6d5dfc;color:#fff}
button.danger{background:#d9485f;border-color:#d9485f;color:#fff}
button:disabled{opacity:.5}
#log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.msg{padding:9px 12px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word;max-width:92%}
.user{align-self:flex-end;background:#3b3570}
.assistant{align-self:flex-start;background:#24242c}
.err{color:#ff8a9a}
.tool{margin-top:6px;padding:6px 8px;border-radius:8px;background:#1b1b21;font-size:13px;color:#b8b8c4}
.tool.approval{border:1px solid #e8a33d;color:#f2c879}
.tool .row{display:flex;gap:8px;margin-top:6px}
.tool .row button{flex:1}
.empty{margin:auto;text-align:center;color:#8a8a96}
footer{display:flex;gap:8px;padding:8px;padding-bottom:max(8px,env(safe-area-inset-bottom));background:#1f1f25;border-top:1px solid #2c2c35;align-items:flex-end}
textarea{flex:1;resize:none;max-height:40vh;min-height:42px;background:#2a2a33;border:1px solid #393945;border-radius:10px;padding:10px}
.bar{display:flex;gap:8px;align-items:center;padding:6px 12px;font-size:13px;color:#a0a0ac;background:#1b1b21}
.bar label{display:flex;gap:6px;align-items:center}
#pair{margin:auto;padding:24px;display:flex;flex-direction:column;gap:12px;width:min(360px,100%);text-align:center}
#pair input{font-size:28px;letter-spacing:8px;text-align:center;background:#2a2a33;border:1px solid #393945;border-radius:10px;padding:10px}
.hide{display:none!important}
</style>
</head>
<body>
<header><span class="dot" id="dot"></span><b>Zinarix</b><span class="sp"></span>
<select id="chats" class="hide" aria-label="Chat"></select>
<button id="new" class="hide" aria-label="Nuevo chat">＋</button></header>
<div id="pair">
  <p>Escribe el PIN que aparece en Zinarix Studio<br><small>(Configuración → Celular)</small></p>
  <input id="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000">
  <button class="primary" id="go">Conectar</button>
  <div class="err" id="perr"></div>
</div>
<div class="bar hide" id="bar"><label><input type="checkbox" id="agent"> Modo agente</label><span class="sp"></span><span id="state"></span></div>
<div id="log" class="hide"></div>
<footer id="foot" class="hide">
  <textarea id="text" rows="1" placeholder="Escribe un mensaje…"></textarea>
  <button class="danger hide" id="stop">Detener</button>
  <button class="primary" id="send">Enviar</button>
</footer>
<script nonce="${nonce}">
const $ = (id) => document.getElementById(id);
let token = localStorage.getItem('zx.token') || '';
let snap = null, es = null, stick = true;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
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

function unpair() {
  token = '';
  localStorage.removeItem('zx.token');
  if (es) es.close();
  es = null;
  for (const id of ['chats', 'new', 'bar', 'log', 'foot']) $(id).classList.add('hide');
  $('pair').classList.remove('hide');
  $('dot').classList.remove('on');
}
function paired() {
  $('pair').classList.add('hide');
  for (const id of ['chats', 'new', 'bar', 'log', 'foot']) $(id).classList.remove('hide');
  connect();
}
function connect() {
  if (es) es.close();
  es = new EventSource('/api/events?token=' + encodeURIComponent(token));
  es.onopen = () => $('dot').classList.add('on');
  es.onmessage = (m) => { snap = JSON.parse(m.data); render(); };
  es.onerror = () => {
    $('dot').classList.remove('on');
    // A 401 closes the stream for good: check whether the pairing is still valid.
    if (es.readyState === 2)
      fetch('/api/events?token=' + encodeURIComponent(token)).then((r) => {
        if (r.body) r.body.cancel();
        if (r.status === 401) unpair(); else setTimeout(connect, 2000);
      }).catch(() => setTimeout(connect, 3000));
  };
}

function render() {
  if (!snap) return;
  const sel = $('chats');
  sel.textContent = '';
  for (const c of snap.chats) {
    const o = el('option', '', (c.waiting ? '⏸ ' : c.busy ? '⏳ ' : '') + (c.title || 'Chat nuevo'));
    o.value = c.id;
    if (c.id === snap.chatId) o.selected = true;
    sel.append(o);
  }
  $('agent').checked = snap.agent;
  $('state').textContent = snap.busy ? 'Trabajando…' : '';
  $('stop').classList.toggle('hide', !snap.busy);
  const log = $('log');
  stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  log.textContent = '';
  if (!snap.turns.length) log.append(el('div', 'empty', 'Escribe abajo para hablar con la IA de tu computadora.'));
  for (const t of snap.turns) {
    const m = el('div', 'msg ' + t.role, t.text);
    if (t.error) m.append(el('div', 'err', t.error));
    for (const tool of t.tools) {
      const icon = { running: '⏳', approval: '⏸', ok: '✓', error: '✗' }[tool.status];
      const c = el('div', 'tool ' + tool.status, icon + ' ' + tool.title);
      if (tool.status === 'approval') {
        const row = el('div', 'row');
        const yes = el('button', 'primary', 'Aprobar');
        const no = el('button', '', 'Rechazar');
        yes.onclick = () => { yes.disabled = no.disabled = true; act({ kind: 'decide', toolCallId: tool.id, decision: 'approve' }); };
        no.onclick = () => { yes.disabled = no.disabled = true; act({ kind: 'decide', toolCallId: tool.id, decision: 'deny' }); };
        row.append(yes, no);
        c.append(row);
      }
      m.append(c);
    }
    log.append(m);
  }
  if (stick) log.scrollTop = log.scrollHeight;
}

$('go').onclick = async () => {
  $('perr').textContent = '';
  try {
    const r = await post('/api/pair', { pin: $('pin').value });
    if (!r.ok) { $('perr').textContent = 'PIN incorrecto'; return; }
    token = (await r.json()).token;
    localStorage.setItem('zx.token', token);
    paired();
  } catch { $('perr').textContent = 'No se pudo conectar con la computadora'; }
};
$('pin').onkeydown = (e) => { if (e.key === 'Enter') $('go').click(); };
$('chats').onchange = (e) => act({ kind: 'select', chatId: e.target.value });
$('new').onclick = () => act({ kind: 'newChat' });
$('agent').onchange = (e) => act({ kind: 'agent', on: e.target.checked });
$('stop').onclick = () => act({ kind: 'stop' });
$('send').onclick = () => {
  const text = $('text').value.trim();
  if (!text) return;
  $('text').value = '';
  act({ kind: 'send', text });
};
$('text').oninput = (e) => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; };
if (token) paired();
</script>
</body>
</html>`;
}
