// Vercel function: GET /api/license?session_id=cs_…
// Checks a Stripe Checkout session (paid, not refunded, not disputed) and answers with a
// Zinarix Studio license key (Pro, AI or Pro + AI).
// No database: Ed25519 signatures are deterministic, so the same purchase always yields the
// same key (the thank-you page can be reloaded). Environment variables (Vercel → Settings →
// Environment Variables):
//   STRIPE_SECRET_KEY    sk_live_… (or a restricted key that can read Checkout Sessions,
//                        Payment Intents, Charges and Subscriptions)
//   LICENSE_PRIVATE_KEY  the private key (PEM) that matches the public key inside the app
//   STRIPE_PAYMENT_LINK  plink_… of the Pro link
//   STRIPE_LINK_AI       plink_… of the AI link: its purchases get an 'ai' key
//   STRIPE_LINK_PROAI    plink_… of the Pro + AI link: its purchases get a 'proai' key
//                        At least one link is required: purchases from any other link or
//                        product in the Stripe account never get a key.
//   LICENSE_DAYS         optional: keys expire after this many days (empty: never)
//   LICENSE_CLAIM_HOURS  optional: how long after paying the key can be fetched with the
//                        session id (default 72). Later, the buyer writes to support.
//   REVOKED_LICENSES     optional: comma-separated session ids that never get a key again
//                        (also read from the "revoked" list of app-config.json).
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const b64url = (b) => Buffer.from(b).toString('base64url');

function privateKey() {
  const pem = (process.env.LICENSE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!pem.includes('PRIVATE KEY')) return null;
  return createPrivateKey(pem);
}

function makeKey(payload, key) {
  const body = `ZX1.${b64url(JSON.stringify(payload))}`;
  return `${body}.${b64url(sign(null, Buffer.from(body), key))}`;
}

/** Revoked licenses: the env list plus app-config.json (the one the apps read too). */
function revoked() {
  const out = new Set(
    (process.env.REVOKED_LICENSES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  try {
    const cfg = JSON.parse(readFileSync(new URL('../app-config.json', import.meta.url), 'utf8'));
    for (const id of Array.isArray(cfg.revoked) ? cfg.revoked : []) out.add(String(id));
  } catch {
    // no config next to the function: the env list is enough
  }
  return out;
}

/**
 * Best-effort limit per IP and per function instance (no database). For a hard limit, add
 * a Vercel Firewall rate-limit rule on /api/license as well.
 */
const hits = new Map();
const WINDOW_MS = 10 * 60_000;
const MAX_HITS = 20;
function limited(ip) {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > WINDOW_MS) hits.delete(k);
  const h = hits.get(ip);
  if (!h || now - h.start > WINDOW_MS) {
    hits.set(ip, { start: now, n: 1 });
    return false;
  }
  h.n += 1;
  return h.n > MAX_HITS;
}

/** a…@dominio.com: the page shows whose key it is without handing out the full address. */
function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return '';
  return `${user.slice(0, 1)}…@${domain}`;
}

async function stripe(path, secret) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  return r;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const send = (status, body) => res.status(status).json(body);
  const ip =
    String(req.headers?.['x-real-ip'] || req.headers?.['x-forwarded-for'] || '')
      .split(',')[0]
      .trim() || 'unknown';
  if (limited(ip)) {
    res.setHeader('Retry-After', '600');
    return send(429, { error: 'Demasiados intentos. Espera unos minutos y recarga.' });
  }
  const id = String((req.query && req.query.session_id) || '');
  if (!/^cs_(test|live)_[A-Za-z0-9]{1,200}$/.test(id))
    return send(400, { error: 'Falta el número de compra (session_id).' });
  const secret = process.env.STRIPE_SECRET_KEY;
  const key = privateKey();
  const links = {
    pro: process.env.STRIPE_PAYMENT_LINK,
    ai: process.env.STRIPE_LINK_AI,
    proai: process.env.STRIPE_LINK_PROAI,
  };
  const known = Object.entries(links).filter(([, l]) => l);
  // Without links, every purchase in the Stripe account would become a Pro key.
  if (!secret || !key || !known.length)
    return send(503, { error: 'La tienda aún no está configurada. Escríbenos y te ayudamos.' });
  if (revoked().has(id))
    return send(403, { error: 'Esta compra fue reembolsada o cancelada. Escríbenos si es un error.' });

  let session;
  try {
    const q = new URLSearchParams();
    q.append('expand[]', 'payment_intent.latest_charge');
    q.append('expand[]', 'subscription');
    const r = await stripe(`checkout/sessions/${encodeURIComponent(id)}?${q}`, secret);
    if (r.status === 404) return send(404, { error: 'No encontramos esa compra.' });
    if (!r.ok) return send(502, { error: 'Stripe no respondió. Recarga la página en un momento.' });
    session = await r.json();
  } catch {
    return send(502, { error: 'Stripe no respondió. Recarga la página en un momento.' });
  }

  // The plan comes from the Payment Link used.
  const match = known.find(([, l]) => session.payment_link === l);
  if (!match) return send(403, { error: 'Esa compra no es de Zinarix Studio.' });
  const plan = match[0];
  const paid =
    session.status === 'complete' &&
    (session.payment_status === 'paid' || session.payment_status === 'no_payment_required');
  if (!paid) return send(402, { error: 'Tu pago aún no se confirma. Recarga en unos segundos.' });

  // Stripe keeps payment_status "paid" after a refund: check the charge itself.
  const pi = session.payment_intent && typeof session.payment_intent === 'object'
    ? session.payment_intent
    : null;
  const charge = pi && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  if (pi && pi.status !== 'succeeded')
    return send(402, { error: 'Tu pago aún no se confirma. Recarga en unos segundos.' });
  if (charge && (charge.refunded || charge.amount_refunded > 0 || charge.disputed))
    return send(403, { error: 'Esta compra fue reembolsada o está en disputa. Escríbenos si es un error.' });
  const sub = session.subscription && typeof session.subscription === 'object'
    ? session.subscription
    : null;
  if (sub && !['active', 'trialing'].includes(sub.status))
    return send(403, { error: 'Tu suscripción no está activa. Renuévala para obtener tu licencia.' });
  if (session.mode === 'payment' && !pi && session.payment_status !== 'no_payment_required')
    return send(502, { error: 'No pudimos revisar el pago. Recarga la página en un momento.' });

  // The session id is in the thank-you URL: it only works for a while after paying, so a
  // leaked link cannot hand out the key (and the buyer's email) forever.
  const claimHours = Number(process.env.LICENSE_CLAIM_HOURS || 72);
  const createdMs = Number(session.created) * 1000;
  if (claimHours > 0 && Date.now() - createdMs > claimHours * 3_600_000)
    return send(410, {
      error: 'Este enlace de compra ya expiró. Escríbenos con tu correo de compra y te reenviamos la licencia.',
    });

  const email = (session.customer_details && session.customer_details.email) || '';
  const name = (session.customer_details && session.customer_details.name) || undefined;
  const iat = createdMs;
  const days = Number((session.metadata && session.metadata.days) || process.env.LICENSE_DAYS || 0);
  const payload = { v: 1, id: session.id, plan, email };
  if (name) payload.name = name;
  payload.iat = iat;
  if (days > 0) payload.exp = iat + days * 86400000;
  return send(200, { key: makeKey(payload, key), email: maskEmail(email) });
}
