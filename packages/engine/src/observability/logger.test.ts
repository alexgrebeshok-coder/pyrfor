// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from './logger.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function cleanEnv() {
  delete process.env.PYRFOR_LOG_FORMAT;
  delete process.env.PYRFOR_LOG_LEVEL;
  delete process.env.LOG_LEVEL;
  // keep NODE_ENV='test' so default level resolves to 'debug'
  process.env.NODE_ENV = 'test';
}

// ─── text mode (default) ─────────────────────────────────────────────────────

describe('logger – text mode (default)', () => {
  beforeEach(cleanEnv);
  afterEach(() => vi.restoreAllMocks());

  it('writes a debug line via console.debug in [TS] [DEBUG] msg format', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logger.debug('[mod] hello debug', { x: 1 });
    expect(spy).toHaveBeenCalledOnce();
    const out = spy.mock.calls[0][0] as string;
    // golden regex: timestamp, level tag, message, serialised meta
    expect(out).toMatch(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] \[DEBUG\] \[mod\] hello debug \{"x":1\}$/);
  });

  it('writes an info line via console.info', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('info message');
    expect(spy).toHaveBeenCalledOnce();
    const out = spy.mock.calls[0][0] as string;
    expect(out).toMatch(/\[INFO\].*info message$/);
  });

  it('writes a warn line via console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('warn msg');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('[WARN]');
  });

  it('writes an error line via console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('err msg');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('[ERROR]');
  });

  it('omits meta when not provided', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('no meta');
    const out = spy.mock.calls[0][0] as string;
    expect(out).toMatch(/\[INFO\] no meta$/);
  });

  it('suppresses levels below PYRFOR_LOG_LEVEL', () => {
    process.env.PYRFOR_LOG_LEVEL = 'warn';
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.debug('suppressed debug');
    logger.info('suppressed info');
    logger.warn('visible warn');
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('falls back to LOG_LEVEL when PYRFOR_LOG_LEVEL is unset', () => {
    process.env.LOG_LEVEL = 'error';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.warn('suppressed warn');
    logger.error('visible error');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('PYRFOR_LOG_LEVEL takes priority over LOG_LEVEL', () => {
    process.env.PYRFOR_LOG_LEVEL = 'debug';
    process.env.LOG_LEVEL = 'error';
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logger.debug('should appear');
    expect(spy).toHaveBeenCalledOnce();
  });
});

// ─── json mode ───────────────────────────────────────────────────────────────

describe('logger – json mode (PYRFOR_LOG_FORMAT=json)', () => {
  beforeEach(() => {
    cleanEnv();
    process.env.PYRFOR_LOG_FORMAT = 'json';
  });
  afterEach(() => vi.restoreAllMocks());

  it('emits a valid JSON line to stdout for debug', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.debug('debug json', { n: 42 });
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse((spy.mock.calls[0][0] as string).trim());
    expect(parsed).toMatchObject({ level: 'debug', msg: 'debug json', data: { n: 42 } });
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('emits a valid JSON line to stdout for info', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.info('info json', { key: 'value' });
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse((spy.mock.calls[0][0] as string).trim());
    expect(parsed).toMatchObject({ level: 'info', msg: 'info json', data: { key: 'value' } });
    expect(typeof parsed.ts).toBe('string');
  });

  it('emits a valid JSON line to stderr for warn', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.warn('a warning');
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse((spy.mock.calls[0][0] as string).trim());
    expect(parsed).toMatchObject({ level: 'warn', msg: 'a warning' });
    expect(parsed.data).toBeUndefined();
  });

  it('emits a valid JSON line to stderr for error', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.error('an error', { code: 500 });
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse((spy.mock.calls[0][0] as string).trim());
    expect(parsed).toMatchObject({ level: 'error', msg: 'an error', data: { code: 500 } });
  });

  it('omits data key when no meta is provided', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.info('no meta json');
    const parsed = JSON.parse((spy.mock.calls[0][0] as string).trim());
    expect(parsed.data).toBeUndefined();
    expect(Object.keys(parsed)).toEqual(['ts', 'level', 'msg']);
  });

  it('each line ends with a newline', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.info('newline check');
    const raw = spy.mock.calls[0][0] as string;
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('level filtering works in JSON mode', () => {
    process.env.PYRFOR_LOG_LEVEL = 'error';
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.debug('suppressed');
    logger.info('suppressed');
    logger.warn('suppressed');
    logger.error('visible');
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledOnce();
    const parsed = JSON.parse((stderrSpy.mock.calls[0][0] as string).trim());
    expect(parsed.level).toBe('error');
  });

  it('does not call console.* methods in JSON mode', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.info('json only');
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('JSON line contains no embedded newlines (single-line)', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.info('single line check', { a: 1 });
    const raw = spy.mock.calls[0][0] as string;
    // only the trailing \n is present
    expect(raw.slice(0, -1)).not.toContain('\n');
  });
});

