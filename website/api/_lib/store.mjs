// Where accounts, keys and messages are kept. Two stores with the same methods:
//   supabaseStore(env)  the real one: a Supabase project through its REST API (PostgREST),
//                       with the service_role key. Tables: scripts/account-schema.sql.
//   memoryStore()       tests and the local dev server (scripts/dev-account-server.mjs).
// Times are milliseconds since 1970 (bigint columns), like the license keys.

const enc = encodeURIComponent;

export function supabaseStore(env, fetchFn = fetch) {
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(env.SUPABASE_SERVICE_KEY || '');
  const ready = /^https:\/\/[\w.-]+$/.test(base) && key.length > 20;

  async function rest(method, path, body, prefer) {
    const res = await fetchFn(`${base}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Supabase ${method} ${path.split('?')[0]}: HTTP ${res.status} ${text.slice(0, 300)}`,
      );
    }
    if (method === 'HEAD')
      return Number((res.headers.get('content-range') || '').split('/')[1]) || 0;
    if (res.status === 204) return [];
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  }
  const one = async (path) => (await rest('GET', `${path}&limit=1`))[0] ?? null;
  const count = (path) => rest('HEAD', path, undefined, 'count=exact');
  /** PostgREST pattern value: * is the wildcard; the characters with a meaning are dropped. */
  const like = (q) => enc(`*${q.replace(/[*,()%\\]/g, '')}*`);

  return {
    ready,
    userByEmail: (email) => one(`zx_users?email=eq.${enc(email)}`),
    userById: (id) => one(`zx_users?id=eq.${enc(id)}`),
    insertUser: (u) => rest('POST', 'zx_users', u, 'return=minimal'),
    updateUser: (id, patch) => rest('PATCH', `zx_users?id=eq.${enc(id)}`, patch, 'return=minimal'),
    listUsers: ({ q, limit }) =>
      rest(
        'GET',
        `zx_users?select=id,email,name,created_at,last_seen_at,disabled&order=created_at.desc&limit=${limit}` +
          (q ? `&or=(email.ilike.${like(q)},name.ilike.${like(q)})` : ''),
      ),

    insertSession: (s) => rest('POST', 'zx_sessions', s, 'return=minimal'),
    sessionByHash: (h) => one(`zx_sessions?token_hash=eq.${enc(h)}`),
    deleteSession: (h) => rest('DELETE', `zx_sessions?token_hash=eq.${enc(h)}`),
    deleteSessionsOfUser: (id) => rest('DELETE', `zx_sessions?user_id=eq.${enc(id)}`),

    insertLicenses: (rows) => rest('POST', 'zx_licenses', rows, 'return=minimal'),
    licenseById: (id) => one(`zx_licenses?id=eq.${enc(id)}`),
    updateLicense: (id, patch) =>
      rest('PATCH', `zx_licenses?id=eq.${enc(id)}`, patch, 'return=minimal'),
    licensesOfUser: (id) => rest('GET', `zx_licenses?user_id=eq.${enc(id)}&order=created_at.desc`),
    listLicenses: ({ q, limit }) =>
      rest(
        'GET',
        `zx_licenses?order=created_at.desc&limit=${limit}` +
          (q ? `&or=(email.ilike.${like(q)},name.ilike.${like(q)},note.ilike.${like(q)})` : ''),
      ),
    revokedIds: async () =>
      (await rest('GET', 'zx_licenses?select=id&revoked=is.true&limit=20000')).map((r) => r.id),

    insertMessage: (m) => rest('POST', 'zx_messages', m, 'return=minimal'),
    listMessages: ({ limit, activeAt }) =>
      rest(
        'GET',
        `zx_messages?order=created_at.desc&limit=${limit}` +
          (activeAt ? `&or=(expires_at.is.null,expires_at.gt.${activeAt})` : ''),
      ),
    deleteMessage: (id) => rest('DELETE', `zx_messages?id=eq.${enc(id)}`),

    counts: async (now) => ({
      users: await count('zx_users?select=id'),
      keys: await count('zx_licenses?select=id'),
      revoked: await count('zx_licenses?select=id&revoked=is.true'),
      messages: await count(`zx_messages?select=id&or=(expires_at.is.null,expires_at.gt.${now})`),
    }),
  };
}

export function memoryStore() {
  const users = [];
  const sessions = [];
  const licenses = [];
  const messages = [];
  const copy = (v) => (v ? structuredClone(v) : null);
  const has = (q, ...fields) =>
    !q ||
    fields.some((f) =>
      String(f ?? '')
        .toLowerCase()
        .includes(q),
    );
  const newest = (list) => [...list].sort((a, b) => b.created_at - a.created_at);
  const drop = (list, keep) => {
    for (let i = list.length - 1; i >= 0; i--) if (!keep(list[i])) list.splice(i, 1);
  };
  return {
    ready: true,
    userByEmail: async (email) => copy(users.find((u) => u.email === email)),
    userById: async (id) => copy(users.find((u) => u.id === id)),
    insertUser: async (u) => {
      if (users.some((x) => x.email === u.email)) throw new Error('duplicate email');
      users.push(copy(u));
    },
    updateUser: async (id, patch) =>
      void Object.assign(users.find((u) => u.id === id) ?? {}, patch),
    listUsers: async ({ q, limit }) =>
      newest(users)
        .filter((u) => has(q, u.email, u.name))
        .slice(0, limit)
        .map(copy),

    insertSession: async (s) => void sessions.push(copy(s)),
    sessionByHash: async (h) => copy(sessions.find((s) => s.token_hash === h)),
    deleteSession: async (h) => drop(sessions, (s) => s.token_hash !== h),
    deleteSessionsOfUser: async (id) => drop(sessions, (s) => s.user_id !== id),

    insertLicenses: async (rows) => void licenses.push(...rows.map(copy)),
    licenseById: async (id) => copy(licenses.find((l) => l.id === id)),
    updateLicense: async (id, patch) =>
      void Object.assign(licenses.find((l) => l.id === id) ?? {}, patch),
    licensesOfUser: async (id) => newest(licenses.filter((l) => l.user_id === id)).map(copy),
    listLicenses: async ({ q, limit }) =>
      newest(licenses)
        .filter((l) => has(q, l.email, l.name, l.note))
        .slice(0, limit)
        .map(copy),
    revokedIds: async () => licenses.filter((l) => l.revoked).map((l) => l.id),

    insertMessage: async (m) => void messages.push(copy(m)),
    listMessages: async ({ limit, activeAt }) =>
      newest(messages)
        .filter((m) => !activeAt || !m.expires_at || m.expires_at > activeAt)
        .slice(0, limit)
        .map(copy),
    deleteMessage: async (id) => drop(messages, (m) => m.id !== id),

    counts: async (now) => ({
      users: users.length,
      keys: licenses.length,
      revoked: licenses.filter((l) => l.revoked).length,
      messages: messages.filter((m) => !m.expires_at || m.expires_at > now).length,
    }),
  };
}
