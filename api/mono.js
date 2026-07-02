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
      case 'status':     return await handleStatus(req, res);
      case 'rehook':     return await handleRehook(req, res);
      case 'selftest':   return await handleSelfTest(req, res);
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (e) {
    console.error(`[mono/${action}]`, e.message);
    return res.status(502).json({ error: e.message });
  }
}

// ── status: діагностика підключення ─────────────────────────
async function handleStatus(req, res) {
  const { familyId, member } = req.body || {};
  if (!familyId || !member) return res.status(400).json({ error: 'familyId + member required' });

  const db = getDB();
  const snap = await db.collection('families').doc(familyId)
    .collection('integrations').doc(intId(member)).get();
  if (!snap.exists) return res.status(200).json({ connected: false });

  const data = snap.data();
  // Опційно — перевіряємо на боці Моно, що зберігся правильний вебхук.
  let monoWebhook = null;
  let monoOk = null;
  try {
    const token = decryptSecret(data.encToken);
    const info = await getClientInfo(token);
    monoWebhook = info.webHookUrl || '';
    monoOk = true;
  } catch (e) {
    monoOk = false;
  }

  return res.status(200).json({
    connected: true,
    member: data.member,
    provider: data.provider,
    ourWebhookUrl: data.webhookUrl,
    monoWebhookUrl: monoWebhook,
    urlsMatch: monoWebhook && monoWebhook === data.webhookUrl,
    monoTokenOk: monoOk,
    connectedAt: data.connectedAt,
    lastSeenAt: data.lastSeenAt || null,
    lastMonoTxId: data.lastMonoTxId || null,
    lastWebhookPostAt: data.lastWebhookPostAt || null,
    lastWebhookBodyPreview: data.lastWebhookBodyPreview || null,
    lastBackfillAt: data.lastBackfillAt || null,
    lastBackfillAdded: data.lastBackfillAdded ?? null,
    mappedAccounts: Object.keys(data.mapping || {}).length,
    mapping: Object.fromEntries(
      Object.entries(data.mapping || {}).map(([k, v]) => [k, v?.cardId + ' · ' + v?.currency])
    ),
  });
}