// ─── additional edge-cases ────────────────────────────────────────────────────

describe('logger – edge cases', () => {
  beforeEach(cleanEnv);
  afterEach(() => vi.restoreAllMocks());

  it('invalid PYRFOR_LOG_LEVEL falls back to debug (in test env) without throwing', () => {
    process.env.PYRFOR_LOG_LEVEL = 'verbose'; // not a valid LogLevel
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(() => logger.debug('fallback test')).not.toThrow();
    // 'verbose' is invalid → falls back to 'debug' because NODE_ENV !== 'production'
    expect(spy).toHaveBeenCalledOnce();
  });

  it('invalid LOG_LEVEL falls back to debug without throwing', () => {
    process.env.LOG_LEVEL = 'TRACE'; // not a valid LogLevel
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(() => logger.info('fallback log_level')).not.toThrow();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('nested object meta is fully serialised in text mode', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('nested', { a: { b: { c: 42 } } });
    const out = spy.mock.calls[0][0] as string;
    expect(out).toContain('{"a":{"b":{"c":42}}}');
  });

  it('nested object meta is fully serialised in JSON mode', () => {
    process.env.PYRFOR_LOG_FORMAT = 'json';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.info('nested json', { a: { b: { c: 99 } } });
    const parsed = JSON.parse((spy.mock.calls[0][0] as string).trim());
    expect(parsed.data).toEqual({ a: { b: { c: 99 } } });
  });

  it('circular meta does not throw in text mode', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    expect(() => logger.info('circular text', circ)).not.toThrow();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('[unserializable]');
  });

  it('circular meta does not throw in JSON mode', () => {
    process.env.PYRFOR_LOG_FORMAT = 'json';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    expect(() => logger.info('circular json', circ)).not.toThrow();
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse((spy.mock.calls[0][0] as string).trim());
    expect(parsed.data).toBe('[unserializable]');
  });

  it('Error meta is serialised with name, message and stack in JSON mode', () => {
    process.env.PYRFOR_LOG_FORMAT = 'json';
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const err = new Error('something went wrong');
    logger.error('with error meta', err);
    const parsed = JSON.parse((spy.mock.calls[0][0] as string).trim());
    expect(parsed.data).toMatchObject({
      name: 'Error',
      message: 'something went wrong',
    });
    expect(typeof parsed.data.stack).toBe('string');
  });

  it('Error meta is serialised with name, message and stack in text mode', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('boom');
    logger.error('text error meta', err);
    const out = spy.mock.calls[0][0] as string;
    expect(out).toContain('"name":"Error"');
    expect(out).toContain('"message":"boom"');
    expect(out).toContain('"stack"');
  });

  it('unicode and multibyte characters in message are preserved in text mode', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const msg = '日本語テスト 🚀 — résumé';
    logger.info(msg);
    expect(spy.mock.calls[0][0]).toContain(msg);
  });

  it('unicode and multibyte characters in message are preserved in JSON mode', () => {
    process.env.PYRFOR_LOG_FORMAT = 'json';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const msg = '中文 🌍 café';
    logger.info(msg);
    const parsed = JSON.parse((spy.mock.calls[0][0] as string).trim());
    expect(parsed.msg).toBe(msg);
  });

  it('silent level suppresses all output', () => {
    process.env.PYRFOR_LOG_LEVEL = 'silent';
    const spies = [
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ];
    logger.debug('d'); logger.info('i'); logger.warn('w'); logger.error('e');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
