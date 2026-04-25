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
import { generateToolEntityId, resolveActiveProjectId } from './shared.js';
function resolveMaterialId(materialId, materialName) {
    return __awaiter(this, void 0, void 0, function* () {
        if (materialId) {
            return prisma.material.findUnique({
                where: { id: materialId },
                select: { id: true, name: true, currentStock: true },
            });
        }
        if (!materialName) {
            return null;
        }
        return prisma.material.findFirst({
            where: { name: { equals: materialName, mode: "insensitive" } },
            select: { id: true, name: true, currentStock: true },
            orderBy: { updatedAt: "desc" },
        });
    });
}
export const inventoryToolService = {
    listEquipment(toolCallId, args) {
        return __awaiter(this, void 0, void 0, function* () {
            const limit = Math.min(Number(args.limit) || 10, 20);
            const availableOnly = Boolean(args.availableOnly);
            const status = availableOnly ? "available" : args.status;
            const equipment = yield prisma.equipment.findMany({
                where: Object.assign(Object.assign({}, (args.projectId ? { projectId: String(args.projectId) } : {})), (status ? { status } : {})),
                select: {
                    id: true,
                    name: true,
                    type: true,
                    status: true,
                    project: { select: { name: true } },
                    hourlyRate: true,
                    dailyRate: true,
                    location: true,
                },
                orderBy: [{ status: "asc" }, { name: "asc" }],
                take: limit,
            });
            const lines = equipment.map((item) => {
                var _a;
                const project = ((_a = item.project) === null || _a === void 0 ? void 0 : _a.name) ? ` → ${item.project.name}` : "";
                return `• **${item.name}** (${item.type}) — ${item.status}${project}`;
            });
            return {
                toolCallId,
                name: "list_equipment",
                success: true,
                result: { equipment, count: equipment.length },
                displayMessage: equipment.length > 0
                    ? `🏗️ **Техника (${equipment.length}):**\n${lines.join("\n")}`
                    : "🏗️ Подходящая техника не найдена",
            };
        });
    },
    createMaterialMovement(toolCallId, args) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const quantity = Number(args.quantity);
            const type = String((_a = args.type) !== null && _a !== void 0 ? _a : "");
            if (!["receipt", "consumption", "return", "writeoff"].includes(type)) {
                return {
                    toolCallId,
                    name: "create_material_movement",
                    success: false,
                    result: { error: "Invalid movement type" },
                    displayMessage: "❌ Некорректный тип движения материала",
                };
            }
            if (!(quantity > 0)) {
                return {
                    toolCallId,
                    name: "create_material_movement",
                    success: false,
                    result: { error: "Quantity must be positive" },
                    displayMessage: "❌ Количество должно быть больше нуля",
                };
            }
            const material = yield resolveMaterialId(args.materialId, args.materialName);
            if (!material) {
                return {
                    toolCallId,
                    name: "create_material_movement",
                    success: false,
                    result: { error: "Material not found" },
                    displayMessage: "❌ Материал не найден",
                };
            }
            const projectId = yield resolveActiveProjectId(args.projectId);
            if (!projectId) {
                return {
                    toolCallId,
                    name: "create_material_movement",
                    success: false,
                    result: { error: "No project found" },
                    displayMessage: "❌ Нет доступного проекта для движения материала",
                };
            }
            const stockDelta = type === "receipt" || type === "return" ? quantity : -quantity;
            const movement = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                const created = yield tx.materialMovement.create({
                    data: {
                        id: generateToolEntityId(),
                        materialId: material.id,
                        projectId,
                        type,
                        quantity,
                        unitPrice: args.unitPrice ? Number(args.unitPrice) : null,
                        documentRef: args.documentRef ? String(args.documentRef) : null,
                        date: args.date ? new Date(String(args.date)) : new Date(),
                    },
                });
                const updatedMaterial = yield tx.material.update({
                    where: { id: material.id },
                    data: {
                        currentStock: Math.max(0, material.currentStock + stockDelta),
                    },
                    select: { id: true, name: true, currentStock: true, unit: true },
                });
                return { created, updatedMaterial };
            }));
            return {
                toolCallId,
                name: "create_material_movement",
                success: true,
                result: {
                    movementId: movement.created.id,
                    materialId: movement.updatedMaterial.id,
                    materialName: movement.updatedMaterial.name,
                    currentStock: movement.updatedMaterial.currentStock,
                    unit: movement.updatedMaterial.unit,
                    type,
                    quantity,
                },
                displayMessage: `📦 Движение материала записано: **${movement.updatedMaterial.name}** — ${type} ${quantity} ${(_b = movement.updatedMaterial.unit) !== null && _b !== void 0 ? _b : ""}. Остаток: ${movement.updatedMaterial.currentStock}`,
            };
        });
    },
};
