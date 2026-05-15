import React from 'react';
import { useDaemonHealth, type DaemonHealth } from '../hooks/useDaemonHealth';

function ageLabel(lastOk: number | null): string {
  if (lastOk === null) return '';
  const secs = Math.floor((Date.now() - lastOk) / 1000);
  return `, last ok: ${secs}s ago`;
}

const DOT_CLASS: Record<DaemonHealth, string> = {
  connected: 'conn-dot conn-dot--connected',
  reconnecting: 'conn-dot conn-dot--reconnecting',
  offline: 'conn-dot conn-dot--offline',
};

const LABELS: Record<DaemonHealth, string> = {
  connected: 'online',
  reconnecting: 'starting',
  offline: 'offline',
};

export default function ConnectionStatus() {
  const { status, lastOk } = useDaemonHealth();
  const label = `Daemon: ${status}${ageLabel(lastOk)}`;

  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={`daemon-badge daemon-badge--${status}`}
      data-testid="daemon-status"
    >
      <span className={DOT_CLASS[status]} />
      <span className="daemon-badge__label">Daemon {LABELS[status]}</span>
    </span>
  );
}
