// ============================================================
// dashboard-ui.ts — self-contained HTML dashboard module
// Produces a vanilla-JS dark-mode dashboard that polls the
// dashboard-server JSON endpoints.  No external dependencies.
// ============================================================

// ────────────────────────────────────────────────────────────
// Theme constants
// ────────────────────────────────────────────────────────────

export const DEFAULT_THEME: {
  background: string;
  foreground: string;
  accent: string;
  warn: string;
  error: string;
} = {
  background: '#0f1117',
  foreground: '#e2e8f0',
  accent: '#4f9eff',
  warn: '#f6c90e',
  error: '#f87171',
};

// ────────────────────────────────────────────────────────────
// Escape helpers (also used by tests)
// ────────────────────────────────────────────────────────────

/** Escape a string for safe insertion into HTML text / attribute values. */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape a string for safe insertion inside a JS double-quoted string literal. */
function escapeJsString(s: string): string {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

// ────────────────────────────────────────────────────────────
// buildDashboardSnapshot — pure server-side data transform
// ────────────────────────────────────────────────────────────

export interface DashboardTab {
  id: string;
  label: string;
  sections: Array<{ type: string; [key: string]: unknown }>;
}

export interface DashboardSnapshot {
  tabs: DashboardTab[];
}

export function buildDashboardSnapshot(input: {
  uptime?: number;
  sessions?: any[];
  skills?: any[];
  lessons?: any[];
  budget?: any;
  metrics?: any;
  events?: any[];
}): DashboardSnapshot {
  const {
    uptime,
    sessions = [],
    skills = [],
    lessons = [],
    budget = null,
    metrics = {},
    events = [],
  } = input;

  const uptimeVal = uptime ?? metrics?.uptime ?? null;
  const totalSessions = metrics?.totalSessions ?? sessions.length;
  const activeProviders = metrics?.activeProviders ?? 0;
  const errorRate = metrics?.errorRate ?? 0;

  return {
    tabs: [
      {
        id: 'overview',
        label: 'Overview',
        sections: [
          {
            type: 'cards',
            items: [
              { label: 'Uptime', value: uptimeVal != null ? `${uptimeVal}s` : '—' },
              { label: 'Total Sessions', value: totalSessions },
              { label: 'Active Providers', value: activeProviders },
              { label: 'Error Rate', value: `${(errorRate * 100).toFixed(1)}%` },
            ],
          },
        ],
      },
      {
        id: 'sessions',
        label: 'Sessions',
        sections: [{ type: 'table', rows: sessions }],
      },
      {
        id: 'skills',
        label: 'Skills',
        sections: [{ type: 'table', rows: skills }],
      },
      {
        id: 'lessons',
        label: 'Lessons',
        sections: [{ type: 'table', rows: lessons }],
      },
      {
        id: 'budget',
        label: 'Budget',
        sections: [{ type: 'object', data: budget }],
      },
      {
        id: 'events',
        label: 'Events',
        sections: [{ type: 'table', rows: events }],
      },
    ],
  };
}

// ────────────────────────────────────────────────────────────
// HTML template — placeholders replaced by renderDashboardHtml
//   __TITLE__    → HTML-escaped page title
//   __POLL_MS__  → integer poll interval in ms
//   __BASE_PATH__ → JS-string-escaped base path
//
// IMPORTANT: the embedded <script> uses only ES5-style code
// with single/double quoted strings — NO backticks — so the
// outer TypeScript template literal has no nesting issues.
// ────────────────────────────────────────────────────────────

const HTML_TEMPLATE =
  '<!DOCTYPE html>\n' +
  '<html lang="en">\n' +
  '<head>\n' +
  '  <meta charset="utf-8" />\n' +
  '  <meta name="viewport" content="width=device-width,initial-scale=1" />\n' +
  '  <title>__TITLE__</title>\n' +
  '  <style>\n' +
  '    :root {\n' +
  '      --bg: #0f1117;\n' +
  '      --fg: #e2e8f0;\n' +
  '      --accent: #4f9eff;\n' +
  '      --warn: #f6c90e;\n' +
  '      --error: #f87171;\n' +
  '      --surface: #1a1d27;\n' +
  '      --border: #2d3147;\n' +
  '      --muted: #64748b;\n' +
  '    }\n' +
  '    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n' +
  '    body {\n' +
  '      background: var(--bg); color: var(--fg);\n' +
  '      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;\n' +
  '      font-size: 14px; line-height: 1.6;\n' +
  '    }\n' +
  '    header {\n' +
  '      background: var(--surface); border-bottom: 1px solid var(--border);\n' +
  '      padding: 12px 24px; display: flex; align-items: center; justify-content: space-between;\n' +
  '    }\n' +
  '    header h1 { font-size: 1.1rem; font-weight: 600; color: var(--accent); }\n' +
  '    #health-badge {\n' +
  '      font-size: 0.75rem; padding: 2px 10px; border-radius: 12px;\n' +
  '      background: var(--muted); color: var(--bg); font-weight: 600;\n' +
  '    }\n' +
  '    #health-badge.ok { background: #166534; color: #bbf7d0; }\n' +
  '    #health-badge.err { background: #7f1d1d; color: #fecaca; }\n' +
  '    nav {\n' +
  '      background: var(--surface); border-bottom: 1px solid var(--border);\n' +
  '      padding: 0 16px; display: flex; gap: 2px; overflow-x: auto;\n' +
  '    }\n' +
  '    .tab-btn {\n' +
  '      background: none; border: none; color: var(--muted); cursor: pointer;\n' +
  '      font-size: 0.85rem; padding: 10px 16px;\n' +
  '      border-bottom: 2px solid transparent; white-space: nowrap;\n' +
  '      transition: color 0.15s, border-color 0.15s;\n' +
  '    }\n' +
  '    .tab-btn:hover { color: var(--fg); }\n' +
  '    .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }\n' +
  '    main { padding: 24px; max-width: 1200px; margin: 0 auto; }\n' +
  '    .tab-panel { display: none; }\n' +
  '    .tab-panel.active { display: block; }\n' +
  '    .cards {\n' +
  '      display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));\n' +
  '      gap: 16px; margin-bottom: 24px;\n' +
  '    }\n' +
  '    .card {\n' +
  '      background: var(--surface); border: 1px solid var(--border);\n' +
  '      border-radius: 8px; padding: 20px 16px;\n' +
  '    }\n' +
  '    .card-label {\n' +
  '      font-size: 0.7rem; color: var(--muted);\n' +
  '      text-transform: uppercase; letter-spacing: 0.06em;\n' +
  '    }\n' +
  '    .card-value { font-size: 1.6rem; font-weight: 700; color: var(--accent); margin-top: 6px; }\n' +
  '    .section-title {\n' +
  '      font-size: 0.75rem; font-weight: 600; color: var(--muted);\n' +
  '      text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 14px;\n' +
  '    }\n' +
  '    table { width: 100%; border-collapse: collapse; }\n' +
  '    th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--border); }\n' +
  '    th {\n' +
  '      color: var(--muted); font-size: 0.7rem; font-weight: 600;\n' +
  '      text-transform: uppercase; letter-spacing: 0.05em;\n' +
  '      background: var(--surface); position: sticky; top: 0;\n' +
  '    }\n' +
  '    td { font-size: 0.85rem; }\n' +
  '    tr:hover td { background: rgba(79,158,255,0.05); }\n' +
  '    .empty { color: var(--muted); font-style: italic; padding: 16px 0; }\n' +
  '    pre {\n' +
  '      background: var(--surface); border: 1px solid var(--border);\n' +
  '      border-radius: 6px; padding: 16px; overflow-x: auto;\n' +
  '      font-size: 0.8rem; line-height: 1.6; color: var(--fg);\n' +
  '    }\n' +
  '    @media (max-width: 600px) {\n' +
  '      main { padding: 12px; }\n' +
  '      .cards { grid-template-columns: repeat(2, 1fr); }\n' +
  '    }\n' +
  '  </style>\n' +
  '</head>\n' +
  '<body>\n' +
  '  <header>\n' +
  '    <h1>__TITLE__</h1>\n' +
  '    <span id="health-badge">connecting...</span>\n' +
  '  </header>\n' +
  '  <nav>\n' +
  '    <button class="tab-btn active" data-tab="overview">Overview</button>\n' +
  '    <button class="tab-btn" data-tab="sessions">Sessions</button>\n' +
  '    <button class="tab-btn" data-tab="skills">Skills</button>\n' +
  '    <button class="tab-btn" data-tab="lessons">Lessons</button>\n' +
  '    <button class="tab-btn" data-tab="budget">Budget</button>\n' +
  '    <button class="tab-btn" data-tab="events">Events</button>\n' +
  '  </nav>\n' +
  '  <main>\n' +
  '    <section id="tab-overview" class="tab-panel active">\n' +
  '      <div class="cards">\n' +
  '        <div class="card">\n' +
  '          <div class="card-label">Uptime</div>\n' +
  '          <div class="card-value" id="card-uptime">&#8212;</div>\n' +
  '        </div>\n' +
  '        <div class="card">\n' +
  '          <div class="card-label">Total Sessions</div>\n' +
  '          <div class="card-value" id="card-sessions">&#8212;</div>\n' +
  '        </div>\n' +
  '        <div class="card">\n' +
  '          <div class="card-label">Active Providers</div>\n' +
  '          <div class="card-value" id="card-providers">&#8212;</div>\n' +
  '        </div>\n' +
  '        <div class="card">\n' +
  '          <div class="card-label">Error Rate</div>\n' +
  '          <div class="card-value" id="card-error-rate">&#8212;</div>\n' +
  '        </div>\n' +
  '      </div>\n' +
  '    </section>\n' +
  '    <section id="tab-sessions" class="tab-panel">\n' +
  '      <p class="section-title">Sessions</p>\n' +
  '      <div id="sessions-table"><p class="empty">Loading&hellip;</p></div>\n' +
  '    </section>\n' +
  '    <section id="tab-skills" class="tab-panel">\n' +
  '      <p class="section-title">Skills</p>\n' +
  '      <div id="skills-table"><p class="empty">Loading&hellip;</p></div>\n' +
  '    </section>\n' +
  '    <section id="tab-lessons" class="tab-panel">\n' +
  '      <p class="section-title">Lessons</p>\n' +
  '      <div id="lessons-table"><p class="empty">Loading&hellip;</p></div>\n' +
  '    </section>\n' +
  '    <section id="tab-budget" class="tab-panel">\n' +
  '      <p class="section-title">Budget</p>\n' +
  '      <div id="budget-content"><p class="empty">Loading&hellip;</p></div>\n' +
  '    </section>\n' +
  '    <section id="tab-events" class="tab-panel">\n' +
  '      <p class="section-title">Events</p>\n' +
  '      <div id="events-table"><p class="empty">Loading&hellip;</p></div>\n' +
  '    </section>\n' +
  '  </main>\n' +
  '  <script>\n' +
  '    (function () {\n' +
  '      var POLL_MS = __POLL_MS__;\n' +
  '      var BASE_PATH = "__BASE_PATH__";\n' +
  '\n' +
  '      /* ---- tab switching ---- */\n' +
  '      var tabBtns = document.querySelectorAll(".tab-btn");\n' +
  '      var tabPanels = document.querySelectorAll(".tab-panel");\n' +
  '      function activateTab(id) {\n' +
  '        tabBtns.forEach(function (b) {\n' +
  '          b.classList.toggle("active", b.getAttribute("data-tab") === id);\n' +
  '        });\n' +
  '        tabPanels.forEach(function (p) {\n' +
  '          p.classList.toggle("active", p.id === "tab-" + id);\n' +
  '        });\n' +
  '      }\n' +
  '      tabBtns.forEach(function (btn) {\n' +
  '        btn.addEventListener("click", function () {\n' +
  '          activateTab(btn.getAttribute("data-tab"));\n' +
  '        });\n' +
  '      });\n' +
  '\n' +
  '      /* ---- html escaping in client ---- */\n' +
  '      function escHtml(s) {\n' +
  '        return String(s === null || s === undefined ? "" : s)\n' +
  '          .replace(/&/g, "&amp;")\n' +
  '          .replace(/</g, "&lt;")\n' +
  '          .replace(/>/g, "&gt;")\n' +
  '          .replace(/"/g, "&quot;");\n' +
  '      }\n' +
  '\n' +
  '      /* ---- table builder ---- */\n' +
  '      function buildTable(data, container) {\n' +
  '        if (!Array.isArray(data) || data.length === 0) {\n' +
  '          container.innerHTML = "<p class=\\"empty\\">No data</p>";\n' +
  '          return;\n' +
  '        }\n' +
  '        var keys = Object.keys(data[0]);\n' +
  '        var html = "<table><thead><tr>";\n' +
  '        keys.forEach(function (k) { html += "<th>" + escHtml(k) + "</th>"; });\n' +
  '        html += "</tr></thead><tbody>";\n' +
  '        data.forEach(function (row) {\n' +
  '          html += "<tr>";\n' +
  '          keys.forEach(function (k) {\n' +
  '            var v = row[k];\n' +
  '            var cell = v === null || v === undefined ? "" :\n' +
  '              typeof v === "object" ? JSON.stringify(v) : v;\n' +
  '            html += "<td>" + escHtml(cell) + "</td>";\n' +
  '          });\n' +
  '          html += "</tr>";\n' +
  '        });\n' +
  '        html += "</tbody></table>";\n' +
  '        container.innerHTML = html;\n' +
  '      }\n' +
  '\n' +
  '      /* ---- helper to set card value ---- */\n' +
  '      function setCard(id, val) {\n' +
  '        var el = document.getElementById(id);\n' +
  '        if (el) el.textContent = val != null ? String(val) : "—";\n' +
  '      }\n' +
  '\n' +
  '      /* ---- fetch helpers ---- */\n' +
  '      var base = BASE_PATH.replace(/\\/$/, "");\n' +
  '\n' +
  '      function fetchJson(path, cb) {\n' +
  '        fetch(base + path)\n' +
  '          .then(function (r) { return r.json(); })\n' +
  '          .then(cb)\n' +
  '          .catch(function (err) { console.warn("fetch " + path + " failed", err); });\n' +
  '      }\n' +
  '\n' +
  '      /* ---- poll update ---- */\n' +
  '      function update() {\n' +
  '        /* /health */\n' +
  '        fetchJson("/health", function (d) {\n' +
  '          var badge = document.getElementById("health-badge");\n' +
  '          if (!badge) return;\n' +
  '          badge.textContent = d.ok ? "OK" : "DOWN";\n' +
  '          badge.className = "health-badge " + (d.ok ? "ok" : "err");\n' +
  '        });\n' +
  '\n' +
  '        /* /metrics — Overview cards */\n' +
  '        fetchJson("/metrics", function (d) {\n' +
  '          setCard("card-uptime", d.uptime != null ? d.uptime + "s" : null);\n' +
  '          setCard("card-sessions", d.totalSessions);\n' +
  '          setCard("card-providers", d.activeProviders);\n' +
  '          setCard("card-error-rate",\n' +
  '            d.errorRate != null ? (d.errorRate * 100).toFixed(1) + "%" : null);\n' +
  '        });\n' +
  '\n' +
  '        /* /sessions */\n' +
  '        fetchJson("/sessions", function (d) {\n' +
  '          var el = document.getElementById("sessions-table");\n' +
  '          if (el) buildTable(Array.isArray(d) ? d : [], el);\n' +
  '        });\n' +
  '\n' +
  '        /* /skills */\n' +
  '        fetchJson("/skills", function (d) {\n' +
  '          var el = document.getElementById("skills-table");\n' +
  '          if (el) buildTable(Array.isArray(d) ? d : [], el);\n' +
  '        });\n' +
  '\n' +
  '        /* /lessons */\n' +
  '        fetchJson("/lessons", function (d) {\n' +
  '          var el = document.getElementById("lessons-table");\n' +
  '          if (el) buildTable(Array.isArray(d) ? d : [], el);\n' +
  '        });\n' +
  '\n' +
  '        /* /budget */\n' +
  '        fetchJson("/budget", function (d) {\n' +
  '          var el = document.getElementById("budget-content");\n' +
  '          if (el) el.innerHTML = "<pre>" + escHtml(JSON.stringify(d, null, 2)) + "</pre>";\n' +
  '        });\n' +
  '\n' +
  '        /* /events */\n' +
  '        fetchJson("/events", function (d) {\n' +
  '          var el = document.getElementById("events-table");\n' +
  '          if (el) buildTable(Array.isArray(d) ? d : [], el);\n' +
  '        });\n' +
  '      }\n' +
  '\n' +
  '      update();\n' +
  '      setInterval(update, POLL_MS);\n' +
  '    })();\n' +
  '  </script>\n' +
  '</body>\n' +
  '</html>\n';

// ────────────────────────────────────────────────────────────
// renderDashboardHtml — substitutes config into the template
// ────────────────────────────────────────────────────────────

export function renderDashboardHtml(opts?: {
  title?: string;
  pollMs?: number;
  basePath?: string;
}): string {
  const title = opts?.title ?? 'Pyrfor Dashboard';
  const pollMs = opts?.pollMs ?? 5000;
  const basePath = opts?.basePath ?? '';

  return HTML_TEMPLATE
    .replace(/__TITLE__/g, escapeHtml(title))
    .replace(/__POLL_MS__/g, String(Math.trunc(pollMs)))
    .replace(/__BASE_PATH__/g, escapeJsString(basePath));
}

// ────────────────────────────────────────────────────────────
// DASHBOARD_HTML — pre-rendered with all defaults applied
// ────────────────────────────────────────────────────────────

export const DASHBOARD_HTML: string = renderDashboardHtml();
