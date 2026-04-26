import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../../lib/api', () => ({
  chat: vi.fn().mockResolvedValue({ reply: 'fallback' }),
  chatStream: vi.fn(),
  chatStreamMultipart: vi.fn().mockResolvedValue(undefined),
  fsRead: vi.fn().mockResolvedValue({ content: '', size: 0, path: '' }),
  getDaemonPort: vi.fn().mockResolvedValue(18790),
  transcribeAudio: vi.fn().mockResolvedValue({ text: '' }),
}));

import ChatPanel from '../ChatPanel';
import { chatStream, chatStreamMultipart } from '../../lib/api';

const mockChatStream = chatStream as unknown as ReturnType<typeof vi.fn>;
const mockChatStreamMultipart = chatStreamMultipart as unknown as ReturnType<typeof vi.fn>;

function makeStreamResponse(sseText: string): Response {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(sseText);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    body: stream,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
  } as unknown as Response;
}

function makeStreamResponseDelayed(chunks: string[], holdMs = 50): {
  response: Response;
  release: () => void;
} {
  let releaser: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c));
      }
      await new Promise<void>((resolve) => {
        releaser = resolve;
        setTimeout(resolve, holdMs * 100);
      });
      controller.close();
    },
  });
  const response = {
    ok: true,
    status: 200,
    body: stream,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
  } as unknown as Response;
  return {
    response,
    release: () => releaser?.(),
  };
}

const baseProps = {
  cwd: '/ws',
  workspace: '/ws',
  tabs: [],
  activeTab: null,
  onApplyToFile: vi.fn(),
  onOpenOrFocusTab: vi.fn(),
  onToast: vi.fn(),
};

describe('ChatPanel', () => {
  beforeEach(() => {
    mockChatStream.mockReset();
    mockChatStreamMultipart.mockReset();
    mockChatStreamMultipart.mockResolvedValue(undefined);
  });

  it('renders input and send button', () => {
    render(<ChatPanel {...baseProps} />);
    expect(screen.getByPlaceholderText(/Ask anything/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Send/i })).toBeTruthy();
  });

  it('streams tokens and renders them in order', async () => {
    const sse =
      'data: {"type":"token","text":"Hello "}\n\n' +
      'data: {"type":"token","text":"world"}\n\n' +
      'data: {"type":"final","text":"Hello world"}\n\n' +
      'event: done\ndata: {}\n\n';
    mockChatStream.mockResolvedValue(makeStreamResponse(sse));

    render(<ChatPanel {...baseProps} />);
    const input = screen.getByPlaceholderText(/Ask anything/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));

    await waitFor(() => {
      expect(document.body.textContent || '').toContain('Hello world');
    });
  });

  it('renders tool pill for tool events', async () => {
    const sse =
      'data: {"type":"tool","name":"bash","args":{"cmd":"ls"}}\n\n' +
      'data: {"type":"final","text":"done"}\n\n' +
      'event: done\ndata: {}\n\n';
    mockChatStream.mockResolvedValue(makeStreamResponse(sse));

    render(<ChatPanel {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/Ask anything/i), {
      target: { value: 'run ls' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));

    await waitFor(() => {
      const pills = screen.getAllByTestId('tool-pill');
      expect(pills.length).toBeGreaterThan(0);
      expect(pills[0].textContent || '').toContain('bash');
    });
  });

  it('shows error when error event received', async () => {
    const sse = 'event: error\ndata: {"message":"boom"}\n\n';
    mockChatStream.mockResolvedValue(makeStreamResponse(sse));

    render(<ChatPanel {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/Ask anything/i), {
      target: { value: 'oops' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));

    await waitFor(() => {
      expect(document.body.textContent || '').toContain('boom');
    });
  });

  it('cancel button aborts streaming', async () => {
    let captured: AbortSignal | undefined;
    mockChatStream.mockImplementation(async (params: { signal?: AbortSignal }) => {
      captured = params.signal;
      // Return a stream that never resolves until aborted
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          if (params.signal) {
            params.signal.addEventListener('abort', () => {
              try {
                controller.error(new DOMException('aborted', 'AbortError'));
              } catch {
                /* ignore */
              }
            });
          }
        },
      });
      return {
        ok: true,
        status: 200,
        body: stream,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
      } as unknown as Response;
    });

    render(<ChatPanel {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/Ask anything/i), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));

    const cancelBtn = await screen.findByTestId('chat-cancel');
    expect(captured).toBeDefined();
    expect(captured!.aborted).toBe(false);

    await act(async () => {
      fireEvent.click(cancelBtn);
    });

    expect(captured!.aborted).toBe(true);
  });

  it('uses chatStreamMultipart when pending attachments exist', async () => {
    mockChatStreamMultipart.mockImplementation(async (params: any) => {
      params.onAttachments?.([
        { kind: 'image', url: 'http://localhost:18790/api/media/s/x.png', mime: 'image/png', size: 4 },
      ]);
      params.onChunk('hi');
      return undefined;
    });

    render(<ChatPanel {...baseProps} />);

    const input = screen.getByTestId('attach-input') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'pic.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByTestId('pending-attachments')).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText(/Ask anything/i), {
      target: { value: 'describe' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));

    await waitFor(() => {
      expect(mockChatStreamMultipart).toHaveBeenCalledTimes(1);
    });
    expect(mockChatStream).not.toHaveBeenCalled();
    const callArgs = mockChatStreamMultipart.mock.calls[0][0];
    expect(callArgs.text).toBe('describe');
    expect(callArgs.attachments).toHaveLength(1);
    expect(callArgs.attachments[0].name).toBe('pic.png');
  });
});
