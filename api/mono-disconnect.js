// /api/mono-disconnect — відв'язати Monobank від інтеграції.
// Прибираємо вебхук у Моно (set webHookUrl = '') і видаляємо запис в Firestore.

import { getDB } from './_firestore.js';
import { decryptSecret } from './_crypto.js';
import { setWebhook } from './_mono.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { familyId, member } = req.body || {};
  if (!familyId || !member) return res.status(400).json({ error: 'familyId + member required' });

  try {
    const db = getDB();
    const integrationId = `mono_${member}`.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const docRef = db.collection('families').doc(familyId)
      .collection('integrations').doc(integrationId);

    const snap = await docRef.get();
    if (!snap.exists) return res.status(200).json({ ok: true, notConnected: true });

    const data = snap.data();
    // Пробуємо прибрати вебхук у Моно. Якщо токен вже недійсний — все одно
    // видаляємо запис локально.
    try {
      const token = decryptSecret(data.encToken);
      await setWebhook(token, '');
    } catch (e) {
      console.warn('[mono-disconnect] could not clear webhook:', e.message);
    }

    await docRef.delete();
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[mono-disconnect]', e.message);
    return res.status(502).json({ error: e.message });
  }
}
