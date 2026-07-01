// /api/mono-save — зберегти зашифрований токен + мапінг рахунків Моно
// на наші гаманці, зареєструвати вебхук у Monobank.

import { getDB } from './_firestore.js';
import { encryptSecret, randomSecret } from './_crypto.js';
import { setWebhook } from './_mono.js';

function baseUrl(req) {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { familyId, member, token, mapping } = req.body || {};
  // mapping: { [monoAccountId]: { cardId, currency } | null (пропустити) }
  if (!familyId || !member || !token || !mapping || typeof mapping !== 'object') {
    return res.status(400).json({ error: 'familyId, member, token, mapping required' });
  }

  try {
    const db = getDB();
    const integrationId = `mono_${member}`.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const secret = randomSecret();
    const webhookUrl = `${baseUrl(req)}/api/mono-webhook?s=${secret}`;

    // Реєструємо вебхук у Моно.
    await setWebhook(token.trim(), webhookUrl);

    const encToken = encryptSecret(token.trim());
    const doc = {
      provider: 'monobank',
      member,
      encToken,
      webhookSecret: secret,
      webhookUrl,
      mapping,           // { monoAccountId: { cardId, currency } }
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active',
    };

    await db.collection('families').doc(familyId)
      .collection('integrations').doc(integrationId)
      .set(doc, { merge: true });

    return res.status(200).json({ ok: true, integrationId });
  } catch (e) {
    console.error('[mono-save]', e.message);
    return res.status(502).json({ error: e.message });
  }
}