// ── connect: валідація токена + список рахунків ─────────────
// ── rehook: перереєструвати вебхук з існуючого запису ──────
// Використовується коли інтеграція вже підключена, але URL у Моно
// втрачений (порожній) — не треба питати юзера токен знову.
// Оновлює також webhookUrl у Firestore до нового чистого формату.
async function handleRehook(req, res) {
  const { familyId, member } = req.body || {};
  if (!familyId || !member) return res.status(400).json({ error: 'familyId + member required' });

  const db = getDB();
  const docRef = db.collection('families').doc(familyId)
    .collection('integrations').doc(intId(member));
  const snap = await docRef.get();
  if (!snap.exists) return res.status(404).json({ error: 'integration not found' });

  const data = snap.data();
  const token = decryptSecret(data.encToken);
  const secret = data.webhookSecret || randomSecret();
  const webhookUrl = `${baseUrl(req)}/mh/${secret}`;

  await setWebhook(token, webhookUrl);
  // Verify
  const info = await getClientInfo(token);
  const ok = info.webHookUrl === webhookUrl;
  if (!ok) {
    return res.status(502).json({
      error: `Моно не зберіг URL (у нього: '${info.webHookUrl || 'порожньо'}')`,
      ourUrl: webhookUrl,
      monoUrl: info.webHookUrl || null,
    });
  }

  await docRef.set({
    webhookSecret: secret,
    webhookUrl,
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  return res.status(200).json({ ok: true, webhookUrl, monoUrl: info.webHookUrl });
}

// ── selftest: перевіряє чи наш webhook endpoint реально приймає POST
// Робить fetch на власний збережений webhookUrl з fake payload. Якщо
// прилетить у integration.lastWebhookPostAt — значить endpoint працює
// і проблема на боці Моно. Якщо не прилетить — щось ламається на
// нашій стороні (Vercel rewrite, routing тощо).
async function handleSelfTest(req, res) {
  const { familyId, member } = req.body || {};
  if (!familyId || !member) return res.status(400).json({ error: 'familyId + member required' });

  const db = getDB();
  const docRef = db.collection('families').doc(familyId)
    .collection('integrations').doc(intId(member));
  const snap = await docRef.get();
  if (!snap.exists) return res.status(404).json({ error: 'integration not found' });
  const url = snap.data().webhookUrl;
  if (!url) return res.status(400).json({ error: 'no webhookUrl in integration' });

  const fakeBody = {
    type: 'StatementItem',
    data: {
      account: 'selftest',
      statementItem: {
        id: 'selftest-' + Date.now(),
        time: Math.floor(Date.now() / 1000),
        description: 'Selftest fake tx',
        mcc: 0,
        amount: 0,
        operationAmount: 0,
        currencyCode: 980,
        balance: 0,
      },
    },
  };
  const started = Date.now();
  let status = null, resBody = null, err = null;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'MonoSelfTest/1' },
      body: JSON.stringify(fakeBody),
    });
    status = r.status;
    resBody = (await r.text()).slice(0, 400);
  } catch (e) {
    err = e.message;
  }
  const took = Date.now() - started;

  return res.status(200).json({
    ok: !!(status >= 200 && status < 300),
    url,
    method: 'POST',
    responseStatus: status,
    responseBody: resBody,
    error: err,
    tookMs: took,
    hint: err
      ? 'POST не долетів до нашого endpoint — проблема на нашій стороні (Vercel).'
      : status >= 200 && status < 300
        ? 'Endpoint працює. Якщо Моно все одно не шле — проблема на боці Моно.'
        : 'Endpoint відповів не-2xx. Моно теж отримує це і потім скидає webhook.',
  });
}

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
  // Чистий шлях без query string. Vercel rewrite '/mh/:secret' → '/api/mono?action=webhook&s=:secret'.
  // Моно категорично не приймає URL з '?' та '&' у деяких перевірках і мовчки скидає webhook.
  const webhookUrl = `${baseUrl(req)}/mh/${secret}`;

  const cleanToken = token.trim();
  await setWebhook(cleanToken, webhookUrl);

  // Верифікуємо: перечитуємо client-info і перевіряємо чи URL справді зберігся.
  // Якщо Моно повернув success але URL не зберіг (буває на rate limit / валідації) —
  // одразу повідомляємо клієнта замість того щоб мовчки залишити зламаний webhook.
  try {
    const info = await getClientInfo(cleanToken);
    if (!info.webHookUrl || info.webHookUrl !== webhookUrl) {
      throw new Error(`Monobank не зберіг вебхук (у нього: '${info.webHookUrl || 'порожньо'}'). Спробуй ще раз через хвилину — можливо rate limit.`);
    }
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }

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
  const body = req.body || {};

  console.log('[mono/webhook] hit', {
    method: req.method,
    secret: secret ? secret.slice(0, 8) + '...' : '(empty)',
    hasBody: !!body,
    bodyType: body?.type,
    bodyKeys: Object.keys(body || {}),
  });

  if (!secret) return res.status(400).json({ error: 'missing secret' });

  const db = getDB();
  const snap = await db.collectionGroup('integrations')
    .where('webhookSecret', '==', secret)
    .limit(1)
    .get();

  if (snap.empty) {
    console.warn('[mono/webhook] unknown secret');
    return res.status(200).json({ ok: true, ignored: 'unknown-secret' });
  }

  const integrationDoc = snap.docs[0];
  const integration = integrationDoc.data();

  // ДІАГНОСТИКА: логуємо КОЖЕН POST що дійшов до цього хендлера,
  // навіть якщо це не StatementItem. Щоб у користувача була видимість
  // 'Моно взагалі шле щось чи ні'. Зберігаємо в Firestore, а не в
  // console — щоб можна було прочитати з status endpoint'у.
  try {
    await integrationDoc.ref.set({
      lastWebhookPostAt: new Date().toISOString(),
      lastWebhookBodyPreview: JSON.stringify(body).slice(0, 800),
    }, { merge: true });
  } catch (e) { /* ignore logging fails */ }

  if (body.type !== 'StatementItem' || !body.data?.statementItem) {
    return res.status(200).json({ ok: true, ignored: 'not-statement-item' });
  }

  if (integration.provider !== 'monobank') {
    return res.status(200).json({ ok: true, ignored: 'wrong-provider' });
  }
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
