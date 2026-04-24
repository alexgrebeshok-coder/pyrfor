// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  DASHBOARD_HTML,
  renderDashboardHtml,
  buildDashboardSnapshot,
  DEFAULT_THEME,
  escapeHtml,
} from './dashboard-ui';

// ────────────────────────────────────────────────────────────
// DASHBOARD_HTML structural tests
// ────────────────────────────────────────────────────────────

describe('DASHBOARD_HTML structure', () => {
  it('contains <html', () => {
    expect(DASHBOARD_HTML).toContain('<html');
  });

  it('contains <body', () => {
    expect(DASHBOARD_HTML).toContain('<body');
  });

  it('contains <script', () => {
    expect(DASHBOARD_HTML).toContain('<script');
  });

  it('contains <style', () => {
    expect(DASHBOARD_HTML).toContain('<style');
  });

  it('contains Overview tab label', () => {
    expect(DASHBOARD_HTML).toContain('Overview');
  });

  it('contains Sessions tab label', () => {
    expect(DASHBOARD_HTML).toContain('Sessions');
  });

  it('contains Skills tab label', () => {
    expect(DASHBOARD_HTML).toContain('Skills');
  });

  it('contains Lessons tab label', () => {
    expect(DASHBOARD_HTML).toContain('Lessons');
  });

  it('contains Budget tab label', () => {
    expect(DASHBOARD_HTML).toContain('Budget');
  });

  it('contains Events tab label', () => {
    expect(DASHBOARD_HTML).toContain('Events');
  });

  it('contains no external http/https URLs (self-contained)', () => {
    // Strip the JS code in <script> that references fetch() paths — those are
    // relative paths like "/health", not full URLs with scheme+host.
    // We check that there are no absolute external URLs in src/href attributes.
    const noExternalSrc = /src=["']https?:\/\//i.test(DASHBOARD_HTML);
    const noExternalHref = /href=["']https?:\/\//i.test(DASHBOARD_HTML);
    expect(noExternalSrc).toBe(false);
    expect(noExternalHref).toBe(false);
  });

  it('default pollMs is 5000 in the HTML', () => {
    expect(DASHBOARD_HTML).toContain('5000');
  });

  it('fetches /health endpoint', () => {
    expect(DASHBOARD_HTML).toContain('/health');
  });

  it('fetches /metrics endpoint', () => {
    expect(DASHBOARD_HTML).toContain('/metrics');
  });

  it('fetches /sessions endpoint', () => {
    expect(DASHBOARD_HTML).toContain('/sessions');
  });

  it('fetches /skills endpoint', () => {
    expect(DASHBOARD_HTML).toContain('/skills');
  });

  it('fetches /lessons endpoint', () => {
    expect(DASHBOARD_HTML).toContain('/lessons');
  });

  it('fetches /budget endpoint', () => {
    expect(DASHBOARD_HTML).toContain('/budget');
  });

  it('fetches /events endpoint', () => {
    expect(DASHBOARD_HTML).toContain('/events');
  });
});

// ────────────────────────────────────────────────────────────
// renderDashboardHtml
// ────────────────────────────────────────────────────────────

describe('renderDashboardHtml', () => {
  it('uses default title "Pyrfor Dashboard" when no opts', () => {
    const html = renderDashboardHtml();
    expect(html).toContain('Pyrfor Dashboard');
  });

  it('substitutes a custom title in <title>', () => {
    const html = renderDashboardHtml({ title: 'My Custom Dashboard' });
    expect(html).toContain('My Custom Dashboard');
  });

  it('substitutes a custom title in <h1>', () => {
    const html = renderDashboardHtml({ title: 'Agent Control' });
    const h1Match = /<h1[^>]*>([^<]*)<\/h1>/i.exec(html);
    expect(h1Match).not.toBeNull();
    expect(h1Match![1]).toContain('Agent Control');
  });

  it('substitutes pollMs as a bare number in JS', () => {
    const html = renderDashboardHtml({ pollMs: 3000 });
    // POLL_MS = 3000 — the value must appear as a number literal, not a quoted string
    expect(html).toMatch(/POLL_MS\s*=\s*3000[^"']/);
  });

  it('default pollMs is 5000', () => {
    const html = renderDashboardHtml();
    expect(html).toMatch(/POLL_MS\s*=\s*5000[^"']/);
  });

  it('substitutes basePath into fetch base variable in JS', () => {
    const html = renderDashboardHtml({ basePath: '/api/v1' });
    expect(html).toContain('/api/v1');
  });

  it('escapes HTML in title — <script> becomes &lt;script&gt;', () => {
    const html = renderDashboardHtml({ title: '<script>' });
    expect(html).toContain('&lt;script&gt;');
    // the raw string must NOT appear unescaped in the title/h1 positions
    const titleTagContent = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '';
    expect(titleTagContent).not.toContain('<script>');
  });

  it('escapes & in title', () => {
    const html = renderDashboardHtml({ title: 'A & B' });
    expect(html).toContain('A &amp; B');
  });

  it('escapes " in title', () => {
    const html = renderDashboardHtml({ title: 'Say "hello"' });
    expect(html).toContain('&quot;');
  });

  it('basePath with backtick does not leave unescaped backtick in <script>', () => {
    const html = renderDashboardHtml({ basePath: '/path`with`ticks' });
    // Grab everything inside the first <script> block
    const scriptMatch = /<script>([\s\S]*?)<\/script>/i.exec(html);
    expect(scriptMatch).not.toBeNull();
    const scriptContent = scriptMatch![1];
    // The raw backtick should be escaped in the JS string literal
    expect(scriptContent).not.toContain('`with`');
  });

  it('returns a complete HTML document with closing tags', () => {
    const html = renderDashboardHtml();
    expect(html).toContain('</html>');
    expect(html).toContain('</body>');
  });
});

// ────────────────────────────────────────────────────────────
// buildDashboardSnapshot
// ────────────────────────────────────────────────────────────

describe('buildDashboardSnapshot', () => {
  it('returns exactly 6 tabs with empty input', () => {
    const snap = buildDashboardSnapshot({});
    expect(snap.tabs).toHaveLength(6);
  });

  it('tab ids are overview, sessions, skills, lessons, budget, events', () => {
    const snap = buildDashboardSnapshot({});
    const ids = snap.tabs.map(t => t.id);
    expect(ids).toEqual(['overview', 'sessions', 'skills', 'lessons', 'budget', 'events']);
  });

  it('tab labels are Overview, Sessions, Skills, Lessons, Budget, Events', () => {
    const snap = buildDashboardSnapshot({});
    const labels = snap.tabs.map(t => t.label);
    expect(labels).toEqual(['Overview', 'Sessions', 'Skills', 'Lessons', 'Budget', 'Events']);
  });

  it('Overview section shows uptime from direct input', () => {
    const snap = buildDashboardSnapshot({ uptime: 300 });
    const overview = snap.tabs.find(t => t.id === 'overview')!;
    const cards = (overview.sections[0] as any).items as any[];
    const uptimeCard = cards.find((c: any) => c.label === 'Uptime');
    expect(uptimeCard.value).toBe('300s');
  });

  it('Overview section shows uptime from metrics fallback', () => {
    const snap = buildDashboardSnapshot({ metrics: { uptime: 99 } });
    const overview = snap.tabs.find(t => t.id === 'overview')!;
    const cards = (overview.sections[0] as any).items as any[];
    const uptimeCard = cards.find((c: any) => c.label === 'Uptime');
    expect(uptimeCard.value).toBe('99s');
  });

  it('Overview uptime is "—" when not provided', () => {
    const snap = buildDashboardSnapshot({});
    const overview = snap.tabs.find(t => t.id === 'overview')!;
    const cards = (overview.sections[0] as any).items as any[];
    const uptimeCard = cards.find((c: any) => c.label === 'Uptime');
    expect(uptimeCard.value).toBe('—');
  });

  it('Sessions tab rows reflect input array', () => {
    const sessions = [{ id: 's1', status: 'active' }, { id: 's2', status: 'done' }];
    const snap = buildDashboardSnapshot({ sessions });
    const sessionTab = snap.tabs.find(t => t.id === 'sessions')!;
    expect((sessionTab.sections[0] as any).rows).toEqual(sessions);
  });

  it('Sessions tab rows are empty array when not provided', () => {
    const snap = buildDashboardSnapshot({});
    const sessionTab = snap.tabs.find(t => t.id === 'sessions')!;
    expect((sessionTab.sections[0] as any).rows).toEqual([]);
  });

  it('Skills tab rows reflect input array', () => {
    const skills = [{ name: 'reasoning', score: 0.9 }];
    const snap = buildDashboardSnapshot({ skills });
    const skillTab = snap.tabs.find(t => t.id === 'skills')!;
    expect((skillTab.sections[0] as any).rows).toEqual(skills);
  });

  it('Lessons tab rows reflect input array', () => {
    const lessons = [{ text: 'retry on 429', createdAt: '2024-01-01' }];
    const snap = buildDashboardSnapshot({ lessons });
    const lessonsTab = snap.tabs.find(t => t.id === 'lessons')!;
    expect((lessonsTab.sections[0] as any).rows).toEqual(lessons);
  });

  it('Budget section data reflects input object', () => {
    const budget = { limit: 10, used: 3.5, currency: 'USD' };
    const snap = buildDashboardSnapshot({ budget });
    const budgetTab = snap.tabs.find(t => t.id === 'budget')!;
    expect((budgetTab.sections[0] as any).data).toEqual(budget);
  });

  it('Budget section data is null when not provided', () => {
    const snap = buildDashboardSnapshot({});
    const budgetTab = snap.tabs.find(t => t.id === 'budget')!;
    expect((budgetTab.sections[0] as any).data).toBeNull();
  });

  it('Events tab rows reflect input array', () => {
    const events = [{ type: 'session.start', ts: 1700000000 }];
    const snap = buildDashboardSnapshot({ events });
    const eventsTab = snap.tabs.find(t => t.id === 'events')!;
    expect((eventsTab.sections[0] as any).rows).toEqual(events);
  });

  it('Overview totalSessions falls back to sessions.length', () => {
    const snap = buildDashboardSnapshot({ sessions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    const overview = snap.tabs.find(t => t.id === 'overview')!;
    const cards = (overview.sections[0] as any).items as any[];
    const sessCard = cards.find((c: any) => c.label === 'Total Sessions');
    expect(sessCard.value).toBe(3);
  });

  it('Overview errorRate formats as percentage', () => {
    const snap = buildDashboardSnapshot({ metrics: { errorRate: 0.123 } });
    const overview = snap.tabs.find(t => t.id === 'overview')!;
    const cards = (overview.sections[0] as any).items as any[];
    const errCard = cards.find((c: any) => c.label === 'Error Rate');
    expect(errCard.value).toBe('12.3%');
  });
});

// ────────────────────────────────────────────────────────────
// DEFAULT_THEME
// ────────────────────────────────────────────────────────────

describe('DEFAULT_THEME', () => {
  it('has background key', () => {
    expect(DEFAULT_THEME).toHaveProperty('background');
  });

  it('has foreground key', () => {
    expect(DEFAULT_THEME).toHaveProperty('foreground');
  });

  it('has accent key', () => {
    expect(DEFAULT_THEME).toHaveProperty('accent');
  });

  it('has warn key', () => {
    expect(DEFAULT_THEME).toHaveProperty('warn');
  });

  it('has error key', () => {
    expect(DEFAULT_THEME).toHaveProperty('error');
  });

  it('has exactly 5 keys', () => {
    expect(Object.keys(DEFAULT_THEME)).toHaveLength(5);
  });

  it('background is a CSS hex color', () => {
    expect(DEFAULT_THEME.background).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  });

  it('accent is a CSS hex color', () => {
    expect(DEFAULT_THEME.accent).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  });
});

// ────────────────────────────────────────────────────────────
// escapeHtml invariants
// ────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes < to &lt;', () => {
    expect(escapeHtml('<')).toBe('&lt;');
  });

  it('escapes > to &gt;', () => {
    expect(escapeHtml('>')).toBe('&gt;');
  });

  it('escapes & to &amp;', () => {
    expect(escapeHtml('&')).toBe('&amp;');
  });

  it('escapes " to &quot;', () => {
    expect(escapeHtml('"')).toBe('&quot;');
  });

  it("escapes ' to &#39;", () => {
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('round-trip: escaping a safe string twice increases entity count', () => {
    const once = escapeHtml('<b>');
    const twice = escapeHtml(once);
    // double-escaping should contain &amp; (the & of &lt; gets escaped again)
    expect(twice).toContain('&amp;');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('converts non-string via String()', () => {
    expect(escapeHtml(42 as unknown as string)).toBe('42');
  });
});
