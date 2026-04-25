/**
 * secrets-vault — Local encrypted secrets store using AES-256-GCM + scrypt.
 *
 * Vault file format (VaultSnapshot):
 *   { version:1, salt, iv, algo:'aes-256-gcm', kdf:'scrypt', ciphertext, tag }
 *   All binary fields stored as base64.
 *
 * Security notes:
 *   - Fresh 12-byte IV generated on every flush (salt kept per-session).
 *   - scrypt N=2^14, r=8, p=1, keylen=32 by default.
 *   - Derived key + salt zeroed in memory on lock().
 *   - GCM auth-tag ensures integrity — tampered ciphertext throws on decrypt.
 *   - File writes are atomic (tmp + rename).
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_SCRYPT = { N: 1 << 14, r: 8, p: 1, keylen: 32 };
// ── Crypto helpers ────────────────────────────────────────────────────────────
function scryptAsync(passphrase, salt, params) {
    const { N, r, p, keylen } = params;
    return new Promise((resolve, reject) => crypto.scrypt(passphrase, salt, keylen, { N, r, p }, (err, key) => err ? reject(err) : resolve(key)));
}
function encryptGCM(plaintext, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
        iv: iv.toString('base64'),
        ciphertext: ct.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
    };
}
function decryptGCM(ciphertext, iv, tag, key) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    try {
        return Buffer.concat([
            decipher.update(Buffer.from(ciphertext, 'base64')),
            decipher.final(),
        ]).toString('utf8');
    }
    catch (_a) {
        throw new Error('VAULT_UNLOCK_FAILED');
    }
}
function writeAtomic(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmp, data, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, filePath);
}
function nanoid() {
    return crypto.randomBytes(12).toString('hex');
}
// ── Factory ───────────────────────────────────────────────────────────────────
export function createSecretsVault(opts) {
    const { storePath, clock = () => Date.now(), logger = () => undefined, scryptParams: scryptOverride = {}, } = opts;
    const scrypt = Object.assign(Object.assign({}, DEFAULT_SCRYPT), scryptOverride);
    // ── In-memory state ────────────────────────────────────────────────────────
    let entries = new Map();
    let derivedKey = null;
    let currentSalt = null; // salt that produced derivedKey
    // ── Internal helpers ───────────────────────────────────────────────────────
    function assertUnlocked() {
        if (!derivedKey)
            throw new Error('VAULT_LOCKED');
    }
    function clearState() {
        if (derivedKey) {
            derivedKey.fill(0);
            derivedKey = null;
        }
        if (currentSalt) {
            currentSalt.fill(0);
            currentSalt = null;
        }
        entries = new Map();
    }
    function serializeEntries() {
        return JSON.stringify(Array.from(entries.values()));
    }
    function deserializeEntries(json) {
        const arr = JSON.parse(json);
        return new Map(arr.map((e) => [e.name, e]));
    }
    // ── unlock ─────────────────────────────────────────────────────────────────
    function unlock(passphrase) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!fs.existsSync(storePath)) {
                // No vault file yet — create fresh empty vault
                const salt = crypto.randomBytes(16);
                const key = yield scryptAsync(passphrase, salt, scrypt);
                clearState();
                derivedKey = key;
                currentSalt = salt;
                entries = new Map();
                logger('vault: created empty vault', { storePath });
                return;
            }
            // Load and decrypt existing snapshot
            let snapshot;
            try {
                snapshot = JSON.parse(fs.readFileSync(storePath, 'utf8'));
            }
            catch (_a) {
                throw new Error('VAULT_UNLOCK_FAILED');
            }
            const salt = Buffer.from(snapshot.salt, 'base64');
            const key = yield scryptAsync(passphrase, salt, scrypt);
            let plaintext;
            try {
                plaintext = decryptGCM(snapshot.ciphertext, snapshot.iv, snapshot.tag, key);
            }
            catch (_b) {
                key.fill(0);
                throw new Error('VAULT_UNLOCK_FAILED');
            }
            let loaded;
            try {
                loaded = deserializeEntries(plaintext);
            }
            catch (_c) {
                key.fill(0);
                throw new Error('VAULT_UNLOCK_FAILED');
            }
            clearState();
            derivedKey = key;
            currentSalt = salt;
            entries = loaded;
            logger('vault: unlocked', { storePath, count: entries.size });
        });
    }
    // ── lock ───────────────────────────────────────────────────────────────────
    function lock() {
        clearState();
        logger('vault: locked');
    }
    // ── isUnlocked ─────────────────────────────────────────────────────────────
    function isUnlocked() {
        return derivedKey !== null;
    }
    // ── changePassphrase ───────────────────────────────────────────────────────
    function changePassphrase(oldP, newP) {
        return __awaiter(this, void 0, void 0, function* () {
            assertUnlocked();
            // Verify old passphrase by re-deriving with current salt and comparing
            const reKey = yield scryptAsync(oldP, currentSalt, scrypt);
            const valid = reKey.length === derivedKey.length &&
                crypto.timingSafeEqual(reKey, derivedKey);
            reKey.fill(0);
            if (!valid)
                throw new Error('VAULT_WRONG_PASSPHRASE');
            // Derive new key with a fresh salt
            const newSalt = crypto.randomBytes(16);
            const newKey = yield scryptAsync(newP, newSalt, scrypt);
            // Write encrypted snapshot with new key before swapping memory state
            const { iv, ciphertext, tag } = encryptGCM(serializeEntries(), newKey);
            const snapshot = {
                version: 1,
                salt: newSalt.toString('base64'),
                iv,
                algo: 'aes-256-gcm',
                kdf: 'scrypt',
                ciphertext,
                tag,
            };
            writeAtomic(storePath, JSON.stringify(snapshot, null, 2));
            if (derivedKey)
                derivedKey.fill(0);
            if (currentSalt)
                currentSalt.fill(0);
            derivedKey = newKey;
            currentSalt = newSalt;
            logger('vault: passphrase changed');
        });
    }
    // ── put ────────────────────────────────────────────────────────────────────
    function put(name, value, putOpts) {
        var _a, _b;
        assertUnlocked();
        const now = clock();
        const existing = entries.get(name);
        const entry = {
            id: (_a = existing === null || existing === void 0 ? void 0 : existing.id) !== null && _a !== void 0 ? _a : nanoid(),
            name,
            value,
            createdAt: (_b = existing === null || existing === void 0 ? void 0 : existing.createdAt) !== null && _b !== void 0 ? _b : now,
            updatedAt: now,
        };
        if ((putOpts === null || putOpts === void 0 ? void 0 : putOpts.tags) !== undefined)
            entry.tags = putOpts.tags;
        else if ((existing === null || existing === void 0 ? void 0 : existing.tags) !== undefined)
            entry.tags = existing.tags;
        if ((putOpts === null || putOpts === void 0 ? void 0 : putOpts.meta) !== undefined)
            entry.meta = putOpts.meta;
        else if ((existing === null || existing === void 0 ? void 0 : existing.meta) !== undefined)
            entry.meta = existing.meta;
        entries.set(name, entry);
        return entry;
    }
    // ── get ────────────────────────────────────────────────────────────────────
    function get(name) {
        assertUnlocked();
        return entries.get(name);
    }
    // ── getValue ───────────────────────────────────────────────────────────────
    function getValue(name) {
        var _a;
        assertUnlocked();
        return (_a = entries.get(name)) === null || _a === void 0 ? void 0 : _a.value;
    }
    // ── list ───────────────────────────────────────────────────────────────────
    function list(filter) {
        assertUnlocked();
        let result = Array.from(entries.values());
        if (filter === null || filter === void 0 ? void 0 : filter.tag) {
            const tag = filter.tag;
            result = result.filter((e) => { var _a; return (_a = e.tags) === null || _a === void 0 ? void 0 : _a.includes(tag); });
        }
        if (filter === null || filter === void 0 ? void 0 : filter.namePrefix) {
            const prefix = filter.namePrefix;
            result = result.filter((e) => e.name.startsWith(prefix));
        }
        return result;
    }
    // ── remove ─────────────────────────────────────────────────────────────────
    function remove(name) {
        assertUnlocked();
        return entries.delete(name);
    }
    // ── rotate ─────────────────────────────────────────────────────────────────
    function rotate(name, newValue) {
        assertUnlocked();
        const existing = entries.get(name);
        if (!existing)
            return undefined;
        const updated = Object.assign(Object.assign({}, existing), { value: newValue, updatedAt: clock() });
        entries.set(name, updated);
        return updated;
    }
    // ── flush ──────────────────────────────────────────────────────────────────
    function flush() {
        return __awaiter(this, void 0, void 0, function* () {
            assertUnlocked();
            const { iv, ciphertext, tag } = encryptGCM(serializeEntries(), derivedKey);
            const snapshot = {
                version: 1,
                salt: currentSalt.toString('base64'),
                iv,
                algo: 'aes-256-gcm',
                kdf: 'scrypt',
                ciphertext,
                tag,
            };
            writeAtomic(storePath, JSON.stringify(snapshot, null, 2));
            logger('vault: flushed', { storePath, count: entries.size });
        });
    }
    // ── reset ──────────────────────────────────────────────────────────────────
    function reset() {
        return __awaiter(this, void 0, void 0, function* () {
            assertUnlocked();
            entries = new Map();
            yield flush();
            logger('vault: reset');
        });
    }
    // ── Public API ─────────────────────────────────────────────────────────────
    return {
        unlock,
        lock,
        isUnlocked,
        changePassphrase,
        put,
        get,
        getValue,
        list,
        remove,
        rotate,
        flush,
        reset,
    };
}
