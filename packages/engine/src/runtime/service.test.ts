/**
 * service.test.ts — unit tests for createServiceManager
 *
 * Mocks:
 *   - node:child_process  execFile (callback-style, intercepted by execFileAsync wrapper)
 *   - node:fs/promises    writeFile, readFile, unlink, mkdir, access
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

// ─── Module mocks (hoisted before imports) ────────────────────────────────────

vi.mock('node:child_process', () => ({
  // Include default to satisfy Vitest's ESM default-export check.
  default: {},
  execFile: vi.fn(
    (
      _file: string,
      _args: string[],
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      cb(null, '', '');
      return {} as import('node:child_process').ChildProcess;
    },
  ),
}));

vi.mock('node:fs/promises', () => ({
  default: {},
  writeFile: vi.fn(() => Promise.resolve()),
  readFile: vi.fn(() => Promise.resolve('')),
  unlink: vi.fn(() => Promise.resolve()),
  mkdir: vi.fn(() => Promise.resolve(undefined)),
  access: vi.fn(() => Promise.resolve()),
}));

// ─── Import mocked symbols + module under test ────────────────────────────────

import { execFile } from 'node:child_process';
import { writeFile, readFile, unlink, access } from 'node:fs/promises';
import { createServiceManager } from './service';

// ─── Test constants ───────────────────────────────────────────────────────────

const HOME = homedir();
const PLIST_PATH = resolve(HOME, 'Library/LaunchAgents/dev.pyrfor.runtime.plist');
const SYSTEMD_PATH = resolve(HOME, '.config/systemd/user/pyrfor-runtime.service');
const WORKING_DIR = '/test/workdir';

// ─── Platform helpers ─────────────────────────────────────────────────────────

const ORIGINAL_PLATFORM = Object.getOwnPropertyDescriptor(process, 'platform')!;

function setPlatform(plat: string) {
  Object.defineProperty(process, 'platform', { value: plat, configurable: true, writable: false });
}

function restorePlatform() {
  Object.defineProperty(process, 'platform', ORIGINAL_PLATFORM);
}

// ─── Reset mocks before each test ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── plistName ────────────────────────────────────────────────────────────────

describe('plistName', () => {
  afterEach(restorePlatform);

  it('plist label equals dev.pyrfor.runtime', async () => {
    setPlatform('darwin');
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/bin/node' });

    const content = String(vi.mocked(writeFile).mock.calls[0][1]);
    expect(content).toContain('<string>dev.pyrfor.runtime</string>');
  });
});

// ─── darwin ──────────────────────────────────────────────────────────────────

describe('darwin', () => {
  beforeEach(() => setPlatform('darwin'));
  afterEach(restorePlatform);

  it('install writes plist to ~/Library/LaunchAgents/dev.pyrfor.runtime.plist', async () => {
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/local/bin/node', args: ['server.js'] });

    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(PLIST_PATH, expect.any(String), 'utf-8');
  });

  it('install plist contains ProgramArguments with executablePath and args', async () => {
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/local/bin/node', args: ['server.js'] });

    const content = String(vi.mocked(writeFile).mock.calls[0][1]);
    expect(content).toContain('<string>/usr/local/bin/node</string>');
    expect(content).toContain('<string>server.js</string>');
  });

  it('install plist has RunAtLoad=true, KeepAlive=true, stdout/stderr paths', async () => {
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/bin/node' });

    const content = String(vi.mocked(writeFile).mock.calls[0][1]);
    expect(content).toContain('<key>RunAtLoad</key>');
    expect(content).toContain('<key>KeepAlive</key>');
    expect(content).toContain('<key>StandardOutPath</key>');
    expect(content).toContain('<key>StandardErrorPath</key>');
  });

  it('install plist contains WorkingDirectory', async () => {
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/bin/node' });

    const content = String(vi.mocked(writeFile).mock.calls[0][1]);
    expect(content).toContain(`<string>${WORKING_DIR}</string>`);
  });

  it('install calls launchctl load -w <plistPath>', async () => {
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/bin/node' });

    expect(vi.mocked(execFile)).toHaveBeenCalledWith(
      'launchctl',
      ['load', '-w', PLIST_PATH],
      expect.any(Function),
    );
  });

  it('install merges envFile and envOverrides — overrides win', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('KEY_A=from_file\nKEY_B=file_val\n');
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({
      executablePath: '/usr/bin/node',
      envFile: '/project/.env',
      envOverrides: { KEY_B: 'override_val', KEY_C: 'only_override' },
    });

    const content = String(vi.mocked(writeFile).mock.calls[0][1]);
    expect(content).toContain('<key>KEY_A</key>');
    expect(content).toContain('<string>from_file</string>');
    expect(content).toContain('<key>KEY_B</key>');
    expect(content).toContain('<string>override_val</string>'); // override wins
    expect(content).not.toContain('<string>file_val</string>');
    expect(content).toContain('<key>KEY_C</key>');
    expect(content).toContain('<string>only_override</string>');
  });

  it('uninstall calls launchctl unload and deletes plist', async () => {
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.uninstall();

    expect(vi.mocked(execFile)).toHaveBeenCalledWith(
      'launchctl',
      ['unload', PLIST_PATH],
      expect.any(Function),
    );
    expect(vi.mocked(unlink)).toHaveBeenCalledWith(PLIST_PATH);
  });

  it('uninstall skips unlink when plist does not exist', async () => {
    vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT'));
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.uninstall();

    expect(vi.mocked(unlink)).not.toHaveBeenCalled();
  });

  it('status returns running=true when launchctl list shows PID', async () => {
    vi.mocked(execFile).mockImplementationOnce((_f, _a, cb: any) => {
      cb(null, '{\n\t"PID" = 4567;\n\t"Label" = "dev.pyrfor.runtime";\n}', '');
      return {} as any;
    });
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    const result = await mgr.status();

    expect(result.running).toBe(true);
    expect(result.platform).toBe('darwin');
  });

  it('status returns running=false when launchctl list fails', async () => {
    vi.mocked(execFile).mockImplementationOnce((_f, _a, cb: any) => {
      cb(new Error('Could not find service'), '', '');
      return {} as any;
    });
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    const result = await mgr.status();

    expect(result.running).toBe(false);
    expect(result.platform).toBe('darwin');
  });

  it('status returns running=false when launchctl list shows PID=0 (stopped but registered)', async () => {
    vi.mocked(execFile).mockImplementationOnce((_f, _a, cb: any) => {
      cb(null, '{\n\t"PID" = 0;\n\t"Label" = "dev.pyrfor.runtime";\n}', '');
      return {} as any;
    });
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    const result = await mgr.status();

    expect(result.running).toBe(false);
    expect(result.platform).toBe('darwin');
  });

  it('plist escapes XML special characters (&, <, >) in executablePath and args', async () => {
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/bin/node &bin', args: ['<script>', 'a>b'] });

    const content = String(vi.mocked(writeFile).mock.calls[0][1]);
    expect(content).toContain('&amp;');
    expect(content).toContain('&lt;');
    expect(content).toContain('&gt;');
    expect(content).not.toContain('node &bin');
    expect(content).not.toContain('<script>');
    expect(content).not.toContain('a>b');
  });

  it('plist escapes XML special characters in working directory', async () => {
    const mgr = createServiceManager({ workingDir: '/path/with/&special/<chars>/a>b' });
    await mgr.install({ executablePath: '/usr/bin/node' });

    const content = String(vi.mocked(writeFile).mock.calls[0][1]);
    expect(content).toContain('&amp;special');
    expect(content).toContain('&lt;chars');
    expect(content).toContain('a&gt;b');
  });

  it('install is idempotent — second call overwrites plist without throwing', async () => {
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/bin/node' });
    await mgr.install({ executablePath: '/usr/bin/node', args: ['--updated'] });

    expect(vi.mocked(writeFile)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(writeFile).mock.calls[1][0]).toBe(PLIST_PATH);
    const secondContent = String(vi.mocked(writeFile).mock.calls[1][1]);
    expect(secondContent).toContain('<string>--updated</string>');
  });

  it('install plist contains exact StdoutPath and StderrPath', async () => {
    const logDir = resolve(HOME, 'Library/Logs/pyrfor-runtime');
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/bin/node' });

    const content = String(vi.mocked(writeFile).mock.calls[0][1]);
    expect(content).toContain(`<string>${logDir}/stdout.log</string>`);
    expect(content).toContain(`<string>${logDir}/stderr.log</string>`);
  });
});

// ─── linux ───────────────────────────────────────────────────────────────────

describe('linux', () => {
  beforeEach(() => setPlatform('linux'));
  afterEach(restorePlatform);

  it('install writes unit to ~/.config/systemd/user/pyrfor-runtime.service', async () => {
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/bin/node', args: ['app.js'] });

    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(SYSTEMD_PATH, expect.any(String), 'utf-8');
  });

  it('install unit contains ExecStart with executablePath and args', async () => {
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/bin/node', args: ['app.js'] });

    const content = String(vi.mocked(writeFile).mock.calls[0][1]);
    expect(content).toContain('ExecStart=/usr/bin/node app.js');
  });

  it('install unit contains Environment= lines', async () => {
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({
      executablePath: '/usr/bin/node',
      envOverrides: { MY_VAR: 'hello', ANOTHER: 'world' },
    });

    const content = String(vi.mocked(writeFile).mock.calls[0][1]);
    expect(content).toContain('Environment=MY_VAR=hello');
    expect(content).toContain('Environment=ANOTHER=world');
  });

  it('install unit has Restart=always and WorkingDirectory', async () => {
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/bin/node' });

    const content = String(vi.mocked(writeFile).mock.calls[0][1]);
    expect(content).toContain(`WorkingDirectory=${WORKING_DIR}`);
    expect(content).toContain('Restart=always');
  });

  it('install calls systemctl --user enable --now pyrfor-runtime', async () => {
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/bin/node' });

    expect(vi.mocked(execFile)).toHaveBeenCalledWith(
      'systemctl',
      ['--user', 'enable', '--now', 'pyrfor-runtime'],
      expect.any(Function),
    );
  });

  it('uninstall calls systemctl disable --now and deletes unit', async () => {
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.uninstall();

    expect(vi.mocked(execFile)).toHaveBeenCalledWith(
      'systemctl',
      ['--user', 'disable', '--now', 'pyrfor-runtime'],
      expect.any(Function),
    );
    expect(vi.mocked(unlink)).toHaveBeenCalledWith(SYSTEMD_PATH);
  });

  it('status returns running=true when is-active outputs "active"', async () => {
    vi.mocked(execFile).mockImplementationOnce((_f, _a, cb: any) => {
      cb(null, 'active\n', '');
      return {} as any;
    });
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    const result = await mgr.status();

    expect(result.running).toBe(true);
    expect(result.platform).toBe('linux');
  });

  it('status returns running=false when is-active exits non-zero', async () => {
    vi.mocked(execFile).mockImplementationOnce((_f, _a, cb: any) => {
      const err = Object.assign(new Error('inactive'), { stdout: 'inactive\n' });
      cb(err as Error, 'inactive\n', '');
      return {} as any;
    });
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    const result = await mgr.status();

    expect(result.running).toBe(false);
    expect(result.platform).toBe('linux');
  });

  it('uninstall skips unlink when unit file does not exist', async () => {
    vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT'));
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.uninstall();

    expect(vi.mocked(unlink)).not.toHaveBeenCalled();
  });

  it('uninstall handles systemctl failure gracefully without throwing', async () => {
    vi.mocked(execFile).mockImplementationOnce((_f, _a, cb: any) => {
      cb(new Error('systemctl: service not found'), '', '');
      return {} as any;
    });
    const mgr = createServiceManager({ workingDir: WORKING_DIR });

    await expect(mgr.uninstall()).resolves.toBeUndefined();
  });
});

// ─── envFile parser ───────────────────────────────────────────────────────────

describe('envFile parser', () => {
  beforeEach(() => setPlatform('darwin'));
  afterEach(restorePlatform);

  it('skips comment lines starting with #', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('# comment\nKEY_A=value_a\n');
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/bin/node', envFile: '/test/.env' });

    const content = String(vi.mocked(writeFile).mock.calls[0][1]);
    expect(content).toContain('<key>KEY_A</key>');
    expect(content).toContain('<string>value_a</string>');
    expect(content).not.toContain('comment');
  });

  it('skips blank lines', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('\n\nKEY_B=val_b\n\n');
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/bin/node', envFile: '/test/.env' });

    const content = String(vi.mocked(writeFile).mock.calls[0][1]);
    expect(content).toContain('<key>KEY_B</key>');
  });

  it('strips surrounding double quotes from value', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('MY_KEY="quoted value"\n');
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/bin/node', envFile: '/test/.env' });

    const content = String(vi.mocked(writeFile).mock.calls[0][1]);
    expect(content).toContain('<string>quoted value</string>');
  });

  it('strips surrounding single quotes from value', async () => {
    vi.mocked(readFile).mockResolvedValueOnce("MY_KEY='single quoted'\n");
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/bin/node', envFile: '/test/.env' });

    const content = String(vi.mocked(writeFile).mock.calls[0][1]);
    expect(content).toContain('<string>single quoted</string>');
  });

  it('handles mixed lines: comments, blanks, valid entries', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      '# config file\nFOO=bar\n\n# another comment\nBAZ=qux\n',
    );
    const mgr = createServiceManager({ workingDir: WORKING_DIR });
    await mgr.install({ executablePath: '/usr/bin/node', envFile: '/test/.env' });

    const content = String(vi.mocked(writeFile).mock.calls[0][1]);
    expect(content).toContain('<key>FOO</key>');
    expect(content).toContain('<string>bar</string>');
    expect(content).toContain('<key>BAZ</key>');
    expect(content).toContain('<string>qux</string>');
  });
});

// ─── unsupported platform ─────────────────────────────────────────────────────

describe('unsupported platform', () => {
  afterEach(restorePlatform);

  it('throws for win32', () => {
    setPlatform('win32');
    expect(() => createServiceManager({ workingDir: WORKING_DIR })).toThrow(/not supported/);
  });
});
