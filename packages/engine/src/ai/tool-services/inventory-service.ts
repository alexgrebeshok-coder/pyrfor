import { prisma } from "@/lib/prisma";
import type { AIToolResult } from "@/lib/ai/tools";
import { generateToolEntityId, resolveActiveProjectId } from "@/lib/ai/tool-services/shared";

async function resolveMaterialId(
  materialId?: string,
  materialName?: string
): Promise<{ id: string; name: string; currentStock: number } | null> {
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
}

export const inventoryToolService = {
  async listEquipment(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult> {
    const limit = Math.min(Number(args.limit) || 10, 20);
    const availableOnly = Boolean(args.availableOnly);
    const status = availableOnly ? "available" : (args.status as string | undefined);

    const equipment = await prisma.equipment.findMany({
      where: {
        ...(args.projectId ? { projectId: String(args.projectId) } : {}),
        ...(status ? { status } : {}),
      },
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
      const project = item.project?.name ? ` → ${item.project.name}` : "";
      return `• **${item.name}** (${item.type}) — ${item.status}${project}`;
    });

    return {
      toolCallId,
      name: "list_equipment",
      success: true,
      result: { equipment, count: equipment.length },
      displayMessage:
        equipment.length > 0
          ? `🏗️ **Техника (${equipment.length}):**\n${lines.join("\n")}`
          : "🏗️ Подходящая техника не найдена",
    };
  },

  async createMaterialMovement(
    toolCallId: string,
    args: Record<string, unknown>
  ): Promise<AIToolResult> {
    const quantity = Number(args.quantity);
    const type = String(args.type ?? "");

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

    const material = await resolveMaterialId(
      args.materialId as string | undefined,
      args.materialName as string | undefined
    );
    if (!material) {
      return {
        toolCallId,
        name: "create_material_movement",
        success: false,
        result: { error: "Material not found" },
        displayMessage: "❌ Материал не найден",
      };
    }

    const projectId = await resolveActiveProjectId(args.projectId as string | undefined);
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

    const movement = await prisma.$transaction(async (tx) => {
      const created = await tx.materialMovement.create({
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

      const updatedMaterial = await tx.material.update({
        where: { id: material.id },
        data: {
          currentStock: Math.max(0, material.currentStock + stockDelta),
        },
        select: { id: true, name: true, currentStock: true, unit: true },
      });

      return { created, updatedMaterial };
    });

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
      displayMessage: `📦 Движение материала записано: **${movement.updatedMaterial.name}** — ${type} ${quantity} ${movement.updatedMaterial.unit ?? ""}. Остаток: ${movement.updatedMaterial.currentStock}`,
    };
  },
};
