/**
 * Shared argv-based command runner — no implicit shell unless bash|sh -c is explicit.
 */

import { spawn } from 'node:child_process';

export const EXEC_MAX_OUTPUT = 100_000;

export interface ExecRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/** Shell metacharacters that require explicit `bash -c` / `sh -c` opt-in. */
export const SHELL_METACHAR_RE = /[;|`]|&&|\|\||\$\(/;

export function commandRequiresExplicitShell(command: string): boolean {
  if (/^(bash|sh)\s+-c\s+[\s\S]+$/i.test(command.trim())) return false;
  return SHELL_METACHAR_RE.test(command);
}

/**
 * Minimal command tokenizer. Splits on whitespace, respects single- and double-quoted substrings.
 */
export function tokenizeCommand(cmd: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === ' ' && !inSingle && !inDouble) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

export function parseCommandArgv(command: string): { file: string; args: string[] } {
  const shellMatch = command.trim().match(/^(bash|sh)\s+-c\s+([\s\S]+)$/i);
  if (shellMatch) {
    let script = shellMatch[2]!.trim();
    if (
      (script.startsWith('"') && script.endsWith('"'))
      || (script.startsWith("'") && script.endsWith("'"))
    ) {
      script = script.slice(1, -1);
    }
    return { file: shellMatch[1]!, args: ['-c', script] };
  }
  const tokens = tokenizeCommand(command);
  return { file: tokens[0] ?? '', args: tokens.slice(1) };
}

export function runCommandArgv(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<ExecRunResult> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const { file, args } = parseCommandArgv(command);

    const child = spawn(file, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > EXEC_MAX_OUTPUT) {
        stdout = stdout.slice(0, EXEC_MAX_OUTPUT) + '…[truncated]';
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > EXEC_MAX_OUTPUT) {
        stderr = stderr.slice(0, EXEC_MAX_OUTPUT) + '…[truncated]';
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - t0;
      if (timedOut) {
        resolve({ stdout, stderr: 'TIMEOUT', exitCode: -1, durationMs });
      } else {
        resolve({ stdout, stderr, exitCode: code ?? 0, durationMs });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      const code = (err as NodeJS.ErrnoException).code;
      const exitCode = code === 'ENOENT' ? 127 : -1;
      resolve({ stdout, stderr: err.message, exitCode, durationMs: Date.now() - t0 });
    });
  });
}
