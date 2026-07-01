// /api/mono-connect — валідація токена і повернення переліку рахунків.
// Клієнт викликає ДО збереження — щоб показати юзеру список рахунків
// і дати обрати куди прив'язати кожен.

import { getClientInfo, currencyCodeToStr, accountType } from './_mono.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
      client: {
        name: info.name,
        webHookUrl: info.webHookUrl || '',
      },
      accounts,
      jars,
    });
  } catch (e) {
    console.error('[mono-connect]', e.message);
    const status = e.status === 401 || e.status === 403 ? 401 : 502;
    return res.status(status).json({ error: e.message });
  }
}
