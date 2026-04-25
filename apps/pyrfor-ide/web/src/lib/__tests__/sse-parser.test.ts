import { describe, it, expect } from 'vitest';
import { parseSseFrames } from '../sse-parser';

describe('parseSseFrames', () => {
  it('parses a single data frame', () => {
    const text = 'data: {"type":"token","text":"hi"}\n\n';
    const { frames, remainder } = parseSseFrames(text);
    expect(frames).toHaveLength(1);
    expect(frames[0].data).toBe('{"type":"token","text":"hi"}');
    expect(frames[0].event).toBeUndefined();
    expect(remainder).toBe('');
  });

  it('parses a named event', () => {
    const text = 'event: done\ndata: {}\n\n';
    const { frames, remainder } = parseSseFrames(text);
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe('done');
    expect(frames[0].data).toBe('{}');
    expect(remainder).toBe('');
  });

  it('parses multiple frames separated by \\n\\n', () => {
    const text =
      'data: {"type":"token","text":"a"}\n\ndata: {"type":"token","text":"b"}\n\n';
    const { frames, remainder } = parseSseFrames(text);
    expect(frames).toHaveLength(2);
    expect(frames[0].data).toBe('{"type":"token","text":"a"}');
    expect(frames[1].data).toBe('{"type":"token","text":"b"}');
    expect(remainder).toBe('');
  });

  it('returns partial buffer as remainder when no trailing newline', () => {
    const text = 'data: partial';
    const { frames, remainder } = parseSseFrames(text);
    expect(frames).toHaveLength(0);
    expect(remainder).toBe('data: partial');
  });

  it('parses one complete frame and keeps the partial second as remainder', () => {
    const text = 'data: {"type":"token","text":"a"}\n\ndata: par';
    const { frames, remainder } = parseSseFrames(text);
    expect(frames).toHaveLength(1);
    expect(frames[0].data).toBe('{"type":"token","text":"a"}');
    expect(remainder).toBe('data: par');
  });
});
