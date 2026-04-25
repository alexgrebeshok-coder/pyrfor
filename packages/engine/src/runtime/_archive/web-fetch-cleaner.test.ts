// @vitest-environment node
/**
 * Tests for web-fetch-cleaner.ts
 */

import { describe, it, expect } from 'vitest';
import {
  htmlToMarkdown,
  extractMainContent,
  extractTitle,
  extractMeta,
  cleanText,
  summarize,
  decodeEntities,
} from './web-fetch-cleaner';

// ─── decodeEntities ───────────────────────────────────────────────────────────

describe('decodeEntities', () => {
  it('decodes named entities', () => {
    expect(decodeEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'');
  });

  it('decodes &nbsp; to space', () => {
    expect(decodeEntities('hello&nbsp;world')).toBe('hello world');
  });

  it('decodes decimal numeric entities', () => {
    expect(decodeEntities('&#65;&#66;&#67;')).toBe('ABC');
  });

  it('decodes hex numeric entities', () => {
    expect(decodeEntities('&#x41;&#x42;&#x43;')).toBe('ABC');
  });

  it('leaves unknown entities unchanged', () => {
    expect(decodeEntities('&unknownXYZ;')).toBe('&unknownXYZ;');
  });
});

// ─── cleanText ────────────────────────────────────────────────────────────────

describe('cleanText', () => {
  it('collapses multiple spaces', () => {
    expect(cleanText('hello   world')).toBe('hello world');
  });

  it('trims leading and trailing whitespace', () => {
    expect(cleanText('  hello  ')).toBe('hello');
  });

  it('decodes entities', () => {
    expect(cleanText('&amp; &lt;tag&gt;')).toBe('& <tag>');
  });

  it('strips HTML tags', () => {
    expect(cleanText('<b>bold</b> text')).toBe('bold text');
  });

  it('strips control characters', () => {
    expect(cleanText('hel\x00lo\x01')).toBe('hello');
  });

  it('collapses excessive newlines to double newline', () => {
    const result = cleanText('a\n\n\n\nb');
    expect(result).toBe('a\n\nb');
  });
});

// ─── summarize ────────────────────────────────────────────────────────────────

describe('summarize', () => {
  it('returns text unchanged if within limit', () => {
    expect(summarize('Short text.', 100)).toBe('Short text.');
  });

  it('cuts at last sentence boundary and appends ellipsis', () => {
    const text = 'First sentence. Second sentence. Third sentence goes on and on.';
    const result = summarize(text, 35);
    expect(result).toMatch(/\…$/);
    expect(result.length).toBeLessThanOrEqual(36); // 35 + '…'
    expect(result).toContain('First sentence.');
  });

  it('appends ellipsis even with no sentence boundary', () => {
    const result = summarize('abcdefghij', 5);
    expect(result).toBe('abcde…');
  });

  it('handles exclamation and question marks as sentence boundaries', () => {
    const text = 'Hello! How are you doing today in this long example?';
    const result = summarize(text, 10);
    expect(result).toMatch(/\…$/);
  });
});

// ─── extractTitle ─────────────────────────────────────────────────────────────

describe('extractTitle', () => {
  it('extracts from <title>', () => {
    expect(extractTitle('<html><head><title>My Page</title></head></html>')).toBe('My Page');
  });

  it('falls back to first <h1>', () => {
    expect(extractTitle('<html><body><h1>Main Heading</h1></body></html>')).toBe(
      'Main Heading',
    );
  });

  it('prefers <title> over <h1>', () => {
    expect(
      extractTitle('<title>Title Tag</title><h1>H1 Tag</h1>'),
    ).toBe('Title Tag');
  });

  it('returns undefined when no title', () => {
    expect(extractTitle('<p>No title here</p>')).toBeUndefined();
  });

  it('decodes entities in title', () => {
    expect(extractTitle('<title>Hello &amp; World</title>')).toBe('Hello & World');
  });
});

// ─── extractMeta ─────────────────────────────────────────────────────────────

