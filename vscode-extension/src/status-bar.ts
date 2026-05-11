import type { DaemonState } from './daemon-client';
import type { ExecutionMode } from './execution-mode';

export interface StatusText {
  text: string;
  tooltip: string;
}

export function formatStatus(state: DaemonState, executionMode?: ExecutionMode): StatusText {
  const withExecutionMode = (status: StatusText): StatusText => {
    if (!executionMode) return status;
    const modeLabel = executionMode === 'freeclaude' ? 'FreeClaude' : 'Pyrfor';
    return {
      text: `${status.text} · ${modeLabel}`,
      tooltip: `${status.tooltip}\nExecution mode: ${modeLabel}`,
    };
  };

  switch (state) {
    case 'idle':
      return withExecutionMode({ text: '$(plug) Pyrfor: idle', tooltip: 'Pyrfor daemon not connected' });
    case 'connecting':
      return withExecutionMode({ text: '$(sync~spin) Pyrfor: connecting…', tooltip: 'Connecting to Pyrfor daemon…' });
    case 'open':
      return withExecutionMode({ text: '$(check) Pyrfor: connected', tooltip: 'Pyrfor daemon connected' });
    case 'closed':
      return withExecutionMode({ text: '$(circle-slash) Pyrfor: disconnected', tooltip: 'Pyrfor daemon disconnected' });
    case 'error':
      return withExecutionMode({ text: '$(error) Pyrfor: error', tooltip: 'Pyrfor daemon connection error' });
  }
}
