// /api/ai — об'єднаний AI-endpoint (Vercel Hobby має ліміт 12 функцій).
// Роутинг по ?action=chat|report|receipt.
//   chat    — фінансовий чат з Фінном
//   report  — генерація AI-звіту
//   receipt — розпізнавання фото чека (vision)
// Всі використовують callLLM/callLLMVision з Claude → Gemini фолбеком.

import { callLLM, callLLMVision, getLLMKeys } from './_llm.js';

const CHAT_SYSTEM = `Ти — саркастичний особистий фінансовий радник на ім'я Фінн.
Стиль: дотепний, їдкий, але з теплотою і турботою. Як старший друг який розбирається в фінансах.
Правила:
- Відповідай УКРАЇНСЬКОЮ
- Будь коротким: 2-5 речень (якщо не просять детальний аналіз)
- Використовуй конкретні цифри якщо вони є
- Хвали за хороші рішення, їдко критикуй за погані
- Емодзі помірно
- Якщо питання не про фінанси — м'яко поверни до теми грошей`;

const REPORT_SYSTEM = `Ти — саркастичний фінансовий радник на ім'я Фінн. Стиль: дотепний, їдкий, але з любов'ю.
Правила:
- Пиши УКРАЇНСЬКОЮ, коротко і по суті
- Цифри, відсотки, порівняння — обов'язково
- Хвали що добре, жорстко (але з гумором) критикуй що погано
- Називай імена: хто винен — той відповідає 😈
- Використовуй емодзі помірно
- Не більше 300 слів
- Формат: абзаци, без markdown заголовків
- В кінці — одна конкретна порада`;

const RECEIPT_SYSTEM = `Ти — точний OCR-аналізатор чеків для українського застосунку обліку витрат.
Завдання: витягнути дані з фото чека/квитанції та повернути ТІЛЬКИ валідний JSON.
Правила:
- amount: загальна сума до сплати (число, без валюти)
- store: назва магазину/закладу (коротко)
- date: дата у форматі YYYY-MM-DD (або null якщо не видно)
- category: ОДНА категорія з переліку: Продукти, Ресторани, Транспорт, Комунальні, Здоров'я, Одяг, Розваги, Дім, Дитячі, Інше
- items: масив позицій [{name, amount}] (до 5 позицій, лише якщо чітко видно)
Якщо не вдається розпізнати — {"error": "не вдалося розпізнати"}
Повертай ТІЛЬКИ JSON, без пояснень, без markdown.`;

const RECEIPT_PROMPT = 'Проаналізуй цей чек і поверни JSON з полями: amount, store, date, category, items.';

function haveKeys() {
  const { gemini, anthropic } = getLLMKeys();
  return gemini.length > 0 || !!anthropic;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = req.query?.action || '';
  if (!haveKeys()) {
    return res.status(500).json({ error: 'No LLM keys configured (ANTHROPIC_API_KEY or GEMINI_API_KEY_1/2)' });
  }

  try {
    switch (action) {
      case 'chat':    return await handleChat(req, res);
      case 'report':  return await handleReport(req, res);
      case 'receipt': return await handleReceipt(req, res);
      default:
        return res.status(400).json({ error: 'Unknown action (use chat|report|receipt)' });
    }
  } catch (e) {
    console.error(`[ai/${action}]`, e.message);
    return res.status(502).json({ error: e.message });
  }
}

async function handleChat(req, res) {
  const { messages = [], context = '' } = req.body || {};
  const systemWithContext = context ? `${CHAT_SYSTEM}\n\nПоточні фінансові дані користувача:\n${context}` : CHAT_SYSTEM;
  const cleanMessages = (messages || [])
    .filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0)
    .slice(-10);
  const text = await callLLM(systemWithContext, cleanMessages, { maxTokens: 600 });
  return res.json({ text });
}

async function handleReport(req, res) {
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'No prompt' });
  const text = await callLLM(REPORT_SYSTEM, [{ role: 'user', content: prompt }], {
    maxTokens: 1000,
    model: 'claude-sonnet-4-6',
  });
  return res.json({ text });
}

async function handleReceipt(req, res) {
  const { image, mediaType } = req.body || {};
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType' });

  let text;
  try {
    text = await callLLMVision(RECEIPT_SYSTEM, RECEIPT_PROMPT, image, mediaType, { maxTokens: 512 });
  } catch (e) {
    console.error('[ai/receipt]', e.message);
    return res.status(200).json({ error: e.message });
  }

  // Gemini іноді обгортає JSON у ```json ... ```
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return res.status(200).json(JSON.parse(cleaned));
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return res.status(200).json(JSON.parse(match[0])); } catch (_) {}
    }
    return res.status(200).json({ error: 'не вдалося розпізнати' });
  }
}
