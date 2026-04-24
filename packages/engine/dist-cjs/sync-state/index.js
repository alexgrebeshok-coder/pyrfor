"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markDerivedSyncSuccess = exports.markDerivedSyncStarted = exports.markDerivedSyncError = exports.getDerivedSyncCheckpoint = void 0;
var service_1 = require("./service");
Object.defineProperty(exports, "getDerivedSyncCheckpoint", { enumerable: true, get: function () { return service_1.getDerivedSyncCheckpoint; } });
Object.defineProperty(exports, "markDerivedSyncError", { enumerable: true, get: function () { return service_1.markDerivedSyncError; } });
Object.defineProperty(exports, "markDerivedSyncStarted", { enumerable: true, get: function () { return service_1.markDerivedSyncStarted; } });
Object.defineProperty(exports, "markDerivedSyncSuccess", { enumerable: true, get: function () { return service_1.markDerivedSyncSuccess; } });
