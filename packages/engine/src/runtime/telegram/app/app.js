/* Pyrfor Mini App — app.js
 * Vanilla JS, no build step, no frameworks.
 * TODO: implement server-side Telegram.WebApp.initData validation (currently deferred, MVP).
 */

'use strict';

// ── Telegram WebApp init ──────────────────────────────────────────────────

const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  applyTelegramTheme();
  tg.onEvent('themeChanged', applyTelegramTheme);
}

function applyTelegramTheme() {
  if (!tg || !tg.themeParams) return;
  const p = tg.themeParams;
  const map = {
    '--bg': p.bg_color,
    '--secondary-bg': p.secondary_bg_color,
    '--text': p.text_color,
    '--hint': p.hint_color,
    '--link': p.link_color,
    '--button': p.button_color,
    '--button-text': p.button_text_color,
    '--header-bg': p.header_bg_color || p.bg_color,
    '--bottom-bar-bg': p.bottom_bar_bg_color || p.secondary_bg_color,
    '--card-bg': p.bg_color,
    '--border': p.secondary_bg_color,
  };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(map)) {
    if (v) root.style.setProperty(k, v);
  }
}

// ── Auth helper ───────────────────────────────────────────────────────────

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (tg && tg.initData) {
    // TODO: validate initData server-side using HMAC-SHA256
    h['X-Telegram-Init-Data'] = tg.initData;
  }
  return h;
}

async function api(method, path, body) {
  const opts = { method, headers: authHeaders() };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ── Tab switching ─────────────────────────────────────────────────────────

let activeTab = 'dashboard';
const tabLoaders = {};

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (tab === activeTab) return;
    activeTab = tab;

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');

    if (tabLoaders[tab]) tabLoaders[tab]();
  });
});

// ── Dashboard ─────────────────────────────────────────────────────────────

async function loadDashboard() {
  try {
    const d = await api('GET', '/api/dashboard');
    document.getElementById('dash-model').textContent = d.model || '—';
    document.getElementById('dash-cost').textContent = d.costToday != null
      ? '$' + Number(d.costToday).toFixed(4) : '—';
    document.getElementById('dash-sessions').textContent = d.sessionsCount ?? '—';

    const statusDot = document.getElementById('header-status');
    statusDot.className = 'status-dot ' + (d.status === 'running' ? 'ok' : 'err');

    // Active goals
    const goalsEl = document.getElementById('dash-goals');
    const goals = (d.activeGoals || []).slice(0, 3);
    goalsEl.innerHTML = goals.length
      ? goals.map(g => `<div class="list-item"><span class="item-text">${esc(g.description)}</span><span class="badge badge-active">active</span></div>`).join('')
      : '<div class="empty-state">Нет активных целей</div>';

    // Recent activity
    const actEl = document.getElementById('dash-activity');
    const acts = (d.recentActivity || []).slice(0, 10);
    actEl.innerHTML = acts.length
      ? acts.map(g => `<div class="list-item"><span class="item-text">${esc(g.description)}</span><span class="badge badge-${g.status}">${g.status}</span></div>`).join('')
      : '<div class="empty-state">Нет активности</div>';
  } catch (e) {
    console.error('[pyrfor] dashboard error', e);
    const msg = e?.message || 'Недоступно';
    renderError(document.getElementById('dash-goals'), loadDashboard, msg);
    renderError(document.getElementById('dash-activity'), loadDashboard, msg);
    document.getElementById('header-status').className = 'status-dot err';
  }
}

tabLoaders['dashboard'] = loadDashboard;

// Auto-refresh dashboard every 10s (paused when tab is hidden)
setInterval(() => {
  if (activeTab === 'dashboard' && !document.hidden) loadDashboard();
}, 10000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && activeTab === 'dashboard') loadDashboard();
});

// ── Goals ─────────────────────────────────────────────────────────────────

async function loadGoals() {
  try {
    const goals = await api('GET', '/api/goals');
    const active = goals.filter(g => g.status === 'active');
    const done = goals.filter(g => g.status !== 'active');

    const activeEl = document.getElementById('goals-active');
    activeEl.innerHTML = active.length
      ? active.map(g => `
        <div class="list-item">
          <div class="item-text">${esc(g.description)}</div>
          <div class="item-actions">
            <button class="btn btn-sm btn-success" onclick="goalDone('${g.id}')">✓</button>
            <button class="btn btn-sm btn-danger" onclick="goalCancel('${g.id}')">✕</button>
          </div>
        </div>`).join('')
      : '<div class="empty-state">Нет активных целей</div>';

    const doneEl = document.getElementById('goals-done');
    doneEl.innerHTML = done.length
      ? done.map(g => `
        <div class="list-item">
          <div class="item-text">${esc(g.description)}</div>
          <span class="badge badge-${g.status}">${g.status}</span>
        </div>`).join('')
      : '<div class="empty-state">Нет завершённых целей</div>';
  } catch (e) {
    console.error('[pyrfor] goals error', e);
    renderError(document.getElementById('goals-active'), loadGoals, e?.message);
    renderError(document.getElementById('goals-done'), loadGoals, e?.message);
  }
}

