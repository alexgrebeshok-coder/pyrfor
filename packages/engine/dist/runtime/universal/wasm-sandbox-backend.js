var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export class WasmSandboxBackend {
    constructor() {
        this.backend = 'wasm';
    }
    isAvailable() {
        return __awaiter(this, void 0, void 0, function* () {
            return typeof WebAssembly !== 'undefined';
        });
    }
    run(options) {
        return __awaiter(this, void 0, void 0, function* () {
            void options;
            throw new Error('WasmSandboxBackend.run() is not yet implemented. Full WASM execution is deferred to the sandbox backend extraction milestone.');
        });
    }
}
