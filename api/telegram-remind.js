// ═══════════════════════════════════════════════════════════════
// Vercel Serverless Function — Telegram нагадування
// Cron: щодня о 9:00 (налаштувати в vercel.json)
// ═══════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID || 'kiose-budget';
  const FAMILY_ID = process.env.FAMILY_ID || 'koval';

  if (!BOT_TOKEN || !CHAT_ID) {
    return new Response(JSON.stringify({ error: 'Missing TELEGRAM env vars' }), { status: 500 });
  }

  try {
    // Читаємо з Firestore REST API (без admin SDK — edge runtime)
    const fsUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/families/${FAMILY_ID}/recurringPayments`;
    const fsRes = await fetch(fsUrl);
    const fsData = await fsRes.json();

    if (!fsData.documents) {
      return new Response(JSON.stringify({ ok: true, reminders: 0, note: 'no documents' }));
    }

    const today = new Date();
    const dayOfMonth = today.getDate();
    const messages = [];

    for (const doc of fsData.documents) {
      const f = doc.fields;
      const active = f.active?.booleanValue !== false;
      const notify = f.notifyTelegram?.booleanValue !== false;
      if (!active || !notify) continue;

      const name = f.name?.stringValue || '?';
      const amount = Number(f.amount?.integerValue || f.amount?.doubleValue || 0);
      const payDay = Number(f.dayOfMonth?.integerValue || 0);
      const who = f.who?.stringValue || '';
      const remindBefore = Number(f.remindDaysBefore?.integerValue || 3);

      const daysUntil = payDay - dayOfMonth;

      if (daysUntil === 0) {
        messages.push(`🔴 *СЬОГОДНІ*: ${name} — ${amount} ₴ (${who})`);
      } else if (daysUntil === 1) {
        messages.push(`🟡 *Завтра*: ${name} — ${amount} ₴ (${who})`);
      } else if (daysUntil > 0 && daysUntil <= remindBefore) {
        messages.push(`📅 Через ${daysUntil} дн: ${name} — ${amount} ₴ (${who})`);
      }
    }

    if (messages.length > 0) {
      const text = `💰 *Нагадування про платежі*\n\n${messages.join('\n')}`;

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text,
          parse_mode: 'Markdown',
        }),
      });
    }

    return new Response(JSON.stringify({ ok: true, reminders: messages.length }));
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
