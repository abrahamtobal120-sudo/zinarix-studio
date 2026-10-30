// Vercel function: GET /api/license?session_id=cs_…
// Checks a Stripe Checkout session (paid) and answers with a Zinarix Studio Pro license key.
// No database: Ed25519 signatures are deterministic, so the same purchase always yields the
// same key (the thank-you page can be reloaded). Environment variables (Vercel → Settings →
// Environment Variables):
//   STRIPE_SECRET_KEY    sk_live_… (or a restricted key that can read Checkout Sessions)
//   LICENSE_PRIVATE_KEY  the private key (PEM) that matches the public key inside the app
//   STRIPE_PAYMENT_LINK  optional plink_…: only purchases from that Payment Link get a key
//   LICENSE_DAYS         optional: keys expire after this many days (empty: never)
import { createPrivateKey, sign } from 'node:crypto';

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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const send = (status, body) => res.status(status).json(body);
  const id = String((req.query && req.query.session_id) || '');
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id))
    return send(400, { error: 'Falta el número de compra (session_id).' });
  const secret = process.env.STRIPE_SECRET_KEY;
  const key = privateKey();
  if (!secret || !key)
    return send(503, { error: 'La tienda aún no está configurada. Escríbenos y te ayudamos.' });

  let session;
  try {
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (r.status === 404) return send(404, { error: 'No encontramos esa compra.' });
    if (!r.ok) return send(502, { error: 'Stripe no respondió. Recarga la página en un momento.' });
    session = await r.json();
  } catch {
    return send(502, { error: 'Stripe no respondió. Recarga la página en un momento.' });
  }

  const link = process.env.STRIPE_PAYMENT_LINK;
  if (link && session.payment_link !== link)
    return send(403, { error: 'Esa compra no es de Zinarix Studio Pro.' });
  const paid =
    session.status === 'complete' &&
    (session.payment_status === 'paid' || session.payment_status === 'no_payment_required');
  if (!paid) return send(402, { error: 'Tu pago aún no se confirma. Recarga en unos segundos.' });

  const email = (session.customer_details && session.customer_details.email) || '';
  const name = (session.customer_details && session.customer_details.name) || undefined;
  const iat = Number(session.created) * 1000;
  const days = Number((session.metadata && session.metadata.days) || process.env.LICENSE_DAYS || 0);
  const payload = { v: 1, id: session.id, plan: 'pro', email };
  if (name) payload.name = name;
  payload.iat = iat;
  if (days > 0) payload.exp = iat + days * 86400000;
  return send(200, { key: makeKey(payload, key), email });
}
