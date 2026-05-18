// Vercel serverless — Paddle Billing webhook → updates families/{familyId}.isPro
import crypto from 'crypto';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Raw body is required for signature verification.
export const config = { api: { bodyParser: false } };

function getDB() {
  if (!getApps().length) {
    initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
  return getFirestore();
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function verifySignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = {};
  for (const kv of sigHeader.split(';')) {
    const idx = kv.indexOf('=');
    if (idx > 0) parts[kv.slice(0, idx)] = kv.slice(idx + 1);
  }
  if (!parts.ts || !parts.h1) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parts.ts}:${rawBody}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.h1));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const raw = await readRawBody(req);
    const sig = req.headers['paddle-signature'];

    if (!verifySignature(raw, sig, process.env.PADDLE_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(raw);
    const type = event.event_type;
    const data = event.data || {};
    const familyId = data?.custom_data?.familyId;

    if (!familyId) return res.json({ ok: true, skipped: 'no familyId' });

    const ref = getDB().collection('families').doc(familyId);

    if (
      type === 'subscription.activated' ||
      type === 'subscription.resumed' ||
      type === 'transaction.completed'
    ) {
      await ref.set({
        isPro: true,
        proSince: new Date().toISOString(),
        paddleSubscriptionId: data.subscription_id || data.id || null,
      }, { merge: true });
    } else if (type === 'subscription.canceled' || type === 'subscription.paused') {
      await ref.set({ isPro: false }, { merge: true });
    } else if (type === 'subscription.updated') {
      const active = data.status === 'active' || data.status === 'trialing';
      await ref.set({ isPro: active }, { merge: true });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[paddle-webhook]', e.message);
    res.status(500).json({ error: e.message });
  }
}
