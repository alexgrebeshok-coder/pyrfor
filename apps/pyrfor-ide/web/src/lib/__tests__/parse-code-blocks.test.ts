import { describe, it, expect } from 'vitest';
import { parseCodeBlocks } from '../parse-code-blocks';

describe('parseCodeBlocks', () => {
  it('parses lang:path syntax', () => {
    const text = '```ts:src/foo.ts\ncode\n```';
    const blocks = parseCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBe('ts');
    expect(blocks[0].path).toBe('src/foo.ts');
    expect(blocks[0].content).toBe('code\n');
  });

  it('parses lang file=path syntax', () => {
    const text = '```ts file=src/foo.ts\ncode\n```';
    const blocks = parseCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBe('ts');
    expect(blocks[0].path).toBe('src/foo.ts');
  });

  it('parses lang path=path syntax', () => {
    const text = '```ts path=src/foo.ts\ncode\n```';
    const blocks = parseCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBe('ts');
    expect(blocks[0].path).toBe('src/foo.ts');
  });

  it('parses bare lang with no path', () => {
    const text = '```ts\ncode\n```';
    const blocks = parseCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBe('ts');
    expect(blocks[0].path).toBeNull();
  });

  it('parses multiple code blocks', () => {
    const text = '```ts\nfoo\n```\nintervening\n```py\nbar\n```';
    const blocks = parseCodeBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].lang).toBe('ts');
    expect(blocks[1].lang).toBe('py');
  });

  it('parses empty lang with colon path', () => {
    const text = '```:src/foo.ts\ncode\n```';
    const blocks = parseCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBe('');
    expect(blocks[0].path).toBe('src/foo.ts');
  });
});
