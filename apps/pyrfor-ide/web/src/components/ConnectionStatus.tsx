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

export default function ConnectionStatus() {
  const { status, lastOk } = useDaemonHealth();
  const label = `Daemon: ${status}${ageLabel(lastOk)}`;

  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={DOT_CLASS[status]}
    />
  );
}
