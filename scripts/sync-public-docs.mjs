#!/usr/bin/env node
/**
 * Sync allowlisted public docs from docs/ into docs-site/docs/ and regenerate sidebars.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DOCS_SITE = path.join(ROOT, 'docs-site');
const DOCS_OUT = path.join(DOCS_SITE, 'docs');
const ALLOWLIST_PATH = path.join(DOCS_SITE, 'allowlist.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { attrs: {}, body: content };
  const attrs = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    attrs[key] = value;
  }
  return { attrs, body: content.slice(match[0].length) };
}

function stringifyFrontmatter(attrs) {
  const lines = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'string' && v.includes(':') ? `"${v}"` : v}`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}

function titleFromMarkdown(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].replace(/\s*←.*$/, '').trim() : undefined;
}

/** Docusaurus doc id: strips leading `NN-` from the final path segment (matches plugin behavior). */
function docusaurusDocId(destRelPath) {
  const withoutExt = destRelPath.replace(/\.md$/i, '');
  const parts = withoutExt.split('/');
  const last = parts[parts.length - 1];
  parts[parts.length - 1] = last.replace(/^\d+-/, '');
  return parts.join('/');
}

function rewriteInternalLinks(body, destRelPath) {
  const destDir = path.dirname(destRelPath);
  const toDocId = (target) => {
    const normalized = target.replace(/\.md$/i, '').replace(/\/index$/i, '');
    if (normalized.startsWith('http') || normalized.startsWith('#')) return null;
    const fromDir = destDir === '.' ? '' : `${destDir}/`;
    const joined = path.posix.normalize(path.posix.join(fromDir, normalized));
    return docusaurusDocId(joined.replace(/^\//, ''));
  };
  const toLink = (docId) => {
    if (destDir !== '.' && docId.startsWith(`${destDir}/`)) {
      return docId.slice(destDir.length + 1);
    }
    return docId;
  };
  return body
    .replace(/\]\(\.\/([^)]+)\)/g, (_full, rel) => {
      const target = rel.split('#')[0];
      const hash = rel.includes('#') ? rel.slice(rel.indexOf('#')) : '';
      const docId = toDocId(target);
      return docId ? `](${toLink(docId)}${hash})` : _full;
    })
    .replace(/\]\((universal-engine\/[^)]+)\)/g, (_full, rel) => {
      const target = rel.split('#')[0];
      const hash = rel.includes('#') ? rel.slice(rel.indexOf('#')) : '';
      const docId = docusaurusDocId(target);
      return `](${toLink(docId)}${hash})`;
    });
}

function writeDoc(destPath, content, meta) {
  const fullPath = `${destPath}.md`;
  ensureDir(path.dirname(fullPath));
  const { attrs, body } = parseFrontmatter(content);
  const merged = {
    ...attrs,
    ...meta,
  };
  const normalizedBody = rewriteInternalLinks(body, path.relative(DOCS_OUT, fullPath));
  fs.writeFileSync(fullPath, stringifyFrontmatter(merged) + normalizedBody, 'utf8');
}

function globReleaseFiles(pattern) {
  const dir = path.join(ROOT, 'docs/releases');
  if (!fs.existsSync(dir)) return [];
  const prefix = 'v';
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.md'))
    .sort()
    .reverse()
    .map((f) => path.join('docs/releases', f));
}

function matchesExclude(relPath, patterns) {
  const normalized = relPath.replace(/\\/g, '/');
  return patterns.some((pattern) => {
    const re = new RegExp(
      `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')}$`,
      'i',
    );
    return re.test(normalized);
  });
}

function clearSyncedOutput(allowlist) {
  for (const group of allowlist.groups) {
    if (group.id === 'universal-engine') {
      const dir = path.join(DOCS_OUT, 'universal-engine');
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
    if (group.id === 'integrations') {
      const integrations = path.join(DOCS_OUT, 'integrations.md');
      const contracts = path.join(DOCS_OUT, 'contracts');
      if (fs.existsSync(integrations)) fs.unlinkSync(integrations);
      if (fs.existsSync(contracts)) fs.rmSync(contracts, { recursive: true, force: true });
    }
    if (group.id === 'releases') {
      const dir = path.join(DOCS_OUT, 'releases');
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

function syncAllowlist() {
  const allowlist = readJson(ALLOWLIST_PATH);
  clearSyncedOutput(allowlist);

  const sidebarGroups = [];

  sidebarGroups.push({
    type: 'category',
    label: 'Getting started',
    collapsed: false,
    items: allowlist.nativeDocs.map((d) => d.id),
  });

  for (const group of allowlist.groups) {
    if (group.glob) {
      const files = globReleaseFiles(group.glob);
      const items = [];
      let position = 1;
      for (const sourceRel of files) {
        if (matchesExclude(sourceRel, allowlist.excludePatterns)) continue;
        const source = path.join(ROOT, sourceRel);
        const base = path.basename(sourceRel, '.md');
        const dest = `releases/${base}`;
        const content = fs.readFileSync(source, 'utf8');
        const docId = docusaurusDocId(dest);
        writeDoc(path.join(DOCS_OUT, dest), content, {
          sidebar_position: position,
          sidebar_label: base,
        });
        items.push(docId);
        position += 1;
      }
      if (items.length) {
        sidebarGroups.push({
          type: 'category',
          label: group.label,
          collapsed: false,
          items,
        });
      }
      continue;
    }

    const items = [];
    for (const entry of group.items) {
      const sourceRel = entry.source;
      if (matchesExclude(sourceRel, allowlist.excludePatterns)) {
        console.warn(`skip (exclude): ${sourceRel}`);
        continue;
      }
      const source = path.join(ROOT, sourceRel);
      if (!fs.existsSync(source)) {
        throw new Error(`allowlisted source missing: ${sourceRel}`);
      }
      const content = fs.readFileSync(source, 'utf8');
      const docId = docusaurusDocId(entry.dest);
      const meta = {
        sidebar_position: entry.sidebar_position,
      };
      if (entry.sidebar_label) meta.sidebar_label = entry.sidebar_label;
      const title = titleFromMarkdown(content);
      if (title && !meta.sidebar_label) meta.sidebar_label = title;
      writeDoc(path.join(DOCS_OUT, entry.dest), content, meta);
      items.push(docId);
    }

    if (items.length) {
      sidebarGroups.push({
        type: 'category',
        label: group.label,
        collapsed: group.id !== 'integrations',
        items,
      });
    }
  }

  const emitValue = (value, indent = 0) => {
    const pad = '  '.repeat(indent);
    if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`;
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    if (Array.isArray(value)) {
      if (!value.length) return '[]';
      return `[\n${value.map((v) => `${pad}  ${emitValue(v, indent + 1)},`).join('\n')}\n${pad}]`;
    }
    const entries = Object.entries(value);
    return `{\n${entries
      .map(([k, v]) => `${pad}  ${k}: ${emitValue(v, indent + 1)},`)
      .join('\n')}\n${pad}}`;
  };

  const sidebarsTs = `// Generated by scripts/sync-public-docs.mjs — do not edit by hand.
import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: ${emitValue(sidebarGroups, 1)},
};

export default sidebars;
`;

  fs.writeFileSync(path.join(DOCS_SITE, 'sidebars.ts'), sidebarsTs, 'utf8');
  console.log(`Synced public docs → ${DOCS_OUT}`);
  console.log(`Updated ${path.join(DOCS_SITE, 'sidebars.ts')}`);
}

syncAllowlist();
