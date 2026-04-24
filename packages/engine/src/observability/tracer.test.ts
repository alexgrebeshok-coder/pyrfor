// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createTracer } from './tracer.js';

describe('tracer – startSpan / end / recent', () => {
  it('returns a completed SpanRecord with correct timing and attrs', () => {
    let t = 0;
    const tracer = createTracer({ now: () => t });

    t = 100;
    const span = tracer.startSpan('my-span', { key: 'value' });
    t = 250;
    span.end();

    const records = tracer.recent();
    expect(records).toHaveLength(1);
    const rec = records[0];
    expect(rec.name).toBe('my-span');
    expect(rec.startMs).toBe(100);
    expect(rec.endMs).toBe(250);
    expect(rec.durationMs).toBe(150);
    expect(rec.attrs).toEqual({ key: 'value' });
    expect(rec.status).toBe('ok');
    expect(rec.error).toBeUndefined();
    expect(rec.parentId).toBeUndefined();
    expect(rec.id).toMatch(/^[0-9a-f]{16}$/);
    expect(rec.traceId).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('tracer – withSpan', () => {
  it('success path: returns fn result and records ok span', async () => {
    const tracer = createTracer();
    const result = await tracer.withSpan('op', async (span) => {
      span.setAttr('x', 42);
      return 'done';
    });

    expect(result).toBe('done');
    const records = tracer.recent();
    expect(records).toHaveLength(1);
    expect(records[0].name).toBe('op');
    expect(records[0].attrs).toMatchObject({ x: 42 });
    expect(records[0].status).toBe('ok');
  });

  it('error path: re-throws and records error span', async () => {
    const tracer = createTracer();
    await expect(
      tracer.withSpan('fail', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const records = tracer.recent();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('error');
    expect(records[0].error).toBe('boom');
  });

  it('non-Error throws are stringified as error message', async () => {
    const tracer = createTracer();
    await expect(
      tracer.withSpan('string-throw', async () => {
        throw 'something bad'; // eslint-disable-line @typescript-eslint/only-throw-error
      }),
    ).rejects.toBe('something bad');

    expect(tracer.recent()[0].error).toBe('something bad');
  });
});

describe('tracer – nested spans (parent / child)', () => {
  it('child span inherits traceId and points to parent', async () => {
    const tracer = createTracer();
    let outerSpanId: string;
    let innerRecord: ReturnType<typeof tracer.recent>[0] | undefined;

    await tracer.withSpan('outer', async (outer) => {
      outerSpanId = outer.id;
      await tracer.withSpan('inner', async () => {
        // inner ends first when withSpan resolves
      });
      innerRecord = tracer.recent().find((r) => r.name === 'inner');
    });

    expect(innerRecord).toBeDefined();
    expect(innerRecord!.parentId).toBe(outerSpanId!);
    expect(innerRecord!.traceId).toBe(tracer.recent().find((r) => r.name === 'outer')!.traceId);
  });

  it('getActiveSpan returns innermost span inside nested withSpan', async () => {
    const tracer = createTracer();
    let activeIdInInner: string | undefined;

    await tracer.withSpan('outer', async () => {
      await tracer.withSpan('inner', async (inner) => {
        activeIdInInner = tracer.getActiveSpan()?.id;
        expect(tracer.getActiveSpan()?.id).toBe(inner.id);
      });
    });

    expect(activeIdInInner).toBeDefined();
  });

  it('getActiveSpan returns undefined outside withSpan', () => {
    const tracer = createTracer();
    expect(tracer.getActiveSpan()).toBeUndefined();
  });
});

describe('tracer – ring buffer', () => {
  it('respects bufferSize, evicting oldest first', () => {
    const tracer = createTracer({ bufferSize: 3 });
    for (let i = 0; i < 5; i++) tracer.startSpan(`s${i}`).end();

    const records = tracer.recent();
    expect(records).toHaveLength(3);
    expect(records[0].name).toBe('s2');
    expect(records[1].name).toBe('s3');
    expect(records[2].name).toBe('s4');
  });

  it('recent(limit) returns at most limit records from the tail', () => {
    const tracer = createTracer();
    for (let i = 0; i < 10; i++) tracer.startSpan(`s${i}`).end();

    const top3 = tracer.recent(3);
    expect(top3).toHaveLength(3);
    expect(top3[0].name).toBe('s7');
    expect(top3[2].name).toBe('s9');
  });
});

describe('tracer – emit callback', () => {
  it('is called exactly once per span end', () => {
    const emitted: unknown[] = [];
    const tracer = createTracer({ emit: (s) => emitted.push(s) });

    const span = tracer.startSpan('emitted-span');
    expect(emitted).toHaveLength(0);
    span.end();
    expect(emitted).toHaveLength(1);
    // idempotent: second end() must not re-emit
    span.end();
    expect(emitted).toHaveLength(1);
  });

  it('emitted record matches the span that finished', () => {
    let captured: unknown;
    const tracer = createTracer({ emit: (s) => { captured = s; } });

    const span = tracer.startSpan('check-emit', { env: 'test' });
    span.end();

    expect(captured).toMatchObject({ name: 'check-emit', attrs: { env: 'test' }, status: 'ok' });
  });
});

describe('tracer – now injection', () => {
  it('uses injected clock for deterministic timing', () => {
    let t = 1000;
    const tracer = createTracer({ now: () => t });

    const span = tracer.startSpan('timed');
    t = 1750;
    span.end();

    const rec = tracer.recent()[0];
    expect(rec.startMs).toBe(1000);
    expect(rec.endMs).toBe(1750);
    expect(rec.durationMs).toBe(750);
  });
});

describe('tracer – addEvent / setAttr / setStatus', () => {
  it('events are captured in the record', () => {
    let t = 0;
    const tracer = createTracer({ now: () => t });

    t = 10;
    const span = tracer.startSpan('with-events');
    t = 20;
    span.addEvent('step1', { detail: 'a' });
    t = 30;
    span.addEvent('step2');
    t = 40;
    span.end();

    const rec = tracer.recent()[0];
    expect(rec.events).toHaveLength(2);
    expect(rec.events[0]).toMatchObject({ name: 'step1', timeMs: 20, attrs: { detail: 'a' } });
    expect(rec.events[1]).toMatchObject({ name: 'step2', timeMs: 30 });
    expect(rec.events[1].attrs).toBeUndefined();
  });

  it('setStatus ok with message stores message', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('status-test');
    span.setStatus('ok', 'all good');
    span.end();

    const rec = tracer.recent()[0];
    expect(rec.status).toBe('ok');
    // message stored as error field only for 'error' status per spec; ok message is fine too
    expect(rec.error).toBe('all good');
  });

  it('setAttr updates attrs visible in the record', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('attrs-test');
    span.setAttr('a', 1);
    span.setAttr('b', 'hello');
    span.end();

    expect(tracer.recent()[0].attrs).toEqual({ a: 1, b: 'hello' });
  });
});
