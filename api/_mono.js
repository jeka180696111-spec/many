// Спільні хелпери для Monobank API.
// Docs: https://api.monobank.ua/docs/

const BASE = 'https://api.monobank.ua';

export async function monoRequest(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'X-Token': token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) {
    const msg = data?.errorDescription || data?.error || text || `HTTP ${res.status}`;
    const err = new Error(`Monobank ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function getClientInfo(token) {
  return monoRequest(token, '/personal/client-info');
}

export function setWebhook(token, webHookUrl) {
  return monoRequest(token, '/personal/webhook', {
    method: 'POST',
    body: { webHookUrl },
  });
}

export function getStatement(token, accountId, fromUnix, toUnix) {
  const path = `/personal/statement/${accountId}/${fromUnix}${toUnix ? '/' + toUnix : ''}`;
  return monoRequest(token, path);
}

// Валюта у Mono — ISO 4217 numeric (980=UAH, 840=USD, 978=EUR).
export const CURRENCY_MAP = {
  980: 'UAH',
  840: 'USD',
  978: 'EUR',
  826: 'GBP',
  985: 'PLN',
  756: 'CHF',
  392: 'JPY',
  756: 'CHF',
};

export function currencyCodeToStr(code) {
  return CURRENCY_MAP[Number(code)] || 'UAH';
}

// Тип рахунку → людське ім'я і чи це кредитка.
export function accountType(acc) {
  // acc.type: 'black' | 'white' | 'platinum' | 'iron' | 'fop' | 'yellow' | 'eAid' etc
  // Наявність creditLimit > 0 і balance може бути > creditLimit (свої гроші зверху).
  const isCredit = Number(acc.creditLimit) > 0;
  return {
    isCredit,
    label:
      acc.type === 'black'    ? 'Моно Чорна' :
      acc.type === 'white'    ? 'Моно Біла'  :
      acc.type === 'platinum' ? 'Моно Platinum' :
      acc.type === 'iron'     ? 'Моно Iron'  :
      acc.type === 'yellow'   ? 'Моно Yellow (юр.)' :
      acc.type === 'fop'      ? 'Моно ФОП' :
      acc.type === 'eAid'     ? 'єПідтримка' :
      `Моно ${acc.type || ''}`.trim(),
  };
}

// Перетворення statementItem від Mono у нашу операцію.
// docs: https://api.monobank.ua/docs/#tag/Publichni-dani/paths/~1personal~1statement~1{account}~1{from}~1{to}/get
// Statement amount у копійках/центах, знак вказує напрямок (мінус = витрата).
export function monoStatementToOp(statementItem, ctx) {
  const {
    accountId,       // mono account id
    accountCurrency, // 'UAH' | 'USD' | ...
    ourCard,         // { id, currency } — наш кошелек до якого прив'язаний
    who,             // 'Євген' | 'Марина'
    categoryFor,     // (mcc, type) => категорія
  } = ctx;

  const rawAmount = Number(statementItem.amount) / 100;      // в валюті рахунку
  const rawOperUah = Number(statementItem.operationAmount) / 100;
  const isExpense = rawAmount < 0;
  const amount = Math.abs(rawAmount);
  const amountUah = Math.round(Math.abs(rawOperUah)); // Mono повертає це в UAH завжди

  const category = categoryFor(statementItem.mcc, isExpense ? 'expense' : 'income');

  const desc = [
    statementItem.description,
    statementItem.comment,
  ].filter(Boolean).join(' · ').slice(0, 200);

  // clientId для ідемпотентності — використовуємо id транзакції Моно.
  // Формат id: 'ZuHWza7fRuUAA1Ki' etc.
  const clientId = `mono:${statementItem.id}`;

  return {
    date: new Date((statementItem.time || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    type: isExpense ? 'Витрата' : 'Дохід',
    category,
    amount,
    currency: accountCurrency,
    amountUah,
    desc,
    who,
    card: ourCard.id,
    source: 'mono',
    monoAccountId: accountId,
    monoTxId: statementItem.id,
    monoMcc: statementItem.mcc,
    clientId,
    createdAt: new Date().toISOString(),
  };
}
