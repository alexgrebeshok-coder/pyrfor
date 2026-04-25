import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

vi.mock('@xterm/xterm', () => {
  class Terminal {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    focus() {}
    write() {}
    onData(_: (d: string) => void) {}
    dispose() {}
  }
  return { Terminal };
});
vi.mock('@xterm/addon-fit', () => {
  class FitAddon { fit() {} }
  return { FitAddon };
});
vi.mock('@xterm/addon-web-links', () => {
  class WebLinksAddon {}
  return { WebLinksAddon };
});
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

const mockFetch = vi.fn().mockResolvedValue({
  json: async () => ({ id: 'test-pty-id' }),
});
global.fetch = mockFetch as unknown as typeof fetch;

class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  binaryType = 'arraybuffer';
  addEventListener() {}
  removeEventListener() {}
  send() {}
  close() {}
}
global.WebSocket = MockWebSocket as unknown as typeof WebSocket;

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock('../../lib/api', () => ({
  getApiBase: () => 'http://localhost:18790',
  getDashboard: async () => ({}),
  fsWrite: async () => ({}),
}));

import Terminal from '../Terminal';

describe('Terminal', () => {
  it('renders a container div', () => {
    const { container } = render(<Terminal cwd="/tmp" />);
    expect(container.firstChild).toBeTruthy();
  });
});
