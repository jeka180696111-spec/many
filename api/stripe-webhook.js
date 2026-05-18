// Vercel serverless — Stripe webhook: sync subscription status → Firestore isPro
import Stripe from 'stripe';

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function getDb() {
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
  return getFirestore();
}

async function setPro(db, familyId, isPro, extra = {}) {
  if (!familyId) return;
  await db.collection('families').doc(familyId).set(
    { isPro, ...extra },
    { merge: true },
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event;

  try {
    const raw = await readRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).json({ error: `Webhook signature error: ${e.message}` });
  }

  try {
    const db = await getDb();

    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const familyId = s.client_reference_id || s.metadata?.familyId;
        await setPro(db, familyId, true, {
          stripeCustomerId: s.customer || null,
          stripeSubscriptionId: s.subscription || null,
          proPlan: s.metadata?.plan || null,
          proSince: new Date().toISOString(),
        });
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const familyId = sub.metadata?.familyId;
        const active = ['active', 'trialing', 'past_due'].includes(sub.status)
          && event.type !== 'customer.subscription.deleted';
        await setPro(db, familyId, active, {
          stripeSubscriptionStatus: sub.status,
        });
        break;
      }
      default:
        break;
    }

    res.json({ received: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
