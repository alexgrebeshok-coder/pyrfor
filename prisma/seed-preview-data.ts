import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * DAY_MS);
}

const now = new Date();

const teamMembers = [
  {
    id: "preview-team-anna",
    name: "Анна Кузнецова",
    initials: "АК",
    role: "Руководитель проекта",
    email: "anna.preview@ceoclaw.dev",
    capacity: 95,
    allocated: 70,
  },
  {
    id: "preview-team-boris",
    name: "Борис Волков",
    initials: "БВ",
    role: "Финансовый контролер",
    email: "boris.preview@ceoclaw.dev",
    capacity: 85,
    allocated: 60,
  },
  {
    id: "preview-team-irina",
    name: "Ирина Смирнова",
    initials: "ИС",
    role: "Инженер ПТО",
    email: "irina.preview@ceoclaw.dev",
    capacity: 100,
    allocated: 80,
  },
  {
    id: "preview-team-maxim",
    name: "Максим Орлов",
    initials: "МО",
    role: "Прораб",
    email: "maxim.preview@ceoclaw.dev",
    capacity: 100,
    allocated: 85,
  },
  {
    id: "preview-team-sofia",
    name: "София Белова",
    initials: "СБ",
    role: "Юрист",
    email: "sofia.preview@ceoclaw.dev",
    capacity: 80,
    allocated: 45,
  },
];

const projects = [
  {
    id: "preview-project-north",
    name: "Северный логистический коридор",
    description: "Расширение складского и транспортного плеча для северного направления.",
    status: "active",
    direction: "logistics",
    priority: "high",
    health: "good",
    location: "Сургут",
    budgetPlan: 148_000_000,
    budgetFact: 141_500_000,
    progress: 62,
    start: addDays(now, -55),
    end: addDays(now, 130),
    teamIds: ["preview-team-anna", "preview-team-boris", "preview-team-maxim"],
  },
  {
    id: "preview-project-campus",
    name: "Корпоративный кампус CEOClaw",
    description: "Подготовка новой площадки и IT-контура для управляющей команды.",
    status: "at_risk",
    direction: "construction",
    priority: "critical",
    health: "warning",
    location: "Тюмень",
    budgetPlan: 96_000_000,
    budgetFact: 102_300_000,
    progress: 48,
    start: addDays(now, -90),
    end: addDays(now, 95),
    teamIds: ["preview-team-anna", "preview-team-irina", "preview-team-sofia"],
  },
  {
    id: "preview-project-control",
    name: "Контур управленческой отчетности",
    description: "Сборка единого контура executive-отчетности и документации.",
    status: "planning",
    direction: "operations",
    priority: "medium",
    health: "good",
    location: "Москва",
    budgetPlan: 34_000_000,
    budgetFact: 11_200_000,
    progress: 28,
    start: addDays(now, -20),
    end: addDays(now, 80),
    teamIds: ["preview-team-boris", "preview-team-irina", "preview-team-sofia"],
  },
] as const;

const boards = projects.map((project) => ({
  id: `${project.id}-board`,
  name: `Доска: ${project.name}`,
  projectId: project.id,
}));

const columns = boards.flatMap((board) => [
  {
    id: `${board.projectId}-col-todo`,
    title: "К выполнению",
    order: 0,
    color: "#64748B",
    boardId: board.id,
  },
  {
    id: `${board.projectId}-col-progress`,
    title: "В работе",
    order: 1,
    color: "#2563EB",
    boardId: board.id,
  },
  {
    id: `${board.projectId}-col-review`,
    title: "На проверке",
    order: 2,
    color: "#F59E0B",
    boardId: board.id,
  },
  {
    id: `${board.projectId}-col-done`,
    title: "Готово",
    order: 3,
    color: "#10B981",
    boardId: board.id,
  },
]);

