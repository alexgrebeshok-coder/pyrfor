// Fixed demo projects seed - all required fields included
// Generated: 2026-03-21

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(dateStr: string, days: number): Date {
  const date = new Date(dateStr);
  return new Date(date.getTime() + days * DAY_MS);
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

// Simplified projects data (30 projects)
const projectsData = [
  {
    id: "proj_001",
    name: "Реконструкция автодороги Сургут-Нефтеюганск",
    description: "Капитальный ремонт участка федеральной трассы 15 км",
    status: "active",
    direction: "construction",
    priority: "high",
    health: "good",
    start: "2025-01-15",
    end: "2026-07-15",
    budgetPlan: 150000000,
    budgetFact: 157500000,
    progress: 45,
    location: "Сургут",
    teamIds: ["tm_ivan", "tm_alexey", "tm_andrey"],
  },
  {
    id: "proj_002",
    name: "ЖК «Северное сияние» - 3 очередь",
    description: "Строительство 16-этажного жилого дома на 240 квартир",
    status: "active",
    direction: "construction",
    priority: "critical",
    health: "good",
    start: "2025-03-01",
    end: "2027-03-01",
    budgetPlan: 315000000,
    budgetFact: 321300000,
    progress: 72,
    location: "Тюмень",
    teamIds: ["tm_olga", "tm_natasha", "tm_elena"],
  },
  {
    id: "proj_003",
    name: "Логистический хаб «Западный»",
    description: "Централизованная база для дистрибуции FMCG по ЦФО",
    status: "active",
    direction: "logistics",
    priority: "high",
    health: "good",
    start: "2025-02-10",
    end: "2026-02-10",
    budgetPlan: 97500000,
    budgetFact: 101400000,
    progress: 62,
    location: "Москва",
    teamIds: ["tm_sergey", "tm_pavel"],
  },
  {
    id: "proj_004",
    name: "Торговый центр «Мега-Сити»",
    description: "Строительство ТЦ площадью 45 000 м²",
    status: "at_risk",
    direction: "construction",
    priority: "critical",
    health: "critical",
    start: "2024-06-01",
    end: "2026-10-01",
    budgetPlan: 650000000,
    budgetFact: 812500000,
    progress: 65,
    location: "Санкт-Петербург",
    teamIds: ["tm_ivan", "tm_olga", "tm_marina", "tm_tatyana"],
  },
  {
    id: "proj_005",
    name: "Переработка дунита ЧЭМК",
    description: "Извлечение полезных компонентов из дунитовых отвалов",
    status: "planning",
    direction: "metallurgy",
    priority: "high",
    health: "warning",
    start: "2025-06-01",
    end: "2026-02-01",
    budgetPlan: 52500000,
    budgetFact: 52500000,
    progress: 20,
    location: "Салехард",
    teamIds: ["tm_alexey", "tm_dmitry"],
  },
  {
    id: "proj_006",
    name: "Поставка бентонитовых глин из Казахстана",
    description: "Закупка 30 000 тонн бентонита для буровых растворов",
    status: "active",
    direction: "trade",
    priority: "medium",
    health: "good",
    start: "2025-04-15",
    end: "2026-02-15",
    budgetPlan: 48500000,
    budgetFact: 47530000,
    progress: 70,
    location: "Астана, Казахстан",
    teamIds: ["tm_sergey", "tm_elena"],
  },
  {
    id: "proj_007",
    name: "Автоцентр KIA «Сургут-Авто»",
    description: "Строительство дилерского центра с сервисом",
    status: "at_risk",
    direction: "trade",
    priority: "high",
    health: "critical",
    start: "2024-08-01",
    end: "2025-10-01",
    budgetPlan: 112500000,
    budgetFact: 144000000,
    progress: 55,
    location: "Сургут",
    teamIds: ["tm_ivan", "tm_natasha"],
  },
  {
    id: "proj_008",
    name: "Благоустройство парка «Городской сад»",
    description: "Реконструкция парковой зоны: дорожки, освещение",
    status: "active",
    direction: "construction",
    priority: "medium",
    health: "good",
    start: "2025-05-01",
    end: "2026-02-01",
    budgetPlan: 63500000,
    budgetFact: 64135000,
    progress: 40,
    location: "Тюмень",
    teamIds: ["tm_andrey", "tm_tatyana"],
  },
  {
    id: "proj_009",
    name: "Спортивный комплекс «Ледовый дворец»",
    description: "Ледовый дворец на 2000 мест, бассейн",
    status: "active",
    direction: "construction",
    priority: "high",
    health: "warning",
    start: "2024-11-01",
    end: "2026-09-01",
    budgetPlan: 365000000,
    budgetFact: 419750000,
    progress: 52,
    location: "Новосибирск",
    teamIds: ["tm_ivan", "tm_olga", "tm_alexey"],
  },
  {
    id: "proj_010",
    name: "Реконструкция набережной р. Оби",
    description: "Благоустройство 2.5 км набережной",
    status: "active",
    direction: "construction",
    priority: "high",
    health: "good",
    start: "2024-07-01",
    end: "2025-10-01",
    budgetPlan: 160000000,
    budgetFact: 164800000,
    progress: 78,
    location: "Сургут",
    teamIds: ["tm_andrey", "tm_dmitry"],
  },
];

async function main() {
  console.log("🌱 Seeding demo projects...\n");

  // Create team members first
  const teamMembers = [
    { id: "tm_ivan", name: "Иван Петров", role: "Руководитель проекта", initials: "ИП", email: "ivan@demo.ru" },
    { id: "tm_olga", name: "Ольга Сидорова", role: "Финансовый директор", initials: "ОС", email: "olga@demo.ru" },
    { id: "tm_alexey", name: "Алексей Козлов", role: "Инженер ПТО", initials: "АК", email: "alexey@demo.ru" },
    { id: "tm_marina", name: "Марина Новикова", role: "Юрист", initials: "МН", email: "marina@demo.ru" },
    { id: "tm_sergey", name: "Сергей Волков", role: "Логист", initials: "СВ", email: "sergey@demo.ru" },
    { id: "tm_natasha", name: "Наталья Морозова", role: "Бухгалтер", initials: "НМ", email: "natasha@demo.ru" },
    { id: "tm_andrey", name: "Андрей Соколов", role: "Прораб", initials: "АС", email: "andrey@demo.ru" },
    { id: "tm_elena", name: "Елена Кузнецова", role: "Менеджер по закупкам", initials: "ЕК", email: "elena@demo.ru" },
    { id: "tm_dmitry", name: "Дмитрий Федоров", role: "Геодезист", initials: "ДФ", email: "dmitry@demo.ru" },
    { id: "tm_pavel", name: "Павел Ильин", role: "Снабженец", initials: "ПИ", email: "pavel@demo.ru" },
    { id: "tm_tatyana", name: "Татьяна Романова", role: "Архитектор", initials: "ТР", email: "tatyana@demo.ru" },
  ];

  console.log("👥 Creating team members...");
  for (const member of teamMembers) {
    await prisma.teamMember.upsert({
      where: { id: member.id },
      create: member,
      update: member,
    });
  }
  console.log("   ✅ Team members ready\n");

  // Create projects
  for (const projectData of projectsData) {
    console.log(`📦 Creating project: ${projectData.name}`);

    try {
      // Create project
      const project = await prisma.project.create({
        data: {
          id: projectData.id,
          name: projectData.name,
          description: projectData.description,
          status: projectData.status,
          direction: projectData.direction,
          priority: projectData.priority,
          health: projectData.health,
          start: new Date(projectData.start),
          end: new Date(projectData.end),
          budgetPlan: projectData.budgetPlan,
          budgetFact: projectData.budgetFact,
          progress: projectData.progress,
          location: projectData.location,
          team: {
            connect: projectData.teamIds.map((id) => ({ id })),
          },
        },
      });

      // Create board
      const board = await prisma.board.create({
        data: {
          id: generateId("board"),
          name: `Доска: ${project.name}`,
          projectId: project.id,
          updatedAt: new Date(),
        },
      });

      // Create columns
      const columns = await Promise.all([
        prisma.column.create({
          data: {
            id: generateId("col"),
            title: "К выполнению",
            order: 0,
            color: "#6B7280",
            boardId: board.id,
          },
        }),
        prisma.column.create({
          data: {
            id: generateId("col"),
            title: "В работе",
            order: 1,
            color: "#3B82F6",
            boardId: board.id,
          },
        }),
        prisma.column.create({
          data: {
            id: generateId("col"),
            title: "На проверке",
            order: 2,
            color: "#F59E0B",
            boardId: board.id,
          },
        }),
        prisma.column.create({
          data: {
            id: generateId("col"),
            title: "Готово",
            order: 3,
            color: "#10B981",
            boardId: board.id,
          },
        }),
      ]);

      // Create sample tasks
      const taskNames = [
        "Подготовка документации",
        "Согласование",
        "Закупка материалов",
        "Выполнение работ",
        "Проверка качества",
        "Сдача объекта",
      ];

      for (let i = 0; i < taskNames.length; i++) {
        const taskProgress = (projectData.progress / 100) * taskNames.length;
        let taskStatus = "todo";
        let columnId = columns[0].id;

        if (i < taskProgress - 1) {
          taskStatus = "done";
          columnId = columns[3].id;
        } else if (i < taskProgress) {
          taskStatus = "in_progress";
          columnId = columns[1].id;
        }

        await prisma.task.create({
          data: {
            id: generateId("task"),
            title: taskNames[i],
            status: taskStatus,
            priority: i === 0 ? "critical" : "medium",
            dueDate: addDays(projectData.start, (i + 1) * 15),
            projectId: project.id,
            assigneeId: projectData.teamIds[i % projectData.teamIds.length],
            columnId: columnId,
            updatedAt: new Date(),
          },
        });
      }

      // Create milestones
      const milestoneNames = ["Проект", "Разрешение", "Фундамент", "Каркас", "Сдача"];
      for (let i = 0; i < milestoneNames.length; i++) {
        const milestoneProgress = ((i + 1) / milestoneNames.length) * 100;
        let milestoneStatus = "upcoming";
        if (milestoneProgress < projectData.progress - 10) {
          milestoneStatus = "completed";
        } else if (milestoneProgress < projectData.progress + 10) {
          milestoneStatus = "in_progress";
        }

        await prisma.milestone.create({
          data: {
            id: generateId("ms"),
            title: milestoneNames[i],
            description: `Этап ${i + 1}`,
            date: addDays(projectData.start, ((i + 1) / milestoneNames.length) * 180),
            status: milestoneStatus,
            projectId: project.id,
            updatedAt: new Date(),
          },
        });
      }

      // Create documents
      const docTypes = [
        { title: "Проектная документация", type: "pdf" },
        { title: "Смета", type: "xlsx" },
        { title: "Календарный план", type: "xlsx" },
        { title: "Договор", type: "docx" },
      ];

      for (const doc of docTypes) {
        await prisma.document.create({
          data: {
            id: generateId("doc"),
            title: doc.title,
            filename: `${doc.title.toLowerCase().replace(/ /g, "_")}.${doc.type}`,
            url: `/documents/${project.id}/${doc.title.toLowerCase().replace(/ /g, "_")}.${doc.type}`,
            type: doc.type,
            size: Math.floor(Math.random() * 2000000) + 100000,
            projectId: project.id,
            updatedAt: new Date(),
          },
        });
      }

      // Create risks
      const riskTemplates = [
        { title: "Погодные условия", prob: "high", impact: "high", severity: 9 },
        { title: "Срыв поставок", prob: "medium", impact: "high", severity: 6 },
        { title: "Кадровый дефицит", prob: "high", impact: "medium", severity: 6 },
      ];

      for (const risk of riskTemplates) {
        await prisma.risk.create({
          data: {
            id: generateId("risk"),
            title: risk.title,
            description: `Риск: ${risk.title}`,
            probability: risk.prob,
            impact: risk.impact,
            severity: risk.severity,
            status: "open",
            projectId: project.id,
            ownerId: projectData.teamIds[0],
            updatedAt: new Date(),
          },
        });
      }

      console.log(`   ✅ Created with board, tasks, milestones, documents, risks\n`);
    } catch (error) {
      console.error(`   ❌ Error: ${error}\n`);
    }
  }

  // Final count
  const counts = {
    projects: await prisma.project.count(),
    tasks: await prisma.task.count(),
    milestones: await prisma.milestone.count(),
    documents: await prisma.document.count(),
    risks: await prisma.risk.count(),
    boards: await prisma.board.count(),
    columns: await prisma.column.count(),
    teamMembers: await prisma.teamMember.count(),
  };

  console.log("=".repeat(60));
  console.log("📊 FINAL COUNTS:");
  console.log("=".repeat(60));
  console.log(`   Projects:    ${counts.projects}`);
  console.log(`   Tasks:       ${counts.tasks}`);
  console.log(`   Milestones:  ${counts.milestones}`);
  console.log(`   Documents:   ${counts.documents}`);
  console.log(`   Risks:       ${counts.risks}`);
  console.log(`   Boards:      ${counts.boards}`);
  console.log(`   Columns:     ${counts.columns}`);
  console.log(`   Team Members: ${counts.teamMembers}`);
  console.log("=".repeat(60));
  console.log("✅ Seeding complete!");
}

main()
  .catch((e) => {
    console.error("❌ Fatal error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
