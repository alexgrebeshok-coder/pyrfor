import { describe, it, expect } from 'vitest';
import {
  escapeMarkdownV2,
  escapeHtml,
  sanitize,
} from './markdown-sanitizer';

// ---------------------------------------------------------------------------
// escapeMarkdownV2
// ---------------------------------------------------------------------------
describe('escapeMarkdownV2', () => {
  it('escapes underscore', () => {
    expect(escapeMarkdownV2('hello_world')).toBe('hello\\_world');
  });

  it('escapes asterisk', () => {
    expect(escapeMarkdownV2('bold*text')).toBe('bold\\*text');
  });

  it('escapes square brackets', () => {
    expect(escapeMarkdownV2('[link]')).toBe('\\[link\\]');
  });

  it('escapes round brackets', () => {
    expect(escapeMarkdownV2('(url)')).toBe('\\(url\\)');
  });

  it('escapes tilde', () => {
    expect(escapeMarkdownV2('~spoiler~')).toBe('\\~spoiler\\~');
  });

  it('escapes backtick', () => {
    expect(escapeMarkdownV2('`code`')).toBe('\\`code\\`');
  });

  it('escapes hash', () => {
    expect(escapeMarkdownV2('#heading')).toBe('\\#heading');
  });

  it('escapes plus sign', () => {
    expect(escapeMarkdownV2('1+1')).toBe('1\\+1');
  });

  it('escapes hyphen/minus', () => {
    expect(escapeMarkdownV2('a-b')).toBe('a\\-b');
  });

  it('escapes equals sign', () => {
    expect(escapeMarkdownV2('a=b')).toBe('a\\=b');
  });

  it('escapes pipe', () => {
    expect(escapeMarkdownV2('a|b')).toBe('a\\|b');
  });

  it('escapes curly braces', () => {
    expect(escapeMarkdownV2('{x}')).toBe('\\{x\\}');
  });

  it('escapes dot', () => {
    expect(escapeMarkdownV2('end.')).toBe('end\\.');
  });

  it('escapes exclamation mark', () => {
    expect(escapeMarkdownV2('wow!')).toBe('wow\\!');
  });

  it('escapes greater-than', () => {
    expect(escapeMarkdownV2('a>b')).toBe('a\\>b');
  });

  it('does not double-escape backslashes', () => {
    expect(escapeMarkdownV2('back\\slash')).toBe('back\\\\slash');
  });

  it('leaves plain alphanumeric text unchanged', () => {
    expect(escapeMarkdownV2('Hello World 123')).toBe('Hello World 123');
  });

  it('escapes multiple special chars in one string', () => {
    const result = escapeMarkdownV2('a_b*c[d]');
    expect(result).toBe('a\\_b\\*c\\[d\\]');
  });
});

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------
describe('escapeHtml', () => {
  it('escapes <', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes >', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes &', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes all three in one string', () => {
    expect(escapeHtml('<a & b>')).toBe('&lt;a &amp; b&gt;');
  });

  it('leaves safe text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// sanitize — markdownv2 mode
// ---------------------------------------------------------------------------
describe('sanitize markdownv2', () => {
  it('escapes plain text', () => {
    const { chunks } = sanitize('hello_world!', { mode: 'markdownv2' });
    expect(chunks[0]).toBe('hello\\_world\\!');
  });

  it('preserves balanced fenced code block content verbatim', () => {
    const input = '```js\nconst x = 1;\n```';
    const { chunks } = sanitize(input, { mode: 'markdownv2' });
    expect(chunks[0]).toContain('const x = 1;');
    expect(chunks[0]).toMatch(/^```/);
    expect(chunks[0]).toMatch(/```$/);
  });

  it('does not escape content inside code block', () => {
    const input = '```\n_not_escaped_\n```';
    const { chunks } = sanitize(input, { mode: 'markdownv2' });
    expect(chunks[0]).toContain('_not_escaped_');
  });

  it('escapes text outside code blocks', () => {
    const input = 'hello_world ```\ncode\n``` end!';
    const { chunks } = sanitize(input, { mode: 'markdownv2' });
    expect(chunks[0]).toContain('hello\\_world');
    expect(chunks[0]).toContain('end\\!');
  });

  it('returns truncated=false for short text', () => {
    const { truncated } = sanitize('short', { mode: 'markdownv2' });
    expect(truncated).toBe(false);
  });

  it('returns correct mode in result', () => {
    const { mode } = sanitize('x', { mode: 'markdownv2' });
    expect(mode).toBe('markdownv2');
  });
});

// ---------------------------------------------------------------------------
// sanitize — html mode
// ---------------------------------------------------------------------------
describe('sanitize html', () => {
  it('preserves <b> tag', () => {
    const { chunks } = sanitize('<b>bold</b>', { mode: 'html' });
    expect(chunks[0]).toBe('<b>bold</b>');
  });

  it('preserves <i> tag', () => {
    const { chunks } = sanitize('<i>italic</i>', { mode: 'html' });
    expect(chunks[0]).toBe('<i>italic</i>');
  });

  it('preserves <u> tag', () => {
    const { chunks } = sanitize('<u>under</u>', { mode: 'html' });
    expect(chunks[0]).toBe('<u>under</u>');
  });

  it('preserves <s> tag', () => {
    const { chunks } = sanitize('<s>strike</s>', { mode: 'html' });
    expect(chunks[0]).toBe('<s>strike</s>');
  });

  it('preserves <code> tag', () => {
    const { chunks } = sanitize('<code>x=1</code>', { mode: 'html' });
    expect(chunks[0]).toBe('<code>x=1</code>');
  });

  it('preserves <pre> tag', () => {
    const { chunks } = sanitize('<pre>block</pre>', { mode: 'html' });
    expect(chunks[0]).toBe('<pre>block</pre>');
  });

  it('preserves <a href> tag', () => {
    const { chunks } = sanitize('<a href="https://example.com">link</a>', { mode: 'html' });
    expect(chunks[0]).toBe('<a href="https://example.com">link</a>');
  });

  it('strips <script> tag', () => {
    const { chunks } = sanitize('<script>alert(1)</script>', { mode: 'html' });
    expect(chunks[0]).not.toContain('<script>');
    expect(chunks[0]).not.toContain('</script>');
  });

  it('strips <iframe> tag', () => {
    const { chunks } = sanitize('<iframe src="x"></iframe>', { mode: 'html' });
    expect(chunks[0]).not.toContain('<iframe');
  });

  it('strips <div> tag', () => {
    const { chunks } = sanitize('<div>content</div>', { mode: 'html' });
    expect(chunks[0]).not.toContain('<div>');
  });

  it('escapes bare & in text', () => {
    const { chunks } = sanitize('a & b', { mode: 'html' });
    expect(chunks[0]).toBe('a &amp; b');
  });

  it('escapes bare < in text', () => {
    const { chunks } = sanitize('1 < 2', { mode: 'html' });
    expect(chunks[0]).toBe('1 &lt; 2');
  });
});

// ---------------------------------------------------------------------------
// sanitize — plain mode
// ---------------------------------------------------------------------------
describe('sanitize plain', () => {
  it('strips ** bold markers', () => {
    const { chunks } = sanitize('**bold**', { mode: 'plain' });
    expect(chunks[0]).toBe('bold');
  });

  it('strips * italic markers', () => {
    const { chunks } = sanitize('*italic*', { mode: 'plain' });
    expect(chunks[0]).toBe('italic');
  });

  it('strips _ italic markers', () => {
    const { chunks } = sanitize('_italic_', { mode: 'plain' });
    expect(chunks[0]).toBe('italic');
  });

  it('strips ` inline code markers', () => {
    const { chunks } = sanitize('`code`', { mode: 'plain' });
    expect(chunks[0]).toBe('code');
  });

  it('strips ~~ strikethrough markers', () => {
    const { chunks } = sanitize('~~strike~~', { mode: 'plain' });
    expect(chunks[0]).toBe('strike');
  });

  it('strips # heading markers', () => {
    const { chunks } = sanitize('# Heading\ntext', { mode: 'plain' });
    expect(chunks[0]).toContain('Heading');
    expect(chunks[0]).not.toContain('#');
  });

  it('strips ## heading markers', () => {
    const { chunks } = sanitize('## Sub\ntext', { mode: 'plain' });
    expect(chunks[0]).not.toContain('##');
  });

  it('collapses 3+ newlines to 2', () => {
    const { chunks } = sanitize('a\n\n\n\nb', { mode: 'plain' });
    expect(chunks[0]).toBe('a\n\nb');
  });

  it('strips fenced code block markers but keeps content', () => {
    const { chunks } = sanitize('```js\nconst x = 1;\n```', { mode: 'plain' });
    expect(chunks[0]).toContain('const x = 1;');
    expect(chunks[0]).not.toContain('```');
  });
});

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------
describe('chunking', () => {
  it('short text returns 1 chunk', () => {
    const { chunks, truncated } = sanitize('Hello world', { mode: 'plain', maxLen: 4000 });
    expect(chunks).toHaveLength(1);
    expect(truncated).toBe(false);
  });

  it('empty string returns 1 empty chunk, truncated=false', () => {
    const { chunks, truncated } = sanitize('', { mode: 'plain' });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('');
    expect(truncated).toBe(false);
  });

  it('maxLen=0 returns truncated=true and 1 empty chunk', () => {
    const { chunks, truncated } = sanitize('some text', { mode: 'plain', maxLen: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('');
    expect(truncated).toBe(true);
  });

  it('long text splits into multiple chunks', () => {
    const longText = 'a'.repeat(5000);
    const { chunks } = sanitize(longText, { mode: 'plain', maxLen: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it('splits at paragraph boundary preferentially', () => {
    const part1 = 'First paragraph here.\n\n';
    const part2 = 'Second paragraph here.';
    const text = part1 + part2;
    const maxLen = part1.length + 5; // just enough to prefer para break
    const { chunks } = sanitize(text, { mode: 'plain', maxLen });
    expect(chunks[0]).toContain('First paragraph');
    expect(chunks[1]).toContain('Second paragraph');
  });

  it('code block fits in one chunk', () => {
    const code = '```js\nconst x = 1;\n```';
    const { chunks } = sanitize(code, { mode: 'markdownv2', maxLen: 4000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('const x = 1;');
  });

  it('no break point causes hard cut', () => {
    const text = 'a'.repeat(200);
    const { chunks } = sanitize(text, { mode: 'plain', maxLen: 50 });
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(50);
    }
    // Reassemble to check no data loss (plain mode doesn't add markers)
    const joined = chunks.join('');
    expect(joined).toBe(text);
  });

  it('all chunks fit within maxLen', () => {
    const text = Array.from({ length: 20 }, (_, i) => `Sentence number ${i}. `).join('');
    const { chunks } = sanitize(text, { mode: 'plain', maxLen: 100 });
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it('truncated is true when text splits into multiple chunks', () => {
    const { truncated } = sanitize('a'.repeat(5000), { mode: 'plain', maxLen: 100 });
    expect(truncated).toBe(true);
  });
});
