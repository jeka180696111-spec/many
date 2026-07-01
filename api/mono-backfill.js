// /api/mono-backfill — підтягнути statement за N днів (дефолт 31).
// Викликається з UI після успішного mono-save. Пише операції з
// clientId='mono:<txId>' для дедупу — webhook і backfill безпечно
// перекриваються, дубля не буде.
//
// Rate limit Monobank: 1 запит statement per 60 seconds per token.
// Тому backfill робить запити ПОСЛІДОВНО з паузою 61 сек між ними.
// Для 2-3 акаунтів це 2-3 хвилини — терпимо.
// Vercel serverless має ліміт часу — тому пишемо async без чекання
// повного завершення для довгих випадків, повертаємо статус 202.

import { getDB } from './_firestore.js';
import { decryptSecret } from './_crypto.js';
import { getStatement, currencyCodeToStr, monoStatementToOp } from './_mono.js';
import { mccToCategory } from './_mcc.js';

const SLEEP_BETWEEN_ACCOUNTS_MS = 61_000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { familyId, member, days } = req.body || {};
  if (!familyId || !member) return res.status(400).json({ error: 'familyId + member required' });

  const daysBack = Math.min(Math.max(1, Number(days) || 31), 31);

  try {
    const db = getDB();
    const integrationId = `mono_${member}`.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const intRef = db.collection('families').doc(familyId)
      .collection('integrations').doc(integrationId);
    const snap = await intRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'integration not found' });

    const integration = snap.data();
    const token = decryptSecret(integration.encToken);
    const mapping = integration.mapping || {};
    const mappedAccounts = Object.entries(mapping).filter(([, m]) => m && m.cardId);

    if (!mappedAccounts.length) return res.status(200).json({ ok: true, count: 0 });

    const fromUnix = Math.floor(Date.now() / 1000) - daysBack * 86400;
    const opsRef = intRef.parent.parent.collection('operations');

    // Робимо ПОСЛІДОВНО з паузами. Vercel може здатись до кінця, але Mono
    // все одно поверне помилку 429 при швидких запитах. Тому послідовно.
    let totalAdded = 0;
    let totalSkipped = 0;
    for (let i = 0; i < mappedAccounts.length; i++) {
      const [monoAccountId, mapEntry] = mappedAccounts[i];
      try {
        if (i > 0) await sleep(SLEEP_BETWEEN_ACCOUNTS_MS);
        const statement = await getStatement(token, monoAccountId, fromUnix);
        if (!Array.isArray(statement)) continue;
        for (const stItem of statement) {
          const accountCurrency = mapEntry.currency || currencyCodeToStr(stItem.currencyCode);
          const op = monoStatementToOp(stItem, {
            accountId: monoAccountId,
            accountCurrency,
            ourCard: { id: mapEntry.cardId, currency: accountCurrency },
            who: integration.member,
            categoryFor: mccToCategory,
          });
          const existing = await opsRef.where('clientId', '==', op.clientId).limit(1).get();
          if (!existing.empty) { totalSkipped++; continue; }
          await opsRef.add(op);
          totalAdded++;
        }
      } catch (e) {
        console.warn('[mono-backfill] account', monoAccountId, e.message);
      }
    }

    await intRef.set({
      lastBackfillAt: new Date().toISOString(),
      lastBackfillAdded: totalAdded,
      lastBackfillSkipped: totalSkipped,
    }, { merge: true });

    return res.status(200).json({ ok: true, added: totalAdded, skipped: totalSkipped });
  } catch (e) {
    console.error('[mono-backfill]', e.message);
    return res.status(502).json({ error: e.message });
  }
}
