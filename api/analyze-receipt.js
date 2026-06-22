// /api/analyze-receipt.js — Receipt analysis via Claude vision → Gemini vision фолбек

import { callLLMVision, getLLMKeys } from './_llm.js';

const SYSTEM = `Ти — точний OCR-аналізатор чеків для українського застосунку обліку витрат.
Завдання: витягнути дані з фото чека/квитанції та повернути ТІЛЬКИ валідний JSON.
Правила:
- amount: загальна сума до сплати (число, без валюти)
- store: назва магазину/закладу (коротко)
- date: дата у форматі YYYY-MM-DD (або null якщо не видно)
- category: ОДНА категорія з переліку: Продукти, Ресторани, Транспорт, Комунальні, Здоров'я, Одяг, Розваги, Дім, Дитячі, Інше
- items: масив позицій [{name, amount}] (до 5 позицій, лише якщо чітко видно)
Якщо не вдається розпізнати — {"error": "не вдалося розпізнати"}
Повертай ТІЛЬКИ JSON, без пояснень, без markdown.`;

const PROMPT = 'Проаналізуй цей чек і поверни JSON з полями: amount, store, date, category, items.';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { image, mediaType } = req.body || {};
    if (!image || !mediaType) {
      return res.status(400).json({ error: 'Missing image or mediaType' });
    }

    const { gemini, anthropic } = getLLMKeys();
    if (gemini.length === 0 && !anthropic) {
      return res.status(200).json({ error: 'No LLM keys configured' });
    }

    let text;
    try {
      text = await callLLMVision(SYSTEM, PROMPT, image, mediaType, { maxTokens: 512 });
    } catch (e) {
      console.error('[analyze-receipt]', e.message);
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
  } catch (error) {
    console.error('analyze-receipt error:', error);
    return res.status(200).json({ error: error.message });
  }
};