const tasks = [
  {
    id: "preview-task-suppliers",
    title: "Закрыть договоры с северными поставщиками",
    description: "Собрать финальные условия, лимиты и график поставок по логистическому коридору.",
    status: "in_progress",
    priority: "high",
    order: 0,
    dueDate: addDays(now, 4),
    projectId: "preview-project-north",
    assigneeId: "preview-team-anna",
    columnId: "preview-project-north-col-progress",
  },
  {
    id: "preview-task-route-audit",
    title: "Проверить узкие места маршрутной сети",
    description: "Сверить SLA по ключевым плечам и обновить прогноз простоев.",
    status: "todo",
    priority: "medium",
    order: 1,
    dueDate: addDays(now, 9),
    projectId: "preview-project-north",
    assigneeId: "preview-team-maxim",
    columnId: "preview-project-north-col-todo",
  },
  {
    id: "preview-task-campus-budget",
    title: "Согласовать корректировку CAPEX по кампусу",
    description: "Подготовить пакет для комитета с отклонениями по факту.",
    status: "in_progress",
    priority: "critical",
    order: 0,
    dueDate: addDays(now, 3),
    projectId: "preview-project-campus",
    assigneeId: "preview-team-boris",
    columnId: "preview-project-campus-col-progress",
  },
  {
    id: "preview-task-campus-contract",
    title: "Обновить график по генподрядному контракту",
    description: "Подтвердить юридические поправки и новый дедлайн этапа.",
    status: "review",
    priority: "high",
    order: 1,
    dueDate: addDays(now, 6),
    projectId: "preview-project-campus",
    assigneeId: "preview-team-sofia",
    columnId: "preview-project-campus-col-review",
  },
  {
    id: "preview-task-dashboard-spec",
    title: "Уточнить состав executive-dashboard v2",
    description: "Согласовать KPI, алерты и состав пакета для еженедельного обзора.",
    status: "todo",
    priority: "medium",
    order: 0,
    dueDate: addDays(now, 8),
    projectId: "preview-project-control",
    assigneeId: "preview-team-irina",
    columnId: "preview-project-control-col-todo",
  },
  {
    id: "preview-task-briefing",
    title: "Собрать шаблон управленческого брифинга",
    description: "Подготовить структуру summary, risk-блока и decision-log.",
    status: "done",
    priority: "medium",
    order: 1,
    dueDate: addDays(now, -2),
    completedAt: addDays(now, -1),
    projectId: "preview-project-control",
    assigneeId: "preview-team-sofia",
    columnId: "preview-project-control-col-done",
  },
] as const;

const milestones = [
  {
    id: "preview-ms-north-launch",
    title: "Пуск первого северного маршрута",
    status: "upcoming",
    date: addDays(now, 18),
    projectId: "preview-project-north",
    description: "Запуск тестового плеча с подтвержденной пропускной способностью.",
  },
  {
    id: "preview-ms-campus-stage",
    title: "Закрыть проектирование инженерного блока",
    status: "at_risk",
    date: addDays(now, 11),
    projectId: "preview-project-campus",
    description: "Подтвердить выпуск финального пакета документации.",
  },
  {
    id: "preview-ms-control-rollout",
    title: "Запустить executive-пакет v2",
    status: "upcoming",
    date: addDays(now, 23),
    projectId: "preview-project-control",
    description: "Отдать первую рабочую версию управленческого пакета в эксплуатацию.",
  },
];

const risks = [
  {
    id: "preview-risk-campus-capex",
    title: "Рост стоимости инженерного контура",
    description: "Фактические сметы обгоняют базовый CAPEX по инженерному блоку.",
    category: "Финансы",
    probability: "high",
    impact: "high",
    severity: 5,
    status: "open",
    date: addDays(now, -3),
    ownerId: "preview-team-boris",
    projectId: "preview-project-campus",
  },
  {
    id: "preview-risk-north-customs",
    title: "Риск задержки на таможенном плече",
    description: "Есть зависимость от подтверждения двух поставщиков по экспортным документам.",
    category: "Логистика",
    probability: "medium",
    impact: "high",
    severity: 4,
    status: "open",
    date: addDays(now, -1),
    ownerId: "preview-team-anna",
    projectId: "preview-project-north",
  },
  {
    id: "preview-risk-control-scope",
    title: "Размывание состава KPI для executive-отчетности",
    description: "Без фиксации KPI пакет рискует стать перегруженным и нерелевантным.",
    category: "Управление",
    probability: "medium",
    impact: "medium",
    severity: 3,
    status: "monitoring",
    date: addDays(now, -2),
    ownerId: "preview-team-irina",
    projectId: "preview-project-control",
  },
];

const documents = [
  {
    id: "preview-doc-north-plan",
    title: "План запуска маршрута",
    description: "Ключевые этапы и контрольные точки запуска северного плеча.",
    filename: "north-route-plan.pdf",
    url: "/preview-docs/north-route-plan.pdf",
    type: "plan",
    size: 2_400_000,
    ownerId: "preview-team-anna",
    projectId: "preview-project-north",
  },
  {
    id: "preview-doc-campus-capex",
    title: "CAPEX-review по кампусу",
    description: "Актуализированная таблица CAPEX и отклонений.",
    filename: "campus-capex-review.xlsx",
    url: "/preview-docs/campus-capex-review.xlsx",
    type: "finance",
    size: 1_250_000,
    ownerId: "preview-team-boris",
    projectId: "preview-project-campus",
  },
  {
    id: "preview-doc-control-brief",
    title: "Шаблон executive-брифинга",
    description: "Рабочий шаблон weekly brief для управленческой команды.",
    filename: "executive-brief-template.docx",
    url: "/preview-docs/executive-brief-template.docx",
    type: "brief",
    size: 540_000,
    ownerId: "preview-team-sofia",
    projectId: "preview-project-control",
  },
];

