import type { DaemonState } from './daemon-client';

export interface StatusText {
  text: string;
  tooltip: string;
}

export function formatStatus(state: DaemonState): StatusText {
  switch (state) {
    case 'idle':
      return { text: '$(plug) Pyrfor: idle', tooltip: 'Pyrfor daemon not connected' };
    case 'connecting':
      return { text: '$(sync~spin) Pyrfor: connecting…', tooltip: 'Connecting to Pyrfor daemon…' };
    case 'open':
      return { text: '$(check) Pyrfor: connected', tooltip: 'Pyrfor daemon connected' };
    case 'closed':
      return { text: '$(circle-slash) Pyrfor: disconnected', tooltip: 'Pyrfor daemon disconnected' };
    case 'error':
      return { text: '$(error) Pyrfor: error', tooltip: 'Pyrfor daemon connection error' };
  }
}
