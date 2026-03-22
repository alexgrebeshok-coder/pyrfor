import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadStandardEnvFiles } from './load-standard-env.mjs';

loadStandardEnvFiles();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'mobile-shell-dist');
const outputFile = path.join(outputDir, 'index.html');

const rawUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

if (!rawUrl) {
  throw new Error(
    'NEXT_PUBLIC_APP_URL is required to build the iPhone shell. Set it to the live production app URL or localhost before running the Capacitor sync/build flow.'
  );
}

let appUrl;

try {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  appUrl = parsed.href;
} catch (error) {
  throw new Error(`NEXT_PUBLIC_APP_URL must be a valid absolute http(s) URL. Received "${rawUrl}".`, { cause: error });
}

const escapeHtml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const escapedUrl = escapeHtml(appUrl);
const shell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#08111f" />
    <meta http-equiv="refresh" content="2; url=${escapedUrl}" />
    <title>Opening CEOClaw</title>
    <style>
      :root {
        color-scheme: dark;
        --bg-0: #030712;
        --bg-1: #08111f;
        --bg-2: #10203b;
        --panel: rgba(12, 18, 34, 0.78);
        --panel-border: rgba(148, 163, 184, 0.2);
        --text: #e5eefc;
        --muted: #94a3b8;
        --accent: #67e8f9;
        --accent-2: #f59e0b;
      }

      * { box-sizing: border-box; }
      html, body { height: 100%; }

      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at 20% 18%, rgba(103, 232, 249, 0.18), transparent 24%),
          radial-gradient(circle at 82% 22%, rgba(245, 158, 11, 0.16), transparent 24%),
          radial-gradient(circle at 50% 88%, rgba(99, 102, 241, 0.12), transparent 28%),
          linear-gradient(150deg, var(--bg-0), var(--bg-1) 48%, var(--bg-2));
        color: var(--text);
        display: grid;
        place-items: center;
        overflow: hidden;
      }

      body::before,
      body::after {
        content: "";
        position: fixed;
        inset: auto;
        width: 26rem;
        height: 26rem;
        border-radius: 999px;
        filter: blur(42px);
        opacity: 0.34;
        pointer-events: none;
      }

      body::before {
        top: -7rem;
        left: -7rem;
        background: rgba(103, 232, 249, 0.14);
        animation: drift 18s ease-in-out infinite;
      }

      body::after {
        right: -9rem;
        bottom: -10rem;
        background: rgba(245, 158, 11, 0.14);
        animation: drift 20s ease-in-out infinite reverse;
      }

      main {
        position: relative;
        z-index: 1;
        width: min(420px, calc(100vw - 1.5rem));
        padding: 1rem;
      }

      .card {
        position: relative;
        overflow: hidden;
        border: 1px solid var(--panel-border);
        border-radius: 30px;
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.88), rgba(8, 15, 28, 0.94));
        box-shadow:
          0 30px 70px rgba(2, 6, 23, 0.54),
          inset 0 1px 0 rgba(255, 255, 255, 0.04);
        padding: 1.6rem;
        backdrop-filter: blur(18px);
      }

      .card::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          linear-gradient(120deg, rgba(103, 232, 249, 0.1), transparent 24%),
          linear-gradient(300deg, rgba(245, 158, 11, 0.08), transparent 28%);
        pointer-events: none;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 1.35rem;
      }

      .mark {
        width: 2.7rem;
        height: 2.7rem;
        border-radius: 16px;
        display: grid;
        place-items: center;
        font-weight: 800;
        letter-spacing: 0.04em;
        color: #04111b;
        background: linear-gradient(135deg, var(--accent), #a7f3d0 50%, var(--accent-2));
        box-shadow: 0 12px 30px rgba(103, 232, 249, 0.24);
      }

      .brand-copy { display: grid; gap: 0.12rem; }
      .eyebrow {
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.22em;
        font-size: 0.69rem;
        color: var(--muted);
      }

      h1 {
        margin: 0 0 0.75rem;
        font-size: clamp(1.95rem, 8vw, 3rem);
        line-height: 0.98;
        letter-spacing: -0.04em;
      }

      p {
        margin: 0;
        color: var(--muted);
        font-size: 0.98rem;
        line-height: 1.65;
      }

      .status {
        display: flex;
        align-items: center;
        gap: 0.8rem;
        margin: 1.6rem 0 1rem;
      }

      .spinner {
        width: 1rem;
        height: 1rem;
        border-radius: 999px;
        border: 2px solid rgba(148, 163, 184, 0.24);
        border-top-color: var(--accent);
        animation: spin 0.9s linear infinite;
      }

      .status strong {
        display: block;
        font-size: 0.95rem;
        font-weight: 600;
      }

      .status span {
        display: block;
        font-size: 0.84rem;
        color: var(--muted);
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.68rem;
        margin-top: 1.25rem;
      }

      .pill,
      .link {
        border-radius: 999px;
        padding: 0.72rem 0.95rem;
        font-size: 0.88rem;
        text-decoration: none;
      }

      .pill {
        background: rgba(148, 163, 184, 0.1);
        border: 1px solid rgba(148, 163, 184, 0.16);
        color: var(--text);
      }

      .link {
        color: #04111b;
        background: linear-gradient(135deg, #67e8f9, #fef08a);
        font-weight: 700;
      }

      .url {
        word-break: break-word;
      }

      noscript {
        display: block;
        margin-top: 1rem;
        color: #fecaca;
        font-size: 0.94rem;
      }

      .scanline {
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.025), transparent);
        opacity: 0.25;
        animation: sweep 5.5s linear infinite;
        pointer-events: none;
      }

      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes drift {
        0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
        50% { transform: translate3d(18px, -12px, 0) scale(1.04); }
      }
      @keyframes sweep {
        0% { transform: translateY(-100%); }
        100% { transform: translateY(100%); }
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation: none !important; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card" aria-live="polite" aria-label="CEOClaw iPhone shell">
        <div class="scanline"></div>
        <div class="brand">
          <div class="mark">C</div>
          <div class="brand-copy">
            <p class="eyebrow">CEOClaw mobile</p>
            <strong>iPhone shell</strong>
          </div>
        </div>

        <h1>Opening CEOClaw on iPhone.</h1>
        <p>
          This shell keeps the native iPhone app thin and forwards you into the live product surface.
          The same data, auth, and workflows are reused everywhere.
        </p>

        <div class="status">
          <div class="spinner" aria-hidden="true"></div>
          <div>
            <strong>Loading product web app</strong>
            <span class="url">${escapedUrl}</span>
          </div>
        </div>

        <div class="meta">
          <span class="pill">Touch-first layout</span>
          <span class="pill">Safe-area aware</span>
          <span class="pill">Shared source of truth</span>
          <a class="link" href="${escapedUrl}">Open now</a>
        </div>

        <noscript>JavaScript is required to continue into the CEOClaw app.</noscript>
      </section>
    </main>
  </body>
</html>`;

await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, shell, 'utf8');
