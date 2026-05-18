// ═══════════════════════════════════════════════════════════════
// PAYWALL — модальне вікно підписки Money Budget Pro
// ═══════════════════════════════════════════════════════════════

import { openModal, closeModal } from './modals.js';
import { showToast } from './utils.js';
import { state } from './config.js';

async function startCheckout(plan, trial, btn) {
  if (!state.familyId) {
    showToast('Спочатку увійдіть в акаунт', 'error');
    return;
  }
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="pw-price">Зачекайте…</span>'; }
  try {
    const res = await fetch('/api/stripe-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ familyId: state.familyId, plan, trial: !!trial }),
    });
    const data = await res.json();
    if (!res.ok || !data.url) throw new Error(data.error || 'Помилка створення оплати');
    window.location.href = data.url;
  } catch (e) {
    showToast(e.message || 'Не вдалося перейти до оплати', 'error');
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
      <button class="pw-btn-trial" id="pw-trial-btn">
        Спробувати 7 днів безкоштовно
      </button>
      <div class="pw-cancel-hint">Скасувати в будь-який час</div>
    </div>
  `;

  const modalId = openModal({
    content,
    sheet: true,
    size: 'lg',
    onOpen(wrap) {
      wrap.querySelector('#pw-subscribe-btn')?.addEventListener('click', (e) => {
        startCheckout(plan, false, e.currentTarget);
      });
      wrap.querySelector('#pw-trial-btn')?.addEventListener('click', (e) => {
        startCheckout(plan, true, e.currentTarget);
      });
    },
  });

  return modalId;
}