async function upsertTeamMembers() {
  for (const member of teamMembers) {
    await prisma.teamMember.upsert({
      where: { id: member.id },
      update: {
        ...member,
        updatedAt: now,
      },
      create: {
        ...member,
        updatedAt: now,
      },
    });
  }
}

async function upsertProjects() {
  for (const project of projects) {
    const { teamIds, ...data } = project;
    await prisma.project.upsert({
      where: { id: project.id },
      update: {
        ...data,
        updatedAt: now,
        team: {
          set: teamIds.map((id) => ({ id })),
        },
      },
      create: {
        ...data,
        updatedAt: now,
        team: {
          connect: teamIds.map((id) => ({ id })),
        },
      },
    });
  }
}

async function upsertBoardsAndColumns() {
  for (const board of boards) {
    await prisma.board.upsert({
      where: { id: board.id },
      update: {
        ...board,
        updatedAt: now,
      },
      create: {
        ...board,
        updatedAt: now,
      },
    });
  }

  for (const column of columns) {
    await prisma.column.upsert({
      where: { id: column.id },
      update: {
        ...column,
        updatedAt: now,
      },
      create: {
        ...column,
        updatedAt: now,
      },
    });
  }
}

async function upsertTasks() {
  for (const task of tasks) {
    await prisma.task.upsert({
      where: { id: task.id },
      update: {
        ...task,
        updatedAt: now,
      },
      create: {
        ...task,
        updatedAt: now,
      },
    });
  }
}

async function upsertMilestones() {
  for (const milestone of milestones) {
    await prisma.milestone.upsert({
      where: { id: milestone.id },
      update: {
        ...milestone,
        updatedAt: now,
      },
      create: {
        ...milestone,
        updatedAt: now,
      },
    });
  }
}

async function upsertRisks() {
  for (const risk of risks) {
    await prisma.risk.upsert({
      where: { id: risk.id },
      update: {
        ...risk,
        updatedAt: now,
      },
      create: {
        ...risk,
        updatedAt: now,
      },
    });
  }
}

async function upsertDocuments() {
  for (const document of documents) {
    await prisma.document.upsert({
      where: { id: document.id },
      update: {
        ...document,
        updatedAt: now,
      },
      create: {
        ...document,
        updatedAt: now,
      },
    });
  }
}

async function upsertNotifications() {
  const targetUserIds = new Set<string>(["demo-user"]);
  const previewAuthEmail = process.env.SEED_AUTH_EMAIL?.trim();

  if (previewAuthEmail) {
    const previewAuthUser = await prisma.user.findUnique({
      where: { email: previewAuthEmail },
      select: { id: true },
    });

    if (previewAuthUser?.id) {
      targetUserIds.add(previewAuthUser.id);
    }
  }

  const notificationTemplates = [
    {
      suffix: "welcome",
      type: "info",
      title: "Preview environment ready",
      message: "SQLite preview data is available for dashboard and API smoke testing.",
      entityType: "system",
      entityId: "preview-bootstrap",
      read: false,
    },
    {
      suffix: "risk",
      type: "alert",
      title: "Есть проект с повышенным риском",
      message: "Корпоративный кампус требует решения по CAPEX и графику подрядчика.",
      entityType: "project",
      entityId: "preview-project-campus",
      read: false,
    },
    {
      suffix: "delivery",
      type: "success",
      title: "Управленческий брифинг обновлен",
      message: "В preview загружен новый пакет executive-данных для тестирования.",
      entityType: "project",
      entityId: "preview-project-control",
      read: true,
    },
  ];

  for (const userId of targetUserIds) {
    for (const [index, notification] of notificationTemplates.entries()) {
      const createdAt = addDays(now, -index);
      await prisma.notification.upsert({
        where: { id: `preview-notification-${notification.suffix}-${userId}` },
        update: {
          userId,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          entityType: notification.entityType,
          entityId: notification.entityId,
          read: notification.read,
          readAt: notification.read ? createdAt : null,
          createdAt,
        },
        create: {
          id: `preview-notification-${notification.suffix}-${userId}`,
          userId,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          entityType: notification.entityType,
          entityId: notification.entityId,
          read: notification.read,
          readAt: notification.read ? createdAt : null,
          createdAt,
        },
      });
    }
  }
}

async function main() {
  console.log("🌱 Seeding preview dashboard data...");

  await upsertTeamMembers();
  await upsertProjects();
  await upsertBoardsAndColumns();
  await upsertTasks();
  await upsertMilestones();
  await upsertRisks();
  await upsertDocuments();
  await upsertNotifications();

  console.log("✅ Preview dashboard data is ready.");
}

main()
  .catch((error) => {
    console.error("❌ Preview dashboard seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
