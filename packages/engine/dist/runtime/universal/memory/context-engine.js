var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { createHash } from 'node:crypto';
import { hashContextPack, stableStringify } from '../../context-pack.js';
export class ContextEngine {
    constructor(options) {
        var _a;
        this.compressors = [];
        this.compiler = options.compiler;
        this.memoryProvider = options.memoryProvider;
        this.compressors.push(...((_a = options.compressors) !== null && _a !== void 0 ? _a : []));
    }
    registerCompressor(compressor) {
        this.compressors.push(compressor);
    }
    compile(input) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield this.compiler.compile(input);
            if (this.compressors.length === 0)
                return result;
            let sections = result.pack.sections;
            for (const compressor of this.compressors) {
                sections = yield compressor.compress(sections);
            }
            const _a = result.pack, { hash: _oldHash } = _a, withoutHashBase = __rest(_a, ["hash"]);
            const withoutHash = Object.assign(Object.assign({}, withoutHashBase), { sections });
            const hash = hashContextPack(withoutHash);
            return Object.assign(Object.assign({}, result), { hash, canonicalJson: stableStringify(withoutHash), pack: Object.assign(Object.assign({}, result.pack), { sections,
                    hash }) });
        });
    }
    getMemoryProvider() {
        return this.memoryProvider;
    }
}
export class TruncateBudgetCompressor {
    constructor(maxSections) {
        this.maxSections = maxSections;
        this.name = 'truncate-budget';
    }
    compress(sections) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.maxSections <= 0)
                return [];
            return [...sections]
                .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
                .slice(0, this.maxSections);
        });
    }
}
export class DeduplicateCompressor {
    constructor() {
        this.name = 'deduplicate';
    }
    compress(sections) {
        return __awaiter(this, void 0, void 0, function* () {
            const seen = new Set();
            const result = [];
            for (const section of sections) {
                const key = createHash('sha256').update(stableStringify(section.content)).digest('hex');
                if (seen.has(key))
                    continue;
                seen.add(key);
                result.push(section);
            }
            return result;
        });
    }
}