tabLoaders['goals'] = loadGoals;

async function goalDone(id) {
  try {
    await api('POST', `/api/goals/${id}/done`);
    loadGoals();
  } catch (e) {
    console.error(e);
    showToast?.('Не удалось завершить цель', 'err');
  }
}

async function goalCancel(id) {
  try {
    await api('DELETE', `/api/goals/${id}`);
    loadGoals();
  } catch (e) {
    console.error(e);
    showToast?.('Не удалось удалить цель', 'err');
  }
}

// New goal form
const btnNew = document.getElementById('btn-new-goal');
const form = document.getElementById('new-goal-form');
const btnCancelNew = document.getElementById('btn-cancel-new');
const btnSave = document.getElementById('btn-save-goal');

btnNew.addEventListener('click', () => form.classList.remove('hidden'));
btnCancelNew.addEventListener('click', () => {
  form.classList.add('hidden');
  document.getElementById('goal-title').value = '';
  document.getElementById('goal-desc').value = '';
});
btnSave.addEventListener('click', async () => {
  const title = document.getElementById('goal-title').value.trim();
  if (!title) return;
  try {
    await api('POST', '/api/goals', { title, description: document.getElementById('goal-desc').value.trim() || undefined });
    btnCancelNew.click();
    loadGoals();
  } catch (e) {
    console.error(e);
    const errDiv = document.getElementById('new-goal-form').querySelector('.save-error')
      || (() => {
        const d = document.createElement('div');
        d.className = 'feedback err save-error';
        document.getElementById('new-goal-form').appendChild(d);
        return d;
      })();
    errDiv.textContent = '✕ ' + esc(e?.message || 'Ошибка сохранения');
    errDiv.classList.remove('hidden');
  }
});

// ── Agents ────────────────────────────────────────────────────────────────

async function loadAgents() {
  // TODO: expose subagents API from runtime — re-enable nav button when /api/agents returns real data
  const el = document.getElementById('agents-list');
  el.innerHTML = '<div class="empty-state">Функция в разработке</div>';
}

tabLoaders['agents'] = loadAgents;

// ── Memory ────────────────────────────────────────────────────────────────

async function loadMemory() {
  try {
    const data = await api('GET', '/api/memory');
    const memEl = document.getElementById('memory-content');
    memEl.textContent = (data.lines || []).join('\n') || '(пусто)';

    const filesEl = document.getElementById('memory-files');
    const files = data.files || [];
    filesEl.innerHTML = files.length
      ? files.map(f => `<div class="list-item"><span class="item-text">${esc(f)}</span></div>`).join('')
      : '<div class="empty-state">Нет файлов</div>';
  } catch (e) {
    console.error('[pyrfor] memory error', e);
    renderError(document.getElementById('memory-content'), loadMemory, e?.message);
    renderError(document.getElementById('memory-files'), loadMemory, e?.message);
  }
}

tabLoaders['memory'] = loadMemory;

// ── Settings ──────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const s = await api('GET', '/api/settings');
    document.getElementById('set-default-action').value = s.defaultAction || 'ask';
    document.getElementById('set-whitelist').value = (s.whitelist || []).join(', ');
    document.getElementById('set-blacklist').value = (s.blacklist || []).join(', ');
  } catch (e) {
    console.error('[pyrfor] settings error', e);
    const fb = document.getElementById('settings-feedback');
    fb.textContent = '⚠️ Ошибка загрузки настроек: ' + esc(e?.message || 'неизвестно');
    fb.className = 'feedback err';
    fb.classList.remove('hidden');
  }
}

tabLoaders['settings'] = loadSettings;

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const fb = document.getElementById('settings-feedback');
  try {
    const defaultAction = document.getElementById('set-default-action').value;
    const wlRaw = document.getElementById('set-whitelist').value;
    const blRaw = document.getElementById('set-blacklist').value;
    const whitelist = wlRaw ? wlRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const blacklist = blRaw ? blRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    await api('POST', '/api/settings', { defaultAction, whitelist, blacklist });
    fb.textContent = '✓ Сохранено';
    fb.className = 'feedback ok';
  } catch (e) {
    fb.textContent = '✕ Ошибка: ' + e.message;
    fb.className = 'feedback err';
  }
  fb.classList.remove('hidden');
  setTimeout(() => fb.classList.add('hidden'), 3000);
});

// ── Utils ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderError(containerEl, loaderFn, message) {
  containerEl.innerHTML =
    `<div class="feedback err" style="margin:8px 0">
       ⚠️ ${esc(message || 'Ошибка загрузки')}
       <button class="btn btn-sm btn-secondary" style="margin-left:8px" data-retry>Повторить</button>
     </div>`;
  containerEl.querySelector('[data-retry]').addEventListener('click', loaderFn);
}

// ── Initial load ──────────────────────────────────────────────────────────
loadDashboard();
