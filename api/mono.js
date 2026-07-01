// /api/mono — єдина точка входу для Monobank інтеграції.
// Роутинг по query param `action`:
//   ?action=connect       — валідація токена + список рахунків
//   ?action=save          — зберегти токен + мапінг + зареєструвати вебхук
//   ?action=disconnect    — відключити (прибрати вебхук, видалити доку)
//   ?action=backfill      — підтягнути 31 день statement
//   ?action=webhook&s=... — приймальник push'ів від Monobank
//
// Хобі-план Vercel дозволяє тільки 12 serverless функцій. Об'єднання
// економить 4 слоти.

import { getDB } from './_firestore.js';
import { encryptSecret, decryptSecret, randomSecret } from './_crypto.js';
import {
  getClientInfo, setWebhook, getStatement,
  currencyCodeToStr, accountType, monoStatementToOp,
} from './_mono.js';
import { mccToCategory } from './_mcc.js';

// ─────────────────────────────────────────────────────────────
function baseUrl(req) {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

function intId(member) {
  return `mono_${member}`.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

// ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const action = req.query?.action || '';

  // Monobank ping (GET) для перевірки URL при setWebhook.
  if (req.method === 'GET' && action === 'webhook') {
    return res.status(200).send('ok');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    switch (action) {
      case 'connect':    return await handleConnect(req, res);
      case 'save':       return await handleSave(req, res);
      case 'disconnect': return await handleDisconnect(req, res);
      case 'backfill':   return await handleBackfill(req, res);
      case 'webhook':    return await handleWebhook(req, res);
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (e) {
    console.error(`[mono/${action}]`, e.message);
    return res.status(502).json({ error: e.message });
  }
}

// ── connect: валідація токена + список рахунків ─────────────
async function handleConnect(req, res) {
  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Token required' });
  }
  try {
    const info = await getClientInfo(token.trim());
    const accounts = (info.accounts || []).map(a => {
      const t = accountType(a);
      return {
        id: a.id,
        maskedPan: (a.maskedPan || [])[0] || '',
        type: a.type,
        typeLabel: t.label,
        isCredit: t.isCredit,
        currency: currencyCodeToStr(a.currencyCode),
        balance: Number(a.balance) / 100,
        creditLimit: Number(a.creditLimit) / 100,
        cashbackType: a.cashbackType,
        iban: a.iban,
      };
    });
    const jars = (info.jars || []).map(j => ({
      id: j.id,
      title: j.title,
      currency: currencyCodeToStr(j.currencyCode),
      balance: Number(j.balance) / 100,
      goal: Number(j.goal || 0) / 100,
    }));
    return res.status(200).json({
      ok: true,
      client: { name: info.name, webHookUrl: info.webHookUrl || '' },
      accounts, jars,
    });
  } catch (e) {
    const status = e.status === 401 || e.status === 403 ? 401 : 502;
    return res.status(status).json({ error: e.message });
  }
}

// ── save: токен + мапінг + вебхук ───────────────────────────
async function handleSave(req, res) {
  const { familyId, member, token, mapping } = req.body || {};
  if (!familyId || !member || !token || !mapping || typeof mapping !== 'object') {
    return res.status(400).json({ error: 'familyId, member, token, mapping required' });
  }
  const db = getDB();
  const secret = randomSecret();
  const webhookUrl = `${baseUrl(req)}/api/mono?action=webhook&s=${secret}`;

  await setWebhook(token.trim(), webhookUrl);

  const encToken = encryptSecret(token.trim());
  const doc = {
    provider: 'monobank',
    member,
    encToken,
    webhookSecret: secret,
    webhookUrl,
    mapping,
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
  };

  await db.collection('families').doc(familyId)
    .collection('integrations').doc(intId(member))
    .set(doc, { merge: true });

  return res.status(200).json({ ok: true, integrationId: intId(member) });
}

// ── disconnect: прибрати вебхук + видалити доку ─────────────
async function handleDisconnect(req, res) {
  const { familyId, member } = req.body || {};
  if (!familyId || !member) return res.status(400).json({ error: 'familyId + member required' });

  const db = getDB();
  const docRef = db.collection('families').doc(familyId)
    .collection('integrations').doc(intId(member));
  const snap = await docRef.get();
  if (!snap.exists) return res.status(200).json({ ok: true, notConnected: true });

  const data = snap.data();
  try {
    const token = decryptSecret(data.encToken);
    await setWebhook(token, '');
  } catch (e) {
    console.warn('[mono/disconnect] clear webhook failed:', e.message);
  }
  await docRef.delete();
  return res.status(200).json({ ok: true });
}

// ── backfill: 31 день statement ─────────────────────────────
const SLEEP_BETWEEN_ACCOUNTS_MS = 61_000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function handleBackfill(req, res) {
  const { familyId, member, days } = req.body || {};
  if (!familyId || !member) return res.status(400).json({ error: 'familyId + member required' });

  const daysBack = Math.min(Math.max(1, Number(days) || 31), 31);
  const db = getDB();
  const intRef = db.collection('families').doc(familyId)
    .collection('integrations').doc(intId(member));
  const snap = await intRef.get();
  if (!snap.exists) return res.status(404).json({ error: 'integration not found' });

  const integration = snap.data();
  const token = decryptSecret(integration.encToken);
  const mapping = integration.mapping || {};
  const mappedAccounts = Object.entries(mapping).filter(([, m]) => m && m.cardId);
  if (!mappedAccounts.length) return res.status(200).json({ ok: true, added: 0, skipped: 0 });

  const fromUnix = Math.floor(Date.now() / 1000) - daysBack * 86400;
  const opsRef = intRef.parent.parent.collection('operations');

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
      console.warn('[mono/backfill] account', monoAccountId, e.message);
    }
  }

  await intRef.set({
    lastBackfillAt: new Date().toISOString(),
    lastBackfillAdded: totalAdded,
    lastBackfillSkipped: totalSkipped,
  }, { merge: true });

  return res.status(200).json({ ok: true, added: totalAdded, skipped: totalSkipped });
}

// ── webhook: прийом push'ів від Monobank ────────────────────
async function handleWebhook(req, res) {
  const secret = req.query?.s || '';
  if (!secret) return res.status(400).json({ error: 'missing secret' });

  const body = req.body || {};
  if (body.type !== 'StatementItem' || !body.data?.statementItem) {
    return res.status(200).json({ ok: true, ignored: true });
  }

  const db = getDB();
  const snap = await db.collectionGroup('integrations')
    .where('webhookSecret', '==', secret)
    .where('provider', '==', 'monobank')
    .limit(1)
    .get();

  if (snap.empty) {
    console.warn('[mono/webhook] unknown secret');
    return res.status(200).json({ ok: true, ignored: 'unknown-secret' });
  }

  const integrationDoc = snap.docs[0];
  const integration = integrationDoc.data();
  const familyRef = integrationDoc.ref.parent.parent;

  const monoAccountId = body.data.account;
  const stItem = body.data.statementItem;

  const mapEntry = integration.mapping?.[monoAccountId];
  if (!mapEntry || !mapEntry.cardId) {
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

  const opsRef = familyRef.collection('operations');
  const existing = await opsRef.where('clientId', '==', op.clientId).limit(1).get();
  if (!existing.empty) return res.status(200).json({ ok: true, duplicate: true });

  await opsRef.add(op);
  await integrationDoc.ref.set({
    lastSeenAt: new Date().toISOString(),
    lastMonoTxId: stItem.id,
  }, { merge: true });

  return res.status(200).json({ ok: true });
}
