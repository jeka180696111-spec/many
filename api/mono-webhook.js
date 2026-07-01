// /api/mono-webhook — приймає push від Monobank.
// URL містить ?s=<webhookSecret> (унікальний per-integration, генерується
// в mono-save.js через randomSecret). За ним знаходимо, до якої родини і
// члена належить push.
//
// Тіло від Mono:
//   { type: 'StatementItem', data: { account: '<mono account id>',
//     statementItem: { id, time, description, mcc, amount, operationAmount,
//                      currencyCode, commissionRate, cashbackAmount,
//                      balance, hold, comment } } }
//
// Важливо: відповідати 2xx швидко. Інакше Monobank ретраїть.

import { getDB } from './_firestore.js';
import { currencyCodeToStr, monoStatementToOp } from './_mono.js';
import { mccToCategory } from './_mcc.js';

export default async function handler(req, res) {
  // Monobank робить GET на URL для верифікації при setWebhook.
  // Будь-який 2xx підтверджує URL.
  if (req.method === 'GET') return res.status(200).send('ok');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = (req.query && req.query.s) || '';
  if (!secret) return res.status(400).json({ error: 'missing secret' });

  const body = req.body || {};
  if (body.type !== 'StatementItem' || !body.data?.statementItem) {
    // Не наш формат — тихо приймаємо, щоб Mono не ретраїв.
    return res.status(200).json({ ok: true, ignored: true });
  }

  try {
    const db = getDB();

    // Пошук інтеграції по secret. Collection-group query — щоб не проходити
    // всі родини вручну.
    const snap = await db.collectionGroup('integrations')
      .where('webhookSecret', '==', secret)
      .where('provider', '==', 'monobank')
      .limit(1)
      .get();

    if (snap.empty) {
      console.warn('[mono-webhook] unknown secret');
      // Повертаємо 200 щоб Mono не бомбардував ретраями невідомий URL.
      return res.status(200).json({ ok: true, ignored: 'unknown-secret' });
    }

    const integrationDoc = snap.docs[0];
    const integration = integrationDoc.data();
    // Шлях: families/{familyId}/integrations/{integrationId}
    const familyRef = integrationDoc.ref.parent.parent;
    const familyId = familyRef.id;

    const monoAccountId = body.data.account;
    const stItem = body.data.statementItem;

    // Знаходимо наш кошелек по мапінгу.
    const mapEntry = integration.mapping?.[monoAccountId];
    if (!mapEntry || !mapEntry.cardId) {
      // Юзер не прив'язав цей mono-рахунок — ігноруємо (наприклад друга
      // валюта, яку не мапнули).
      return res.status(200).json({ ok: true, ignored: 'not-mapped' });
    }

    const accountCurrency = mapEntry.currency || currencyCodeToStr(stItem.currencyCode);
    const op = monoStatementToOp(stItem, {
      accountId: monoAccountId,
      accountCurrency,
      ourCard: { id: mapEntry.cardId, currency: accountCurrency },
      who: integration.member,
      categoryFor: mccToCategory,
    });

    // Ідемпотентність: якщо операція з таким clientId вже існує — не пишемо.
    const opsRef = familyRef.collection('operations');
    const existing = await opsRef.where('clientId', '==', op.clientId).limit(1).get();
    if (!existing.empty) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    await opsRef.add(op);

    // Оновлюємо lastSeenAt на інтеграції (для UI щоб показати "остання
    // операція X хвилин тому").
    await integrationDoc.ref.set({
      lastSeenAt: new Date().toISOString(),
      lastMonoTxId: stItem.id,
    }, { merge: true });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[mono-webhook]', e.message);
    // Логуємо, але повертаємо 200 щоб Mono не ретраїв нескінченно на
    // системних збоях (Firestore тимчасово недоступний тощо). У них є
    // окрема сторінка з подіями, і будь-який пропущений можна перезалити
    // через backfill.
    return res.status(200).json({ ok: false, error: e.message });
  }
}