describe('extractMeta', () => {
  const html = `
    <html>
      <head>
        <title>Test Page</title>
        <meta name="description" content="A test description">
        <meta name="author" content="John Doe">
        <link rel="canonical" href="https://example.com/page">
        <meta property="og:image" content="https://example.com/img.jpg">
      </head>
    </html>
  `;

  it('extracts title', () => {
    expect(extractMeta(html).title).toBe('Test Page');
  });

  it('extracts description', () => {
    expect(extractMeta(html).description).toBe('A test description');
  });

  it('extracts author', () => {
    expect(extractMeta(html).author).toBe('John Doe');
  });

  it('extracts canonical URL', () => {
    expect(extractMeta(html).canonical).toBe('https://example.com/page');
  });

  it('extracts og:image', () => {
    expect(extractMeta(html).ogImage).toBe('https://example.com/img.jpg');
  });

  it('returns empty object for minimal HTML', () => {
    const meta = extractMeta('<p>nothing</p>');
    expect(meta.title).toBeUndefined();
    expect(meta.description).toBeUndefined();
  });
});

// ─── extractMainContent ───────────────────────────────────────────────────────

describe('extractMainContent', () => {
  it('prefers <article> over body', () => {
    const html = '<body><nav>Nav</nav><article><p>Main</p></article></body>';
    const result = extractMainContent(html);
    expect(result).toContain('Main');
    expect(result).not.toContain('Nav');
  });

  it('prefers <main> over <article>', () => {
    const html = '<article>Article</article><main><p>Primary</p></main>';
    const result = extractMainContent(html);
    expect(result).toContain('Primary');
  });

  it('strips <nav>, <header>, <footer>, <aside>', () => {
    const html = '<header>H</header><nav>N</nav><p>Content</p><footer>F</footer><aside>A</aside>';
    const result = extractMainContent(html);
    expect(result).not.toContain('>H<');
    expect(result).not.toContain('>N<');
    expect(result).not.toContain('>F<');
    expect(result).not.toContain('>A<');
    expect(result).toContain('Content');
  });

  it('strips <script> and <style>', () => {
    const html = '<script>var x=1;</script><style>.a{}</style><p>text</p>';
    const result = extractMainContent(html);
    expect(result).not.toContain('var x=1');
    expect(result).not.toContain('.a{}');
    expect(result).toContain('text');
  });

  it('strips HTML comments', () => {
    const html = '<p>Hello <!-- comment --> World</p>';
    const result = extractMainContent(html);
    expect(result).not.toContain('comment');
  });

  it('falls back to full body when no main/article', () => {
    const html = '<body><p>Just some text</p></body>';
    const result = extractMainContent(html);
    expect(result).toContain('Just some text');
  });

  it('supports [role=main]', () => {
    const html = '<div role="main"><p>Role content</p></div>';
    const result = extractMainContent(html);
    expect(result).toContain('Role content');
  });
});

// ─── htmlToMarkdown – headings ────────────────────────────────────────────────

describe('htmlToMarkdown – headings', () => {
  it('converts h1..h6', () => {
    for (let i = 1; i <= 6; i++) {
      const md = htmlToMarkdown(`<h${i}>Heading ${i}</h${i}>`);
      expect(md).toContain(`${'#'.repeat(i)} Heading ${i}`);
    }
  });
});

// ─── htmlToMarkdown – inline formatting ──────────────────────────────────────

describe('htmlToMarkdown – inline formatting', () => {
  it('converts <strong> to **bold**', () => {
    expect(htmlToMarkdown('<strong>bold</strong>')).toContain('**bold**');
  });

  it('converts <b> to **bold**', () => {
    expect(htmlToMarkdown('<b>bold</b>')).toContain('**bold**');
  });

  it('converts <em> to *italic*', () => {
    expect(htmlToMarkdown('<em>italic</em>')).toContain('*italic*');
  });

  it('converts <i> to *italic*', () => {
    expect(htmlToMarkdown('<i>italic</i>')).toContain('*italic*');
  });

  it('converts <code> to `code`', () => {
    expect(htmlToMarkdown('<code>myFunc()</code>')).toContain('`myFunc()`');
  });
});

