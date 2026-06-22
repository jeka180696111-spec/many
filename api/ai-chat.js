// /api/ai-chat.js — чат з AI фінансовим радником (Claude → Gemini фолбек)

import { callLLM, getLLMKeys } from './_llm.js';

const SYSTEM = `Ти — саркастичний особистий фінансовий радник на ім'я Фінн.
Стиль: дотепний, їдкий, але з теплотою і турботою. Як старший друг який розбирається в фінансах.
Правила:
- Відповідай УКРАЇНСЬКОЮ
- Будь коротким: 2-5 речень (якщо не просять детальний аналіз)
- Використовуй конкретні цифри якщо вони є
- Хвали за хороші рішення, їдко критикуй за погані
- Емодзі помірно
- Якщо питання не про фінанси — м'яко поверни до теми грошей`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages = [], context = '' } = req.body || {};
  const { gemini, anthropic } = getLLMKeys();
  if (gemini.length === 0 && !anthropic) {
    return res.status(500).json({ error: 'No LLM keys configured (ANTHROPIC_API_KEY or GEMINI_API_KEY_1/2)' });
  }

  const systemWithContext = context
    ? `${SYSTEM}\n\nПоточні фінансові дані користувача:\n${context}`
    : SYSTEM;

  // Очищуємо невалідні записи в історії (Anthropic відкидає пусті content).
  const cleanMessages = (messages || [])
    .filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0)
    .slice(-10);

  try {
    const text = await callLLM(systemWithContext, cleanMessages, { maxTokens: 600 });
    return res.json({ text });
  } catch (e) {
    console.error('[ai-chat]', e.message);
    return res.status(502).json({ error: e.message });
  }
}
