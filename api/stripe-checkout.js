// Vercel serverless — create a Stripe Checkout Session for Pro subscription
import Stripe from 'stripe';

const PRICE_ENV = {
  week:  'STRIPE_PRICE_WEEK',
  month: 'STRIPE_PRICE_MONTH',
  year:  'STRIPE_PRICE_YEAR',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { familyId, plan, trial } = req.body || {};
    if (!familyId) return res.status(400).json({ error: 'Missing familyId' });

    const priceEnv = PRICE_ENV[plan] || PRICE_ENV.month;
    const priceId = process.env[priceEnv];
    if (!priceId) return res.status(500).json({ error: `Price not configured: ${priceEnv}` });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const origin = req.headers.origin
      || (req.headers.host ? `https://${req.headers.host}` : '');

    const subscriptionData = { metadata: { familyId } };
    if (trial) subscriptionData.trial_period_days = 7;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: familyId,
      metadata: { familyId, plan: plan || 'month' },
      subscription_data: subscriptionData,
      allow_promotion_codes: true,
      success_url: `${origin}/?pro=success`,
      cancel_url: `${origin}/?pro=cancel`,
    });

    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