// ─── htmlToMarkdown – code blocks ────────────────────────────────────────────

describe('htmlToMarkdown – code blocks', () => {
  it('converts <pre><code> to fenced block', () => {
    const md = htmlToMarkdown('<pre><code>const x = 1;</code></pre>');
    expect(md).toContain('```');
    expect(md).toContain('const x = 1;');
  });

  it('preserves language from class="language-xxx"', () => {
    const md = htmlToMarkdown(
      '<pre><code class="language-typescript">const x: number = 1;</code></pre>',
    );
    expect(md).toContain('```typescript');
    expect(md).toContain('const x: number = 1;');
  });
});

// ─── htmlToMarkdown – links ───────────────────────────────────────────────────

describe('htmlToMarkdown – links', () => {
  it('converts <a href> to [text](href)', () => {
    const md = htmlToMarkdown('<a href="https://example.com">Click</a>');
    expect(md).toContain('[Click](https://example.com)');
  });

  it('resolves relative URLs against baseUrl', () => {
    const md = htmlToMarkdown('<a href="/page">Link</a>', {
      baseUrl: 'https://example.com',
    });
    expect(md).toContain('[Link](https://example.com/page)');
  });

  it('handles missing href', () => {
    const md = htmlToMarkdown('<a>No href</a>');
    expect(md).toContain('No href');
    expect(md).not.toContain('](');
  });
});

// ─── htmlToMarkdown – images ──────────────────────────────────────────────────

describe('htmlToMarkdown – images', () => {
  it('converts <img> to ![alt](src)', () => {
    const md = htmlToMarkdown('<img src="pic.png" alt="A photo">');
    expect(md).toContain('![A photo](pic.png)');
  });

  it('skips images when preserveImages=false', () => {
    const md = htmlToMarkdown('<img src="pic.png" alt="photo">', {
      preserveImages: false,
    });
    expect(md).not.toContain('![');
    expect(md).not.toContain('pic.png');
  });

  it('resolves image URLs against baseUrl', () => {
    const md = htmlToMarkdown('<img src="/img/photo.jpg" alt="x">', {
      baseUrl: 'https://example.com',
    });
    expect(md).toContain('https://example.com/img/photo.jpg');
  });
});

// ─── htmlToMarkdown – lists ───────────────────────────────────────────────────

describe('htmlToMarkdown – lists', () => {
  it('converts <ul><li> to - items', () => {
    const md = htmlToMarkdown('<ul><li>A</li><li>B</li></ul>');
    expect(md).toContain('- A');
    expect(md).toContain('- B');
  });

  it('converts <ol><li> to numbered items', () => {
    const md = htmlToMarkdown('<ol><li>First</li><li>Second</li></ol>');
    expect(md).toContain('1. First');
    expect(md).toContain('2. Second');
  });

  it('indents nested lists', () => {
    const md = htmlToMarkdown(
      '<ul><li>Parent<ul><li>Child</li></ul></li></ul>',
    );
    expect(md).toContain('- Parent');
    expect(md).toContain('  - Child');
  });
});

// ─── htmlToMarkdown – blockquote / br / hr / p ───────────────────────────────

describe('htmlToMarkdown – structural elements', () => {
  it('converts <blockquote> to > prefixed lines', () => {
    const md = htmlToMarkdown('<blockquote>Quote here</blockquote>');
    expect(md).toContain('> ');
  });

  it('converts <br> to newline', () => {
    const md = htmlToMarkdown('Line1<br>Line2');
    expect(md).toContain('Line1\nLine2');
  });

  it('converts <hr> to ---', () => {
    const md = htmlToMarkdown('<hr>');
    expect(md).toContain('---');
  });

  it('wraps <p> with blank lines', () => {
    const md = htmlToMarkdown('<p>Para one</p><p>Para two</p>');
    expect(md).toContain('Para one');
    expect(md).toContain('Para two');
    // There should be a blank line between paragraphs
    expect(md).toMatch(/Para one\n\nPara two/);
  });
});

