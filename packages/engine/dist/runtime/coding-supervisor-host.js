var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
export class CodingSupervisorHost {
    constructor(options) {
        this.workerBridge = options.workerBridge;
        this.onFrameResult = options.onFrameResult;
        this.logger = options.logger;
    }
    handleAcpEvent(event) {
        return __awaiter(this, void 0, void 0, function* () {
            if (event.type !== 'worker_frame')
                return null;
            return this.handleWorkerFrame(event.data, 'acp');
        });
    }
    handleFreeClaudeEvent(event) {
        return __awaiter(this, void 0, void 0, function* () {
            if (event.type !== 'worker_frame')
                return null;
            return this.handleWorkerFrame(event.frame, 'freeclaude');
        });
    }
    consumeAcpEvents(events) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, events_1, events_1_1;
            var _b, e_1, _c, _d;
            const results = [];
            try {
                for (_a = true, events_1 = __asyncValues(events); events_1_1 = yield events_1.next(), _b = events_1_1.done, !_b; _a = true) {
                    _d = events_1_1.value;
                    _a = false;
                    const event = _d;
                    const result = yield this.handleAcpEvent(event);
                    if (result)
                        results.push(result);
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (!_a && !_b && (_c = events_1.return)) yield _c.call(events_1);
                }
                finally { if (e_1) throw e_1.error; }
            }
            return results;
        });
    }
    consumeFreeClaudeEvents(events) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, events_2, events_2_1;
            var _b, e_2, _c, _d;
            const results = [];
            try {
                for (_a = true, events_2 = __asyncValues(events); events_2_1 = yield events_2.next(), _b = events_2_1.done, !_b; _a = true) {
                    _d = events_2_1.value;
                    _a = false;
                    const event = _d;
                    const result = yield this.handleFreeClaudeEvent(event);
                    if (result)
                        results.push(result);
                }
            }
            catch (e_2_1) { e_2 = { error: e_2_1 }; }
            finally {
                try {
                    if (!_a && !_b && (_c = events_2.return)) yield _c.call(events_2);
                }
                finally { if (e_2) throw e_2.error; }
            }
            return results;
        });
    }
    handleWorkerFrame(frame, source) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const result = yield this.workerBridge.handle(frame);
            yield ((_a = this.onFrameResult) === null || _a === void 0 ? void 0 : _a.call(this, result, source));
            if (!result.ok) {
                (_b = this.logger) === null || _b === void 0 ? void 0 : _b.call(this, 'warn', 'coding-supervisor-host: worker frame rejected', { source, result });
            }
            return result;
        });
    }
}
