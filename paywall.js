// ═══════════════════════════════════════════════════════════════
// PAYWALL — модальне вікно підписки Money Budget Pro (Paddle Checkout)
// ═══════════════════════════════════════════════════════════════

import { openModal } from './modals.js';
import { showToast } from './utils.js';
import { state } from './config.js';

let _cfg = null;
let _ready = null;

async function getConfig() {
  if (_cfg) return _cfg;
  const res = await fetch('/api/paddle-config');
  if (!res.ok) throw new Error('Оплата тимчасово недоступна');
  _cfg = await res.json();
  return _cfg;
}

function loadPaddleScript() {
  return new Promise((resolve, reject) => {
    if (window.Paddle) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Не вдалося завантажити Paddle'));
    document.head.appendChild(s);
  });
}

async function ensurePaddle() {
  if (_ready) return _ready;
  _ready = (async () => {
    const cfg = await getConfig();
    await loadPaddleScript();
    if (cfg.environment === 'sandbox') {
      window.Paddle.Environment.set('sandbox');
    }
    window.Paddle.Initialize({
      token: cfg.token,
      eventCallback(ev) {
        if (ev.name === 'checkout.completed') {
          showToast('🎉 Дякуємо! Активуємо Pro…', 'success');
        }
      },
    });
    return cfg;
  })();
  return _ready;
}

async function startCheckout(plan, btn) {
  if (!state.familyId) {
    showToast('Спочатку увійдіть в акаунт', 'error');
    return;
  }
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="pw-price">Зачекайте…</span>'; }
  try {
    const cfg = await ensurePaddle();
    const priceId = cfg.prices?.[plan] || cfg.prices?.month;
    if (!priceId) throw new Error('Цей план поки недоступний');

    const dark = document.documentElement.getAttribute('data-theme') === 'dark';

    window.Paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customData: { familyId: state.familyId },
      customer: state.user?.email ? { email: state.user.email } : undefined,
      settings: {
        displayMode: 'overlay',
        theme: dark ? 'dark' : 'light',
        successUrl: location.origin + '/?pro=success',
      },
    });
  } catch (e) {
    showToast(e.message || 'Не вдалося перейти до оплати', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

const FEATURES = [
  { icon: 'ti-robot',          label: 'AI-помічник Фінн' },
  { icon: 'ti-users',          label: 'Необмежена родина' },
  { icon: 'ti-brand-telegram', label: 'Telegram-бот' },
  { icon: 'ti-scan',           label: 'Сканер чеків' },
  { icon: 'ti-target',         label: 'Цілі та резерв' },
];

const PLANS = {
  week:  { price: '$1.99', period: '/ 7 днів' },
  month: { price: '$4.99', period: '/ місяць' },
  year:  { price: '$49.99', period: '/ рік' },
};

export function showPaywall(plan = 'month') {
  const { price, period } = PLANS[plan] || PLANS.month;

  const featuresHtml = FEATURES.map(f => `
    <div class="pw-feature-row">
      <div class="pw-feature-check">
        <i class="ti ti-check"></i>
      </div>
      <div class="pw-feature-icon">
        <i class="ti ${f.icon}"></i>
      </div>
      <span class="pw-feature-label">${f.label}</span>
    </div>
  `).join('');

  const content = `
    <div class="pw-header">
      <div class="pw-logo">✨</div>
      <div class="pw-title">Money Budget Pro</div>
      <div class="pw-subtitle">Розблокуй всі можливості</div>
    </div>

    <div class="pw-features">
      ${featuresHtml}
    </div>

    <div class="pw-actions">
      <button class="pw-btn-primary" id="pw-subscribe-btn">
        <span class="pw-price">${price}</span>
        <span class="pw-period">${period}</span>
      </button>
      <div class="pw-cancel-hint">7 днів безкоштовно · скасувати будь-коли</div>
    </div>
  `;

  const modalId = openModal({
    content,
    sheet: true,
    size: 'lg',
    onOpen(wrap) {
      wrap.querySelector('#pw-subscribe-btn')?.addEventListener('click', (e) => {
        startCheckout(plan, e.currentTarget);
      });
    },
  });

  return modalId;
}
