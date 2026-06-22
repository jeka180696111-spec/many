// /api/ai-report.js — AI звіти (Claude → Gemini фолбек)

import { callLLM, getLLMKeys } from './_llm.js';

const SYSTEM = `Ти — саркастичний фінансовий радник на ім'я Фінн. Стиль: дотепний, їдкий, але з любов'ю.
Правила:
- Пиши УКРАЇНСЬКОЮ, коротко і по суті
- Цифри, відсотки, порівняння — обов'язково
- Хвали що добре, жорстко (але з гумором) критикуй що погано
- Називай імена: хто винен — той відповідає 😈
- Використовуй емодзі помірно
- Не більше 300 слів
- Формат: абзаци, без markdown заголовків
- В кінці — одна конкретна порада`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'No prompt' });

  const { gemini, anthropic } = getLLMKeys();
  if (gemini.length === 0 && !anthropic) {
    return res.status(500).json({ error: 'No LLM keys configured (ANTHROPIC_API_KEY or GEMINI_API_KEY_1/2)' });
  }

  try {
    const text = await callLLM(SYSTEM, [{ role: 'user', content: prompt }], {
      maxTokens: 1000,
      model: 'claude-sonnet-4-6',
    });
    return res.json({ text });
  } catch (e) {
    console.error('[ai-report]', e.message);
    return res.status(502).json({ error: e.message });
  }
}
