// The owner's panel (/admin): keys, messages for every app and registered users. It talks to
// /api/admin with the admin secret, kept only in this tab (sessionStorage) until it closes.
(() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'zx-admin';
  let token = sessionStorage.getItem(KEY) || '';

  async function call(action, body = {}) {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) node.append(c);
    return node;
  };
  const date = (ms) => (ms ? new Date(ms).toLocaleDateString() : '—');
  const PLAN = { pro: 'Pro', ai: 'AI', proai: 'Pro + AI' };

  function showError(e) {
    if (e && e.status === 401) return signOut(e.message);
    $('error').textContent = e ? e.message : '';
  }
  /** Runs an action, shows its error, and tells whether it worked. */
  async function attempt(fn) {
    showError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      showError(e);
      return false;
    }
  }
  async function copy(text, button) {
    await navigator.clipboard.writeText(text);
    const old = button.textContent;
    button.textContent = 'Copiada';
    setTimeout(() => (button.textContent = old), 1200);
  }

  // ---------------- sign in ----------------

  function signOut(message = '') {
    token = '';
    sessionStorage.removeItem(KEY);
    $('panel').hidden = true;
    $('signout').hidden = true;
    $('login').hidden = false;
    $('login-error').textContent = message;
  }
  async function enter() {
    await loadStats();
    sessionStorage.setItem(KEY, token);
    $('login').hidden = true;
    $('panel').hidden = false;
    $('signout').hidden = false;
    $('token').value = '';
    await Promise.all([loadKeys(), loadMessages(), loadUsers()]);
  }
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    token = $('token').value.trim();
    $('login-error').textContent = '';
    try {
      await enter();
    } catch (err) {
      token = '';
      $('login-error').textContent = err.message;
    }
  });
  $('signout').addEventListener('click', () => signOut());

  // ---------------- tabs ----------------

  for (const tab of document.querySelectorAll('.tabs button'))
    tab.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.tabs button')) {
        const on = other === tab;
        other.setAttribute('aria-selected', String(on));
        $(`tab-${other.dataset.tab}`).hidden = !on;
      }
    });

  async function loadStats() {
    const s = await call('overview');
    const stat = (n, label) => el('div', { class: 'stat' }, el('b', {}, String(n)), label);
    $('stats').replaceChildren(
      stat(s.users, 'usuarios'),
      stat(s.keys, 'llaves'),
      stat(s.revoked, 'llaves canceladas'),
      stat(s.messages, 'mensajes activos'),
    );
  }

  // ---------------- keys ----------------

  function keyRow(k) {
    const copyBtn = el('button', { class: 'link', onclick: () => copy(k.key, copyBtn) }, 'Copiar');
    const toggle = el(
      'button',
      {
        class: `link${k.revoked ? '' : ' danger'}`,
        onclick: () => {
          if (!k.revoked && !confirm('¿Cancelar esta llave? Dejará de funcionar en la app.'))
            return;
          void attempt(async () => {
            await call('setKey', { id: k.id, revoked: !k.revoked });
            await Promise.all([loadKeys(), loadStats()]);
          });
        },
      },
      k.revoked ? 'Reactivar' : 'Cancelar',
    );
    const who = [k.email, k.name, k.note].filter(Boolean).join(' · ');
    return el(
      'tr',
      { class: k.revoked ? 'off' : '' },
      el('td', {}, PLAN[k.plan] || k.plan),
      el('td', { class: 'wrap' }, who),
      el('td', {}, date(k.createdAt)),
      el('td', {}, k.expiresAt ? date(k.expiresAt) : 'nunca'),
      el('td', {}, k.revoked ? 'cancelada' : k.userId ? 'en una cuenta' : 'sin usar'),
      el('td', {}, copyBtn, ' ', toggle),
    );
  }
  async function loadKeys() {
    const { keys } = await call('keys', { q: $('key-search').value });
    $('keys').replaceChildren(
      ...(keys.length
        ? keys.map(keyRow)
        : [el('tr', {}, el('td', { colspan: '6', class: 'dim' }, 'Todavía no hay llaves.'))]),
    );
  }
  $('key-form').addEventListener('submit', (e) => {
    e.preventDefault();
    void attempt(async () => {
      const r = await call('createKeys', {
        plan: $('key-plan').value,
        email: $('key-email').value.trim() || undefined,
        name: $('key-name').value,
        days: Number($('key-days').value),
        count: Number($('key-count').value),
        note: $('key-note').value,
      });
      const all = r.keys.map((k) => k.key).join('\n');
      const copyAll = el('button', { class: 'link', onclick: () => copy(all, copyAll) }, 'Copiar');
      $('new-keys').replaceChildren(
        el(
          'div',
          { class: 'box' },
          el(
            'strong',
            {},
            r.keys.length === 1 ? 'Llave lista' : `${r.keys.length} llaves listas`,
            r.linked ? ' (ya está en la cuenta de ese correo)' : '',
          ),
          ' ',
          copyAll,
          ...r.keys.map((k) => el('code', {}, k.key)),
        ),
      );
      await Promise.all([loadKeys(), loadStats()]);
    });
  });

  // ---------------- messages ----------------

  async function loadMessages() {
    const { messages } = await call('messages');
    $('messages').replaceChildren(
      ...(messages.length
        ? messages.map((m) => {
            const gone = m.expiresAt && m.expiresAt < Date.now();
            const state = gone
              ? 'ya no se muestra'
              : m.expiresAt
                ? `se muestra hasta el ${date(m.expiresAt)}`
                : 'se muestra siempre';
            return el(
              'div',
              { class: 'box msg' },
              el(
                'div',
                {},
                m.text,
                el(
                  'div',
                  { class: 'dim small' },
                  `${date(m.at)} · ${state}`,
                  m.url ? ` · ${m.url}` : '',
                ),
              ),
              el(
                'button',
                {
                  class: 'link danger',
                  onclick: () =>
                    confirm('¿Borrar este mensaje?') &&
                    void attempt(async () => {
                      await call('deleteMessage', { id: m.id });
                      await Promise.all([loadMessages(), loadStats()]);
                    }),
                },
                'Borrar',
              ),
            );
          })
        : [el('p', { class: 'dim' }, 'Todavía no has enviado mensajes.')]),
    );
  }
  $('msg-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!confirm('Este mensaje saldrá en todas las apps instaladas. ¿Enviarlo?')) return;
    void attempt(async () => {
      await call('sendMessage', {
        text: $('msg-text').value,
        url: $('msg-url').value.trim() || undefined,
        days: Number($('msg-days').value),
      });
      $('msg-text').value = '';
      $('msg-url').value = '';
      await Promise.all([loadMessages(), loadStats()]);
    });
  });

  // ---------------- users ----------------

  async function loadUsers() {
    const { users } = await call('users', { q: $('user-search').value });
    $('users').replaceChildren(
      ...(users.length
        ? users.map((u) =>
            el(
              'tr',
              { class: u.disabled ? 'off' : '' },
              el('td', {}, u.email),
              el('td', {}, u.name || '—'),
              el('td', {}, date(u.createdAt)),
              el('td', {}, date(u.lastSeenAt)),
              el(
                'td',
                {},
                el(
                  'button',
                  {
                    class: 'link',
                    onclick: () =>
                      confirm(`¿Cambiar la contraseña de ${u.email} por una temporal?`) &&
                      void attempt(async () => {
                        const r = await call('resetPassword', { id: u.id });
                        prompt(`Contraseña temporal de ${r.email} (pásasela tú):`, r.password);
                      }),
                  },
                  'Nueva contraseña',
                ),
                ' ',
                el(
                  'button',
                  {
                    class: `link${u.disabled ? '' : ' danger'}`,
                    onclick: () =>
                      void attempt(async () => {
                        await call('setUser', { id: u.id, disabled: !u.disabled });
                        await loadUsers();
                      }),
                  },
                  u.disabled ? 'Activar' : 'Desactivar',
                ),
              ),
            ),
          )
        : [el('tr', {}, el('td', { colspan: '5', class: 'dim' }, 'Todavía no hay usuarios.'))]),
    );
  }

  let timer;
  const debounced = (fn) => () => {
    clearTimeout(timer);
    timer = setTimeout(() => void attempt(fn), 250);
  };
  $('key-search').addEventListener('input', debounced(loadKeys));
  $('user-search').addEventListener('input', debounced(loadUsers));

  if (token) enter().catch((e) => signOut(e.status === 401 ? '' : e.message));
})();
