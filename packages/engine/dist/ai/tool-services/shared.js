var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { prisma } from '../../prisma.js';
export function generateToolEntityId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
export function resolveActiveProjectId(projectId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (projectId) {
            return projectId;
        }
        const first = yield prisma.project.findFirst({
            where: { status: { not: "archived" } },
            orderBy: { updatedAt: "desc" },
            select: { id: true },
        });
        return (_a = first === null || first === void 0 ? void 0 : first.id) !== null && _a !== void 0 ? _a : null;
    });
}
