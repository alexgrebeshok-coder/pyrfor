import * as nodePath from 'node:path';
import * as nodeFs from 'node:fs';
import * as nodeFsPromises from 'node:fs/promises';

export type FsEvent = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
type AnyEvent = FsEvent | 'all' | 'ready' | 'error';
type Listener = (path: string, evt?: FsEvent) => void;

export interface FileWatcherOptions {
  ignore?: (string | RegExp)[];
  include?: (string | RegExp)[];
  debounceMs?: number;
  recursive?: boolean;
  clock?: () => number;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  fsWatch?: typeof nodeFs.watch;
}

function matches(patterns: (string | RegExp)[], filePath: string): boolean {
  return patterns.some(p =>
    typeof p === 'string' ? filePath.includes(p) : p.test(filePath)
  );
}

export function createFileWatcher(opts: FileWatcherOptions = {}) {
  const {
    ignore = [],
    include = [],
    debounceMs = 50,
    recursive = true,
    setTimer = (cb, ms) => setTimeout(cb, ms),
    clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    fsWatch = nodeFs.watch,
  } = opts;

  const listeners = new Map<AnyEvent, Set<Listener>>();
  const snapshot = new Map<string, nodeFs.Stats>();
  const watchers = new Map<string, nodeFs.FSWatcher>();
  const timers = new Map<string, unknown>();
  let closed = false;

  function shouldExclude(filePath: string): boolean {
    if (matches(ignore, filePath)) return true;
    if (include.length > 0 && !matches(include, filePath)) return true;
    return false;
  }

  function emit(event: AnyEvent, filePath: string, fsEvt?: FsEvent): void {
    if (closed) return;
    const s = listeners.get(event);
    if (s) {
      for (const fn of s) {
        try { fn(filePath, fsEvt); } catch { /* swallow listener errors */ }
      }
    }
    if (event !== 'all' && event !== 'ready' && event !== 'error') {
      const allSet = listeners.get('all');
      if (allSet) {
        for (const fn of allSet) {
          try { fn(filePath, event as FsEvent); } catch { /* swallow */ }
        }
      }
    }
  }

  async function processPath(filePath: string): Promise<void> {
    if (shouldExclude(filePath)) return;

    let st: nodeFs.Stats | null = null;
    try { st = await nodeFsPromises.stat(filePath); } catch { st = null; }

    const prev = snapshot.get(filePath);
    if (st === null) {
      if (prev !== undefined) {
        snapshot.delete(filePath);
        const isDir = prev.isDirectory();
        emit(isDir ? 'unlinkDir' : 'unlink', filePath, isDir ? 'unlinkDir' : 'unlink');
      }
    } else if (prev === undefined) {
      snapshot.set(filePath, st);
      const isDir = st.isDirectory();
      emit(isDir ? 'addDir' : 'add', filePath, isDir ? 'addDir' : 'add');
    } else if (st.mtimeMs !== prev.mtimeMs) {
      snapshot.set(filePath, st);
      emit('change', filePath, 'change');
    }
  }

  function schedule(filePath: string): void {
    if (closed) return;
    const existing = timers.get(filePath);
    if (existing !== undefined) clearTimer(existing);
    const h = setTimer(() => {
      timers.delete(filePath);
      processPath(filePath).catch(() => {});
    }, debounceMs);
    timers.set(filePath, h);
  }

  async function walkDir(dir: string): Promise<void> {
    let entries: nodeFs.Dirent[];
    try { entries = await nodeFsPromises.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = nodePath.join(dir, e.name);
      if (shouldExclude(full)) continue;
      let st: nodeFs.Stats;
      try { st = await nodeFsPromises.stat(full); } catch { continue; }
      snapshot.set(full, st);
      if (e.isDirectory()) {
        emit('addDir', full, 'addDir');
        if (recursive) await walkDir(full);
      } else {
        emit('add', full, 'add');
      }
    }
  }

  async function watch(rootPath: string): Promise<void> {
    if (closed || watchers.has(rootPath)) return;

    let st: nodeFs.Stats;
    try { st = await nodeFsPromises.stat(rootPath); }
    catch (err) {
      emit('error', String(err));
      return;
    }

    snapshot.set(rootPath, st);
    if (st.isDirectory()) {
      emit('addDir', rootPath, 'addDir');
      await walkDir(rootPath);
    } else {
      emit('add', rootPath, 'add');
    }

    try {
      const w = fsWatch(
        rootPath,
        { recursive: recursive !== false } as nodeFs.WatchOptions,
        (_eventType, filename) => {
          if (closed || !filename) return;
          const name = String(filename);
          const full = nodePath.isAbsolute(name) ? name : nodePath.join(rootPath, name);
          schedule(full);
        }
      );
      w.on('error', (err: Error) => emit('error', err.message));
      watchers.set(rootPath, w);
    } catch (err) {
      emit('error', String(err));
      return;
    }

    emit('ready', rootPath);
  }

  function unwatch(rootPath: string): void {
    const w = watchers.get(rootPath);
    if (w) { w.close(); watchers.delete(rootPath); }
    for (const k of snapshot.keys()) {
      if (k === rootPath || k.startsWith(rootPath + nodePath.sep)) {
        snapshot.delete(k);
      }
    }
  }

  function on(event: AnyEvent, listener: Listener): () => void {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(listener);
    return () => listeners.get(event)?.delete(listener);
  }

  async function close(): Promise<void> {
    closed = true;
    for (const w of watchers.values()) w.close();
    watchers.clear();
    for (const h of timers.values()) clearTimer(h);
    timers.clear();
    listeners.clear();
  }

  function getWatched(): string[] {
    return [...watchers.keys()];
  }

  return { watch, unwatch, on, close, getWatched };
}
