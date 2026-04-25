/**
 * tar-bundler.ts — Pure-JS USTAR tar pack/unpack (POSIX 1003.1-1990).
 * Uses only Node built-ins: fs, path, zlib, crypto, os, stream.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TarEntry {
  name: string;
  data: Buffer | string;
  mode?: number;
  mtime?: number;
  type?: 'file' | 'dir' | 'symlink';
  linkname?: string;
  uid?: number;
  gid?: number;
  uname?: string;
  gname?: string;
}

export interface UnpackedEntry {
  name: string;
  data: Buffer;
  mode: number;
  mtime: number;
  type: 'file' | 'dir' | 'symlink';
  linkname: string;
  uid: number;
  gid: number;
  uname: string;
  gname: string;
}

export interface PackFromDirOptions {
  filter?: (relPath: string, stat: fs.Stats) => boolean;
  gzip?: boolean;
}

export interface UnpackToDirOptions {
  gzip?: boolean | 'auto';
  strip?: number;
  overwrite?: boolean;
}

export interface UnpackToDirResult {
  written: string[];
}

// ---------------------------------------------------------------------------
// USTAR header layout constants
// ---------------------------------------------------------------------------

const BLOCK = 512;

const OFF_NAME      = 0;    const LEN_NAME      = 100;
const OFF_MODE      = 100;  const LEN_MODE      = 8;
const OFF_UID       = 108;  const LEN_UID       = 8;
const OFF_GID       = 116;  const LEN_GID       = 8;
const OFF_SIZE      = 124;  const LEN_SIZE      = 12;
const OFF_MTIME     = 136;  const LEN_MTIME     = 12;
const OFF_CHKSUM    = 148;  const LEN_CHKSUM    = 8;
const OFF_TYPEFLAG  = 156;
const OFF_LINKNAME  = 157;  const LEN_LINKNAME  = 100;
const OFF_MAGIC     = 257;  // "ustar\0"
const OFF_VERSION   = 263;  // "00"
const OFF_UNAME     = 265;  const LEN_UNAME     = 32;
const OFF_GNAME     = 297;  const LEN_GNAME     = 32;
const OFF_DEVMAJOR  = 329;  const LEN_DEVMAJOR  = 8;
const OFF_DEVMINOR  = 337;  const LEN_DEVMINOR  = 8;
const OFF_PREFIX    = 345;  const LEN_PREFIX    = 155;
// pad: 12 bytes (500–511)

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

function writeOctal(buf: Buffer, offset: number, len: number, value: number): void {
  // null-terminated octal string, right-aligned in field
  const s = value.toString(8).padStart(len - 1, '0') + '\0';
  buf.write(s, offset, 'ascii');
}

function readOctal(buf: Buffer, offset: number, len: number): number {
  // skip leading/trailing nulls and spaces
  const s = buf.toString('ascii', offset, offset + len).replace(/\0.*$/, '').trim();
  if (s === '') return 0;
  return parseInt(s, 8) || 0;
}

function writeString(buf: Buffer, offset: number, len: number, value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  const copyLen = Math.min(bytes.length, len);
  bytes.copy(buf, offset, 0, copyLen);
  // zero-fill remainder
  buf.fill(0, offset + copyLen, offset + len);
}

function readString(buf: Buffer, offset: number, len: number): string {
  const end = buf.indexOf(0, offset);
  const realEnd = end === -1 || end > offset + len ? offset + len : end;
  return buf.toString('utf8', offset, realEnd);
}

function computeChecksum(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    // treat checksum field as spaces
    if (i >= OFF_CHKSUM && i < OFF_CHKSUM + LEN_CHKSUM) {
      sum += 0x20;
    } else {
      sum += header[i]!;
    }
  }
  return sum;
}

function writeChecksum(header: Buffer): void {
  const sum = computeChecksum(header);
  // format: "%06o\0 " — 6 octal digits + NUL + space
  const s = sum.toString(8).padStart(6, '0') + '\0 ';
  header.write(s, OFF_CHKSUM, 'ascii');
}

function verifyChecksum(header: Buffer): void {
  const stored = readOctal(header, OFF_CHKSUM, LEN_CHKSUM);
  const computed = computeChecksum(header);
  if (stored !== computed) {
    throw new Error(`checksum mismatch: stored ${stored}, computed ${computed}`);
  }
}

function isZeroBlock(buf: Buffer, offset: number): boolean {
  for (let i = offset; i < offset + BLOCK; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Name splitting (name≤100, prefix≤155)
// ---------------------------------------------------------------------------

function splitName(fullName: string): { name: string; prefix: string } {
  if (fullName.length <= LEN_NAME) {
    return { name: fullName, prefix: '' };
  }
  // find last '/' within first (LEN_PREFIX + 1 + LEN_NAME) chars
  const maxTotal = LEN_PREFIX + 1 + LEN_NAME; // 256
  const search = fullName.length > maxTotal ? fullName.slice(fullName.length - maxTotal) : fullName;
  // We need: prefix/name where prefix <= 155, name <= 100
  // Walk backwards to find last '/' where name part fits in 100
  let splitIdx = -1;
  for (let i = fullName.length - 2; i >= 0; i--) {
    if (fullName[i] === '/') {
      const namePart = fullName.slice(i + 1);
      const prefixPart = fullName.slice(0, i);
      if (namePart.length <= LEN_NAME && prefixPart.length <= LEN_PREFIX) {
        splitIdx = i;
        break;
      }
    }
  }
  if (splitIdx === -1) {
    throw new Error(`filename too long: ${fullName}`);
  }
  return { name: fullName.slice(splitIdx + 1), prefix: fullName.slice(0, splitIdx) };
}

// ---------------------------------------------------------------------------
// Build a single 512-byte USTAR header
// ---------------------------------------------------------------------------

function buildHeader(entry: Required<TarEntry> & { name: string }): Buffer {
  const hdr = Buffer.alloc(BLOCK, 0);

  const typeflag = entry.type === 'dir' ? '5' : entry.type === 'symlink' ? '2' : '0';
  const { name, prefix } = splitName(entry.name);

  writeString(hdr, OFF_NAME,     LEN_NAME,     name);
  writeOctal (hdr, OFF_MODE,     LEN_MODE,     entry.mode);
  writeOctal (hdr, OFF_UID,      LEN_UID,      entry.uid);
  writeOctal (hdr, OFF_GID,      LEN_GID,      entry.gid);
  writeOctal (hdr, OFF_SIZE,     LEN_SIZE,     entry.type === 'symlink' || entry.type === 'dir' ? 0 : Buffer.isBuffer(entry.data) ? entry.data.length : Buffer.from(entry.data as string).length);
  writeOctal (hdr, OFF_MTIME,    LEN_MTIME,    entry.mtime);
  hdr.fill(0x20, OFF_CHKSUM, OFF_CHKSUM + LEN_CHKSUM); // placeholder spaces
  hdr.write(typeflag, OFF_TYPEFLAG, 'ascii');
  writeString(hdr, OFF_LINKNAME, LEN_LINKNAME, entry.linkname);
  hdr.write('ustar\0', OFF_MAGIC,   'ascii');
  hdr.write('00',      OFF_VERSION, 'ascii');
  writeString(hdr, OFF_UNAME,    LEN_UNAME,    entry.uname);
  writeString(hdr, OFF_GNAME,    LEN_GNAME,    entry.gname);
  writeOctal (hdr, OFF_DEVMAJOR, LEN_DEVMAJOR, 0);
  writeOctal (hdr, OFF_DEVMINOR, LEN_DEVMINOR, 0);
  writeString(hdr, OFF_PREFIX,   LEN_PREFIX,   prefix);

  writeChecksum(hdr);
  return hdr;
}

// ---------------------------------------------------------------------------
// packEntries
// ---------------------------------------------------------------------------

export function packEntries(entries: TarEntry[]): Buffer {
  const chunks: Buffer[] = [];

  for (const raw of entries) {
    const type  = raw.type ?? 'file';
    const data  = type === 'dir' || type === 'symlink'
      ? Buffer.alloc(0)
      : Buffer.isBuffer(raw.data) ? raw.data : Buffer.from(raw.data as string, 'utf8');

    const entry: Required<TarEntry> = {
      name:     raw.name,
      data,
      mode:     raw.mode  ?? (type === 'dir' ? 0o755 : 0o644),
      mtime:    raw.mtime ?? 0,
      type,
      linkname: raw.linkname ?? '',
      uid:      raw.uid   ?? 0,
      gid:      raw.gid   ?? 0,
      uname:    raw.uname ?? '',
      gname:    raw.gname ?? '',
    };

    const header = buildHeader(entry);
    chunks.push(header);

    if (data.length > 0) {
      chunks.push(data);
      // pad to 512-byte boundary
      const rem = data.length % BLOCK;
      if (rem !== 0) {
        chunks.push(Buffer.alloc(BLOCK - rem, 0));
      }
    }
  }

  // end-of-archive: two zeroed 512-byte blocks
  chunks.push(Buffer.alloc(BLOCK * 2, 0));

  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// unpackBuffer
// ---------------------------------------------------------------------------

export function unpackBuffer(buf: Buffer): UnpackedEntry[] {
  const entries: UnpackedEntry[] = [];
  let offset = 0;

  while (offset + BLOCK <= buf.length) {
    if (isZeroBlock(buf, offset)) {
      // check second zero block — end of archive
      if (offset + BLOCK * 2 <= buf.length && isZeroBlock(buf, offset + BLOCK)) {
        break;
      }
      // single zero block — skip
      offset += BLOCK;
      continue;
    }

    const header = buf.slice(offset, offset + BLOCK);
    verifyChecksum(header);

    const nameRaw   = readString(header, OFF_NAME,     LEN_NAME);
    const prefix    = readString(header, OFF_PREFIX,   LEN_PREFIX);
    const fullName  = prefix ? `${prefix}/${nameRaw}` : nameRaw;
    const mode      = readOctal (header, OFF_MODE,     LEN_MODE);
    const uid       = readOctal (header, OFF_UID,      LEN_UID);
    const gid       = readOctal (header, OFF_GID,      LEN_GID);
    const size      = readOctal (header, OFF_SIZE,     LEN_SIZE);
    const mtime     = readOctal (header, OFF_MTIME,    LEN_MTIME);
    const typeflag  = header.toString('ascii', OFF_TYPEFLAG, OFF_TYPEFLAG + 1);
    const linkname  = readString(header, OFF_LINKNAME, LEN_LINKNAME);
    const uname     = readString(header, OFF_UNAME,    LEN_UNAME);
    const gname     = readString(header, OFF_GNAME,    LEN_GNAME);

    const type: 'file' | 'dir' | 'symlink' =
      typeflag === '5' ? 'dir'
      : typeflag === '2' ? 'symlink'
      : 'file';

    offset += BLOCK;

    let data: Buffer;
    if (type === 'file' && size > 0) {
      data = buf.slice(offset, offset + size);
      const blocks = Math.ceil(size / BLOCK);
      offset += blocks * BLOCK;
    } else {
      data = Buffer.alloc(0);
    }

    entries.push({ name: fullName, data, mode, mtime, type, linkname, uid, gid, uname, gname });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// packFromDir
// ---------------------------------------------------------------------------

export async function packFromDir(
  dir: string,
  options: PackFromDirOptions = {},
): Promise<Buffer> {
  const { filter, gzip = false } = options;
  const entries: TarEntry[] = [];

  function walk(absDir: string, relBase: string): void {
    const names = fs.readdirSync(absDir).sort();
    for (const n of names) {
      const abs = path.join(absDir, n);
      const rel = relBase ? `${relBase}/${n}` : n;
      const stat = fs.lstatSync(abs);

      if (filter && !filter(rel, stat)) continue;

      if (stat.isDirectory()) {
        entries.push({
          name:  rel + '/',
          data:  Buffer.alloc(0),
          type:  'dir',
          mode:  stat.mode & 0o7777,
          mtime: Math.floor(stat.mtimeMs / 1000),
          uid:   stat.uid,
          gid:   stat.gid,
        });
        walk(abs, rel);
      } else if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(abs);
        entries.push({
          name:     rel,
          data:     Buffer.alloc(0),
          type:     'symlink',
          linkname: target,
          mode:     0o644,
          mtime:    Math.floor(stat.mtimeMs / 1000),
          uid:      stat.uid,
          gid:      stat.gid,
        });
      } else if (stat.isFile()) {
        entries.push({
          name:  rel,
          data:  fs.readFileSync(abs),
          type:  'file',
          mode:  stat.mode & 0o7777,
          mtime: Math.floor(stat.mtimeMs / 1000),
          uid:   stat.uid,
          gid:   stat.gid,
        });
      }
    }
  }

  walk(dir, '');

  const raw = packEntries(entries);
  return gzip ? zlib.gzipSync(raw) : raw;
}

// ---------------------------------------------------------------------------
// unpackToDir
// ---------------------------------------------------------------------------

export async function unpackToDir(
  buf: Buffer,
  dir: string,
  options: UnpackToDirOptions = {},
): Promise<UnpackToDirResult> {
  const { gzip = 'auto', strip = 0, overwrite = false } = options;

  // gzip detection
  let raw: Buffer;
  const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
  if (gzip === 'auto') {
    raw = isGzip ? zlib.gunzipSync(buf) : buf;
  } else if (gzip === true) {
    raw = zlib.gunzipSync(buf);
  } else {
    raw = buf;
  }

  const entries = unpackBuffer(raw);
  const written: string[] = [];
  const absDir = path.resolve(dir);

  fs.mkdirSync(absDir, { recursive: true });

  for (const entry of entries) {
    // strip leading path components
    let entryName = entry.name;
    if (strip > 0) {
      const parts = entryName.split('/').filter(Boolean);
      if (parts.length <= strip) continue;
      entryName = parts.slice(strip).join('/');
      if (entry.type === 'dir') entryName += '/';
    }

    // path traversal check
    const resolved = path.resolve(absDir, entryName);
    if (!resolved.startsWith(absDir + path.sep) && resolved !== absDir) {
      throw new Error('path traversal blocked');
    }

    if (entry.type === 'dir') {
      fs.mkdirSync(resolved, { recursive: true });
      continue;
    }

    if (entry.type === 'symlink') {
      const linkDir = path.dirname(resolved);
      fs.mkdirSync(linkDir, { recursive: true });
      if (fs.existsSync(resolved)) {
        if (!overwrite) continue;
        fs.unlinkSync(resolved);
      }
      fs.symlinkSync(entry.linkname, resolved);
      written.push(resolved);
      continue;
    }

    // regular file
    const fileDir = path.dirname(resolved);
    fs.mkdirSync(fileDir, { recursive: true });

    if (fs.existsSync(resolved) && !overwrite) {
      throw new Error(`file already exists: ${resolved}`);
    }

    fs.writeFileSync(resolved, entry.data, { mode: entry.mode, flag: 'w' });
    written.push(resolved);
  }

  return { written };
}
