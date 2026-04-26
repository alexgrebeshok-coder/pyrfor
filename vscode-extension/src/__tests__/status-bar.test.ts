import { describe, it, expect } from 'vitest';
import { formatStatus } from '../status-bar';
import type { DaemonState } from '../daemon-client';

const states: DaemonState[] = ['idle', 'connecting', 'open', 'closed', 'error'];

describe('formatStatus', () => {
  it('returns a non-empty text and tooltip for every state', () => {
    for (const state of states) {
      const result = formatStatus(state);
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.tooltip.length).toBeGreaterThan(0);
    }
  });

  it('idle — contains "idle"', () => {
    expect(formatStatus('idle').text).toMatch(/idle/i);
  });

  it('connecting — contains "connecting"', () => {
    expect(formatStatus('connecting').text).toMatch(/connecting/i);
  });

  it('open — contains "connected"', () => {
    expect(formatStatus('open').text).toMatch(/connected/i);
  });

  it('closed — contains "disconnected"', () => {
    expect(formatStatus('closed').text).toMatch(/disconnected/i);
  });

  it('error — contains "error"', () => {
    expect(formatStatus('error').text).toMatch(/error/i);
  });
});
