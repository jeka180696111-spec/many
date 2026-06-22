// Спільний шар викликів LLM: Claude (основний) → Gemini key 1 → Gemini key 2 (фолбек).
// Той самий каскад що і в _telegram-core.js (Фінн).

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export function getLLMKeys() {
  const gemini = [process.env.GEMINI_API_KEY_1, process.env.GEMINI_API_KEY_2]
    .filter(k => k && k.trim().length > 0);
  return { gemini, anthropic: process.env.ANTHROPIC_API_KEY || null };
}

async function callAnthropic(systemPrompt, messages, apiKey, opts = {}) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: opts.model || 'claude-haiku-4-5-20251001',
      max_tokens: opts.maxTokens || 500,
      system: systemPrompt,
      messages,
    }),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`Anthropic ${response.status}: ${data.error?.message || data.error?.type || 'unknown'}`);
  }
  const text = data.content?.filter(c => c.type === 'text').map(c => c.text).join('\n');
  if (!text) throw new Error('Anthropic empty response');
  return text;
}

async function callGemini(systemPrompt, messages, apiKey, opts = {}) {
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : String(m.content) }],
  }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { maxOutputTokens: opts.maxTokens || 500, temperature: opts.temperature ?? 0.7 },
    }),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`Gemini ${response.status}: ${data.error?.message || 'unknown'}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n');
  if (!text) throw new Error('Gemini empty response');
  return text;
}

export async function callLLM(systemPrompt, messages, opts = {}) {
  const { gemini, anthropic } = getLLMKeys();
  const errors = [];
  if (anthropic) {
    try { return await callAnthropic(systemPrompt, messages, anthropic, opts); }
    catch (e) { errors.push(`anthropic: ${e.message}`); console.warn('[callLLM] anthropic fail:', e.message); }
  }
  for (const key of gemini) {
    try { return await callGemini(systemPrompt, messages, key, opts); }
    catch (e) { errors.push(`gemini: ${e.message}`); console.warn('[callLLM] gemini fail:', e.message); }
  }
  throw new Error(errors.join(' | ') || 'no LLM key configured');
}

// ── Vision (для розпізнавання чеків) ──────────────────────
async function callAnthropicVision(systemPrompt, promptText, base64Image, mediaType, apiKey, opts = {}) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: opts.model || 'claude-sonnet-4-6',
      max_tokens: opts.maxTokens || 512,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
          { type: 'text', text: promptText },
        ],
      }],
    }),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`Anthropic vision ${response.status}: ${data.error?.message || data.error?.type || 'unknown'}`);
  }
  const text = (data.content?.[0]?.text || '').trim();
  if (!text) throw new Error('Anthropic vision empty response');
  return text;
}

async function callGeminiVision(systemPrompt, promptText, base64Image, mediaType, apiKey, opts = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: mediaType, data: base64Image } },
          { text: promptText },
        ],
      }],
      generationConfig: { maxOutputTokens: opts.maxTokens || 512, temperature: opts.temperature ?? 0.2 },
    }),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`Gemini vision ${response.status}: ${data.error?.message || 'unknown'}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n')?.trim();
  if (!text) throw new Error('Gemini vision empty response');
  return text;
}

export async function callLLMVision(systemPrompt, promptText, base64Image, mediaType, opts = {}) {
  const { gemini, anthropic } = getLLMKeys();
  const errors = [];
  if (anthropic) {
    try { return await callAnthropicVision(systemPrompt, promptText, base64Image, mediaType, anthropic, opts); }
    catch (e) { errors.push(`anthropic: ${e.message}`); console.warn('[callLLMVision] anthropic fail:', e.message); }
  }
  for (const key of gemini) {
    try { return await callGeminiVision(systemPrompt, promptText, base64Image, mediaType, key, opts); }
    catch (e) { errors.push(`gemini: ${e.message}`); console.warn('[callLLMVision] gemini fail:', e.message); }
  }
  throw new Error(errors.join(' | ') || 'no LLM key configured');
}
