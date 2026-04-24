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
});
