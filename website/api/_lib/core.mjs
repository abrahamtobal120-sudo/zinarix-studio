// Zinarix Studio accounts, license keys and messages: the logic behind /api/account,
// /api/admin and /api/feed. No dependencies (node:crypto only); the data lives behind a
// "store" (store.mjs: Supabase in production, memory in tests and the local dev server).
//
// Environment variables (Vercel → Settings → Environment Variables):
//   SUPABASE_URL          https://<ref>.supabase.co
//   SUPABASE_SERVICE_KEY  the service_role key (never the anon key; tables have RLS on and
//                         no policies, so only this key can read or write them)
//   ADMIN_TOKEN           the owner's secret for /admin (24+ characters, random)
//   LICENSE_PRIVATE_KEY   the Ed25519 private key (PEM) whose public half is inside the app:
//                         signs the keys made in /admin and the feed the apps read
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  randomUUID,
  scrypt,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto';

const DAY = 86_400_000;
export const SESSION_DAYS = 90;
export const PLANS = ['pro', 'ai', 'proai'];
/** What the feed signature covers (the app checks the same prefix). */
export const FEED_DOMAIN = 'zinarix-feed:v1:';
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60_000;

const b64url = (b) => Buffer.from(b).toString('base64url');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};

// ---------------- passwords ----------------

const SCRYPT = { N: 32768, r: 8, p: 1 };

function scryptAsync(password, salt, params) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { ...params, maxmem: 128 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** `scrypt$N$r$p$salt$hash`: the parameters travel with the hash, so they can be raised later. */
export async function hashPassword(password, params = SCRYPT) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${b64url(salt)}$${b64url(key)}`;
}

export async function checkPassword(password, stored) {
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([\w-]+)\$([\w-]+)$/.exec(String(stored));
  if (!m) return false;
  const want = Buffer.from(m[5], 'base64url');
  const got = await scryptAsync(password.normalize('NFKC'), Buffer.from(m[4], 'base64url'), {
    N: Number(m[1]),
    r: Number(m[2]),
    p: Number(m[3]),
  });
  return got.length === want.length && timingSafeEqual(got, want);
}

// ---------------- keys and signatures ----------------

export function privateKeyOf(env) {
  const pem = String(env.LICENSE_PRIVATE_KEY || '')
    .replace(/\\n/g, '\n')
    .trim();
  if (!pem.includes('PRIVATE KEY')) return null;
  try {
    return createPrivateKey(pem);
  } catch {
    return null;
  }
}

/** Same format as the app (license.ts) and /api/license: ZX1.<payload>.<signature>. */
export function makeLicense(payload, key) {
  const body = `ZX1.${b64url(JSON.stringify(payload))}`;
  return `${body}.${b64url(sign(null, Buffer.from(body), key))}`;
}

/** The payload of a key signed by `key`'s pair, or null. */
export function readLicense(input, key) {
  const m = /^ZX1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(
    String(input).replace(/[\s"'`]+/g, ''),
  );
  if (!m) return null;
  try {
    const ok = verify(
      null,
      Buffer.from(`ZX1.${m[1]}`),
      createPublicKey(key),
      Buffer.from(m[2], 'base64url'),
    );
    if (!ok) return null;
    const p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
    return p && typeof p.id === 'string' ? p : null;
  } catch {
    return null;
  }
}

function sameSecret(a, b) {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}

// ---------------- validation ----------------

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function cleanEmail(v) {
  const email = str(v, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail(400, 'Escribe un correo válido.');
  return email;
}

function cleanPassword(v) {
  if (typeof v !== 'string' || v.length < 8)
    fail(400, 'La contraseña debe tener al menos 8 caracteres.');
  if (v.length > 200) fail(400, 'La contraseña es demasiado larga.');
  return v;
}

function cleanUrl(v) {
  const url = str(v, 500);
  if (!url) return null;
  if (!/^https:\/\/[^\s]+$/.test(url)) fail(400, 'El enlace debe empezar con https://');
  return url;
}

// ---------------- rate limit (per IP and per function instance) ----------------

export function makeLimiter(max, windowMs) {
  const hits = new Map();
  return (id, now) => {
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
    const h = hits.get(id);
    if (!h || now - h.start > windowMs) {
      hits.set(id, { start: now, n: 1 });
      return false;
    }
    h.n += 1;
    return h.n > max;
  };
}

// ---------------- the service ----------------

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name || '',
  createdAt: u.created_at,
});
const publicLicense = (l) => ({
  id: l.id,
  key: l.key,
  plan: l.plan,
  name: l.name || '',
  createdAt: l.created_at,
  expiresAt: l.expires_at ?? null,
});
const adminLicense = (l) => ({
  ...publicLicense(l),
  email: l.email,
  note: l.note || '',
  revoked: !!l.revoked,
  userId: l.user_id ?? null,
});
const publicMessage = (m) => ({
  id: m.id,
  text: m.text,
  ...(m.url ? { url: m.url } : {}),
  at: m.created_at,
});

