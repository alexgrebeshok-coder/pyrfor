var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
function getMissingSecrets(credentials, env) {
    return credentials
        .filter((credential) => credential.required !== false)
        .map((credential) => credential.envVar)
        .filter((envVar) => { var _a; return !((_a = env[envVar]) === null || _a === void 0 ? void 0 : _a.trim()); });
}
function buildStatusMessage(descriptor, configured, missingSecrets) {
    if (configured) {
        return `${descriptor.name} stub is configured and ready for deeper implementation.`;
    }
    return `${descriptor.name} stub is waiting for credentials: ${missingSecrets.join(", ")}.`;
}
export function createStubConnector(descriptor, env = process.env) {
    return Object.assign(Object.assign({}, descriptor), { getStatus() {
            return __awaiter(this, void 0, void 0, function* () {
                const missingSecrets = getMissingSecrets(descriptor.credentials, env);
                const configured = missingSecrets.length === 0;
                return Object.assign(Object.assign({}, descriptor), { configured, checkedAt: new Date().toISOString(), message: buildStatusMessage(descriptor, configured, missingSecrets), missingSecrets, status: configured ? "ok" : "pending" });
            });
        } });
}
