import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categories = [
  { code: "materials", name: "Материалы", color: "#0ea5e9", icon: "box" },
  { code: "labor", name: "ФОТ и подряд", color: "#10b981", icon: "users" },
  { code: "equipment", name: "Техника и аренда", color: "#f59e0b", icon: "truck" },
  { code: "transport", name: "Логистика и доставка", color: "#8b5cf6", icon: "route" },
  { code: "overhead", name: "Накладные расходы", color: "#64748b", icon: "building" },
  { code: "design", name: "Проектирование", color: "#ec4899", icon: "pencil" },
  { code: "permits", name: "Разрешения и согласования", color: "#ef4444", icon: "stamp" },
  { code: "subcontract", name: "Субподряд", color: "#f97316", icon: "handshake" },
];

const equipmentTypes = [
  "crane",
  "excavator",
  "bulldozer",
  "truck",
  "mixer",
  "loader",
  "roller",
  "generator",
  "pump",
];

async function main() {
  console.log("🌱 Seeding expense taxonomy...");

  for (const category of categories) {
    await prisma.expenseCategory.upsert({
      where: { code: category.code },
      update: {
        name: category.name,
        color: category.color,
        icon: category.icon,
      },
      create: {
        id: `expense-category-${category.code}`,
        ...category,
      },
    });
  }

  for (const [index, type] of equipmentTypes.entries()) {
    await prisma.equipment.upsert({
      where: {
        id: `equipment-template-${type}`,
      },
      update: {
        name: `Template ${type}`,
        type,
        status: "available",
      },
      create: {
        id: `equipment-template-${type}`,
        name: `Template ${type}`,
        type,
        status: "available",
        dailyRate: 15000 + index * 2500,
      },
    });
  }

  console.log(`✅ Expense categories: ${categories.length}`);
  console.log(`✅ Equipment templates: ${equipmentTypes.length}`);
}

main()
  .catch((error) => {
    console.error("❌ Expense taxonomy seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