/**
 * @param store see store.mjs
 * @param env   process.env
 * @param opts  { now, scrypt } (tests)
 */
export function makeService(store, env, opts = {}) {
  const now = opts.now ?? Date.now;
  const params = opts.scrypt ?? SCRYPT;
  const authLimited = makeLimiter(30, 10 * 60_000);
  const adminLimited = makeLimiter(20, 10 * 60_000);

  async function newSession(user, device) {
    const token = b64url(randomBytes(32));
    await store.insertSession({
      token_hash: sha256(token),
      user_id: user.id,
      device: str(device, 80) || null,
      created_at: now(),
      expires_at: now() + SESSION_DAYS * DAY,
    });
    return token;
  }

  async function userOf(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200)
      fail(401, 'Inicia sesión de nuevo.');
    const s = await store.sessionByHash(sha256(token));
    if (!s || s.expires_at < now()) fail(401, 'Tu sesión venció. Inicia sesión de nuevo.');
    const user = await store.userById(s.user_id);
    if (!user || user.disabled) fail(401, 'Esta cuenta está desactivada.');
    return user;
  }

  async function licensesOf(user) {
    const t = now();
    return (await store.licensesOfUser(user.id))
      .filter((l) => !l.revoked && (!l.expires_at || l.expires_at > t))
      .map(publicLicense);
  }

  const account = {
    async register(b) {
      const email = cleanEmail(b.email);
      const password = cleanPassword(b.password);
      const name = str(b.name, 80);
      if (await store.userByEmail(email))
        fail(409, 'Ese correo ya tiene una cuenta. Inicia sesión.');
      const user = {
        id: randomUUID(),
        email,
        name,
        pass_hash: await hashPassword(password, params),
        created_at: now(),
        last_seen_at: now(),
        disabled: false,
        failed: 0,
        locked_until: null,
      };
      await store.insertUser(user);
      return { token: await newSession(user, b.device), user: publicUser(user), licenses: [] };
    },

    async login(b) {
      const email = cleanEmail(b.email);
      const password = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
      const user = await store.userByEmail(email);
      const bad = 'El correo o la contraseña no coinciden.';
      if (!user) {
        // Same work as a real check, so the answer time does not tell whether the account exists.
        await hashPassword(password, params);
        fail(401, bad);
      }
      if (user.locked_until && user.locked_until > now())
        fail(429, 'Demasiados intentos. Espera 15 minutos y vuelve a probar.');
      if (!(await checkPassword(password, user.pass_hash))) {
        const failed = (user.failed || 0) + 1;
        await store.updateUser(user.id, {
          failed: failed >= MAX_FAILS ? 0 : failed,
          locked_until: failed >= MAX_FAILS ? now() + LOCK_MS : null,
        });
        fail(401, bad);
      }
      if (user.disabled) fail(403, 'Esta cuenta está desactivada. Escríbenos si es un error.');
      await store.updateUser(user.id, { failed: 0, locked_until: null, last_seen_at: now() });
      return {
        token: await newSession(user, b.device),
        user: publicUser(user),
        licenses: await licensesOf(user),
      };
    },

    async me(b, token) {
      const user = await userOf(token);
      if (now() - (user.last_seen_at || 0) > 3_600_000)
        await store.updateUser(user.id, { last_seen_at: now() });
      return { user: publicUser(user), licenses: await licensesOf(user) };
    },

    async logout(b, token) {
      if (typeof token === 'string' && token) await store.deleteSession(sha256(token));
      return { ok: true };
    },

    /** Links a key the user has (bought, or handed out by the owner) to their account. */
    async redeem(b, token) {
      const user = await userOf(token);
      const key = privateKeyOf(env);
      if (!key) fail(503, 'El servidor aún no está configurado.');
      const input = str(b.key, 8192).replace(/[\s"'`]+/g, '');
      const p = readLicense(input, key);
      if (!p || !PLANS.includes(p.plan)) fail(400, 'Esa clave de licencia no es válida.');
      const existing = await store.licenseById(p.id);
      if (existing) {
        if (existing.revoked) fail(403, 'Esta licencia fue cancelada.');
        if (existing.user_id && existing.user_id !== user.id)
          fail(409, 'Esta clave ya está ligada a otra cuenta.');
        if (!existing.user_id) await store.updateLicense(p.id, { user_id: user.id });
      } else {
        // Keys from a purchase or from the owner's PC: first seen here.
        await store.insertLicenses([
          {
            id: p.id,
            key: input,
            plan: p.plan,
            email: str(p.email, 200),
            name: str(p.name, 120) || null,
            note: null,
            created_at: Number(p.iat) || now(),
            expires_at: p.exp ? Number(p.exp) : null,
            revoked: false,
            user_id: user.id,
          },
        ]);
      }
      return { user: publicUser(user), licenses: await licensesOf(user) };
    },

    async password(b, token) {
      const user = await userOf(token);
      if (!(await checkPassword(String(b.current ?? ''), user.pass_hash)))
        fail(401, 'La contraseña actual no coincide.');
      const pass_hash = await hashPassword(cleanPassword(b.password), params);
      await store.updateUser(user.id, { pass_hash });
      // Every other device signs in again.
      await store.deleteSessionsOfUser(user.id);
      return { token: await newSession(user, b.device), user: publicUser(user) };
    },
  };

  const admin = {
    async overview() {
      return store.counts(now());
    },
    async users(b) {
      const rows = await store.listUsers({ q: str(b.q, 100).toLowerCase(), limit: 200 });
      return {
        users: rows.map((u) => ({
          ...publicUser(u),
          lastSeenAt: u.last_seen_at ?? null,
          disabled: !!u.disabled,
        })),
      };
    },
    async setUser(b) {
      const user = await store.userById(str(b.id, 64));
      if (!user) fail(404, 'No encontré esa cuenta.');
      const disabled = b.disabled === true;
      await store.updateUser(user.id, { disabled });
      if (disabled) await store.deleteSessionsOfUser(user.id);
      return { ok: true };
    },
    /** No email is sent from here: the owner passes the temporary password on. */
    async resetPassword(b) {
      const user = await store.userById(str(b.id, 64));
      if (!user) fail(404, 'No encontré esa cuenta.');
      const password = b64url(randomBytes(9));
      await store.updateUser(user.id, {
        pass_hash: await hashPassword(password, params),
        failed: 0,
        locked_until: null,
      });
      await store.deleteSessionsOfUser(user.id);
      return { email: user.email, password };
    },
    async keys(b) {
      const rows = await store.listLicenses({ q: str(b.q, 100).toLowerCase(), limit: 300 });
      return { keys: rows.map(adminLicense) };
    },
    async createKeys(b) {
      const key = privateKeyOf(env);
      if (!key) fail(503, 'Falta LICENSE_PRIVATE_KEY en el servidor.');
      if (!PLANS.includes(b.plan)) fail(400, 'Plan no válido.');
      const count = Math.min(100, Math.max(1, Math.floor(Number(b.count) || 1)));
      const days = Math.min(36500, Math.max(0, Math.floor(Number(b.days) || 0)));
      const email = b.email ? cleanEmail(b.email) : '';
      const name = str(b.name, 120);
      const note = str(b.note, 200);
      // With an email of a registered account, the key shows up in that person's app.
      const owner = email ? await store.userByEmail(email) : null;
      const iat = now();
      const rows = [];
      for (let i = 0; i < count; i++) {
        const payload = {
          v: 1,
          id: `srv-${randomUUID()}`,
          plan: b.plan,
          email: email || 'cliente@zinarix-studio',
        };
        if (name) payload.name = name;
        payload.iat = iat;
        if (days > 0) payload.exp = iat + days * DAY;
        rows.push({
          id: payload.id,
          key: makeLicense(payload, key),
          plan: b.plan,
          email: payload.email,
          name: name || null,
          note: note || null,
          created_at: iat,
          expires_at: payload.exp ?? null,
          revoked: false,
          user_id: owner && count === 1 ? owner.id : null,
        });
      }
      await store.insertLicenses(rows);
      return { keys: rows.map(adminLicense), linked: !!(owner && count === 1) };
    },
    async setKey(b) {
      const lic = await store.licenseById(str(b.id, 200));
      if (!lic) fail(404, 'No encontré esa clave.');
      const patch = {};
      if (typeof b.revoked === 'boolean') patch.revoked = b.revoked;
      if (typeof b.note === 'string') patch.note = str(b.note, 200) || null;
      if (b.email !== undefined) {
        if (b.email === '' || b.email === null) patch.user_id = null;
        else {
          const user = await store.userByEmail(cleanEmail(b.email));
          if (!user) fail(404, 'Ese correo no tiene cuenta todavía.');
          patch.user_id = user.id;
        }
      }
      await store.updateLicense(lic.id, patch);
      return { key: adminLicense({ ...lic, ...patch }) };
    },
    async messages() {
      return {
        messages: (await store.listMessages({ limit: 100 })).map((m) => ({
          ...publicMessage(m),
          expiresAt: m.expires_at ?? null,
        })),
      };
    },
    async sendMessage(b) {
      const text = str(b.text, 500);
      if (!text) fail(400, 'Escribe el mensaje.');
      const days = Math.min(3650, Math.max(0, Math.floor(Number(b.days) || 0)));
      const m = {
        id: `msg-${randomUUID()}`,
        text,
        url: cleanUrl(b.url),
        created_at: now(),
        expires_at: days > 0 ? now() + days * DAY : null,
      };
      await store.insertMessage(m);
      return { message: publicMessage(m) };
    },
    async deleteMessage(b) {
      await store.deleteMessage(str(b.id, 100));
      return { ok: true };
    },
  };

  /** What every installed app reads: the owner's messages and the revoked keys, signed. */
  async function feed() {
    const key = privateKeyOf(env);
    if (!key) fail(503, 'El servidor aún no está configurado.');
    const messages = (await store.listMessages({ limit: 10, activeAt: now() })).map(publicMessage);
    const body = JSON.stringify({ ts: now(), messages, revoked: await store.revokedIds() });
    return {
      body,
      sig: sign(null, Buffer.from(FEED_DOMAIN + body, 'utf8'), key).toString('base64'),
    };
  }

  /** One entry point per function: returns { status, body }. Never throws. */
  async function run(kind, req) {
    try {
      const t = now();
      if (!store.ready) fail(503, 'La base de datos aún no está configurada.');
      if (kind === 'feed') {
        if (req.method !== 'GET') fail(405, 'Método no permitido.');
        return { status: 200, body: await feed() };
      }
      if (req.method !== 'POST') fail(405, 'Método no permitido.');
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const action = str(b.action, 40);
      const bearer = /^Bearer (.+)$/.exec(String(req.headers?.authorization || ''))?.[1] ?? '';
      if (kind === 'admin') {
        if (adminLimited(req.ip, t)) fail(429, 'Demasiados intentos. Espera unos minutos.');
        const secret = String(env.ADMIN_TOKEN || '');
        if (secret.length < 24)
          fail(503, 'Falta ADMIN_TOKEN en el servidor (24 caracteres o más).');
        if (!bearer || !sameSecret(bearer, secret)) fail(401, 'Clave de administrador incorrecta.');
        if (!Object.hasOwn(admin, action)) fail(400, 'Acción desconocida.');
        return { status: 200, body: await admin[action](b) };
      }
      if (!Object.hasOwn(account, action)) fail(400, 'Acción desconocida.');
      if (
        (action === 'login' || action === 'register' || action === 'password') &&
        authLimited(req.ip, t)
      )
        fail(429, 'Demasiados intentos. Espera unos minutos.');
      return { status: 200, body: await account[action](b, bearer) };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
      console.error(e);
      return { status: 500, body: { error: 'Algo falló en el servidor. Intenta de nuevo.' } };
    }
  }

  return { run, account, admin, feed };
}

/** Adapts a Vercel (req, res) pair to run(). */
export function vercelHandler(kind, service) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ip =
      String(req.headers?.['x-real-ip'] || req.headers?.['x-forwarded-for'] || '')
        .split(',')[0]
        .trim() || 'unknown';
    const out = await service.run(kind, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      ip,
    });
    res.status(out.status).json(out.body);
  };
}
