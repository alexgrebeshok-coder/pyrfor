export interface CodeBlock {
  lang: string;
  path: string | null;
  content: string;
  index: number;
}

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g;

function parseHeader(header: string): { lang: string; path: string | null } {
  const trimmed = header.trim();
  if (!trimmed) return { lang: '', path: null };

  // Try lang:path syntax first
  const colonIdx = trimmed.indexOf(':');
  const spaceIdx = trimmed.indexOf(' ');

  if (colonIdx !== -1 && (spaceIdx === -1 || colonIdx < spaceIdx)) {
    const lang = trimmed.slice(0, colonIdx);
    const rest = trimmed.slice(colonIdx + 1).trim();
    if (rest) return { lang, path: rest };
  }

  // lang attr=value or lang followed by attrs
  const tokens = trimmed.split(/\s+/);
  const lang = tokens.shift() || '';
  for (const tok of tokens) {
    const eq = tok.indexOf('=');
    if (eq !== -1) {
      const key = tok.slice(0, eq);
      let val = tok.slice(eq + 1);
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key === 'file' || key === 'path') {
        return { lang, path: val };
      }
    }
  }
  return { lang, path: null };
}

export function parseCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const re = new RegExp(FENCE_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const { lang, path } = parseHeader(m[1]);
    blocks.push({ lang, path, content: m[2], index: m.index });
  }
  return blocks;
}