// ─── htmlToMarkdown – stripping ───────────────────────────────────────────────

describe('htmlToMarkdown – stripping', () => {
  it('strips <script> tags', () => {
    const md = htmlToMarkdown('<script>alert("xss")</script><p>safe</p>');
    expect(md).not.toContain('alert');
    expect(md).toContain('safe');
  });

  it('strips <style> tags', () => {
    const md = htmlToMarkdown('<style>.foo { color: red }</style><p>text</p>');
    expect(md).not.toContain('.foo');
    expect(md).toContain('text');
  });

  it('strips HTML comments', () => {
    const md = htmlToMarkdown('<!-- secret -->visible');
    expect(md).not.toContain('secret');
    expect(md).toContain('visible');
  });

  it('strips <noscript>', () => {
    const md = htmlToMarkdown('<noscript>enable js</noscript><p>main</p>');
    expect(md).not.toContain('enable js');
    expect(md).toContain('main');
  });

  it('strips <iframe>', () => {
    const md = htmlToMarkdown('<iframe src="evil.com"></iframe><p>page</p>');
    expect(md).not.toContain('evil.com');
    expect(md).toContain('page');
  });
});

// ─── htmlToMarkdown – entity decoding ────────────────────────────────────────

describe('htmlToMarkdown – entity decoding', () => {
  it('decodes named entities in content', () => {
    const md = htmlToMarkdown('<p>Tom &amp; Jerry &lt;3&gt;</p>');
    expect(md).toContain('Tom & Jerry <3>');
  });

  it('decodes decimal entities', () => {
    const md = htmlToMarkdown('<p>&#72;&#101;&#108;&#108;&#111;</p>');
    expect(md).toContain('Hello');
  });

  it('decodes hex entities', () => {
    const md = htmlToMarkdown('<p>&#x48;&#x65;&#x6C;&#x6C;&#x6F;</p>');
    expect(md).toContain('Hello');
  });
});

// ─── htmlToMarkdown – maxLength ───────────────────────────────────────────────

describe('htmlToMarkdown – maxLength', () => {
  it('truncates at paragraph boundary', () => {
    const html =
      '<p>First paragraph with enough text to fill a line.</p>' +
      '<p>Second paragraph that should be cut off.</p>' +
      '<p>Third paragraph never shown.</p>';
    const md = htmlToMarkdown(html, { maxLength: 60 });
    expect(md).toMatch(/…$/);
    expect(md.length).toBeLessThanOrEqual(63); // 60 + '\n\n…'
  });

  it('appends … even without paragraph break', () => {
    const md = htmlToMarkdown('<p>' + 'x'.repeat(200) + '</p>', {
      maxLength: 50,
    });
    expect(md).toMatch(/…$/);
  });

  it('does not truncate when under limit', () => {
    const md = htmlToMarkdown('<p>Short</p>', { maxLength: 1000 });
    expect(md).not.toContain('…');
  });
});

// ─── malformed HTML robustness ────────────────────────────────────────────────

describe('malformed HTML – robustness', () => {
  it('does not crash on unclosed tags', () => {
    expect(() => htmlToMarkdown('<p>Unclosed paragraph')).not.toThrow();
  });

  it('does not crash on wrong nesting', () => {
    expect(() =>
      htmlToMarkdown('<b><i>wrong</b></i>'),
    ).not.toThrow();
  });

  it('does not crash on empty string', () => {
    expect(() => htmlToMarkdown('')).not.toThrow();
    expect(htmlToMarkdown('')).toBe('');
  });

  it('does not crash on deeply nested tags', () => {
    const nested = '<div>'.repeat(50) + 'deep' + '</div>'.repeat(50);
    expect(() => htmlToMarkdown(nested)).not.toThrow();
  });

  it('handles self-closing tags without crashing', () => {
    expect(() =>
      htmlToMarkdown('<img src="x.jpg"/><br/><hr/>'),
    ).not.toThrow();
  });

  it('does not crash on malformed script tag', () => {
    expect(() =>
      htmlToMarkdown('<script>unclosed script'),
    ).not.toThrow();
  });
});
