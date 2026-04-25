import { spawn as ptySpawn } from 'node-pty';

function probeShell(): string {
  if (process.platform === 'win32') {
    return process.env['ComSpec'] ?? 'cmd.exe';
  }

  return '/bin/sh';
}

function probeCwd(): string {
  if (process.platform === 'win32') {
    return process.cwd();
  }

  return '/tmp';
}

export const nodePtySupported = (() => {
  try {
    const pty = ptySpawn(probeShell(), [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: probeCwd(),
      env: process.env,
    });
    pty.kill();
    return true;
  } catch {
    return false;
  }
})();
