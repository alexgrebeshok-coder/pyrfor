import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;

const BOARD_COLUMNS = [
  { title: "К выполнению", order: 0, color: "#6B7280" },
  { title: "В работе", order: 1, color: "#3B82F6" },
  { title: "На проверке", order: 2, color: "#F59E0B" },
  { title: "Готово", order: 3, color: "#10B981" },
] as const;

type BoardColumnTitle = (typeof BOARD_COLUMNS)[number]["title"];
type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
type MilestoneStatus = "upcoming" | "in_progress" | "completed" | "overdue";
type RiskStatus = "open" | "mitigated" | "closed";

type TeamSeed = {
  id: string;
  name: string;
  role: string;
  email: string;
  initials: string;
  capacity: number;
};

type ProjectTaskSeed = {
  title: string;
  description?: string;
  status: TaskStatus;
  priority: "low" | "medium" | "high" | "critical";
  columnTitle: BoardColumnTitle;
  dueInDays: number;
  assigneeId: string;
};

type ProjectMilestoneSeed = {
  title: string;
  description?: string;
  status: MilestoneStatus;
  dateOffsetDays: number;
};

type ProjectDocumentSeed = {
  title: string;
  description?: string;
  type: "pdf" | "docx" | "xlsx" | "other";
  size: number;
  ownerId?: string;
};

type ProjectRiskSeed = {
  title: string;
  description?: string;
  probability: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  severity: number;
  status: RiskStatus;
  ownerId?: string;
};

type ProjectSeed = {
  id: string;
  name: string;
  description: string;
  status: "active" | "planning" | "at_risk" | "completed" | "on_hold";
  direction: "metallurgy" | "logistics" | "trade" | "construction";
  priority: "low" | "medium" | "high" | "critical";
  health: "good" | "warning" | "critical";
  start: string;
  end: string;
  budgetPlan: number;
  budgetFact: number;
  progress: number;
  location: string;
  boardName: string;
  teamIds: string[];
  tasks: ProjectTaskSeed[];
  milestones: ProjectMilestoneSeed[];
  documents: ProjectDocumentSeed[];
  risks: ProjectRiskSeed[];
};

function addDays(dateIso: string, offsetDays: number) {
  return new Date(new Date(dateIso).getTime() + offsetDays * DAY_MS);
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function buildFilename(title: string, type: string) {
  const safeTitle = slugify(title);
  return `${safeTitle || "document"}.${type.toLowerCase()}`;
}

function task(
  title: string,
  status: TaskStatus,
  priority: ProjectTaskSeed["priority"],
  columnTitle: BoardColumnTitle,
  dueInDays: number,
  assigneeId: string,
  description?: string
): ProjectTaskSeed {
  return {
    title,
    description,
    status,
    priority,
    columnTitle,
    dueInDays,
    assigneeId,
  };
}

function milestone(
  title: string,
  status: MilestoneStatus,
  dateOffsetDays: number,
  description?: string
): ProjectMilestoneSeed {
  return { title, status, dateOffsetDays, description };
}

function doc(
  title: string,
  type: ProjectDocumentSeed["type"],
  size: number,
  ownerId?: string,
  description?: string
): ProjectDocumentSeed {
  return { title, type, size, ownerId, description };
}

function risk(
  title: string,
  probability: ProjectRiskSeed["probability"],
  impact: ProjectRiskSeed["impact"],
  severity: number,
  status: RiskStatus,
  ownerId?: string,
  description?: string
): ProjectRiskSeed {
  return { title, probability, impact, severity, status, ownerId, description };
}

const teamSeeds: TeamSeed[] = [
  {
    id: "tm_sasha",
    name: "Александр Гребешок",
    role: "Руководитель портфеля",
    email: "sasha@ceoclaw.com",
    initials: "АГ",
    capacity: 90,
  },
  {
    id: "tm_olga",
    name: "Ольга Белова",
    role: "Логистика и операции",
    email: "olga@team.ru",
    initials: "ОБ",
    capacity: 78,
  },
  {
    id: "tm_ivan",
    name: "Иван Петров",
    role: "Строительство и ПТО",
    email: "ivan@team.ru",
    initials: "ИП",
    capacity: 82,
  },
  {
    id: "tm_marina",
    name: "Марина Соколова",
    role: "Юрист по договорам",
    email: "marina@team.ru",
    initials: "МС",
    capacity: 68,
  },
  {
    id: "tm_alexei",
    name: "Алексей Чернов",
    role: "Финансовый аналитик",
    email: "alexei@team.ru",
    initials: "АЧ",
    capacity: 84,
  },
  {
    id: "tm_dmitry",
    name: "Дмитрий Козлов",
    role: "IT и интеграции",
    email: "dmitry@team.ru",
    initials: "ДК",
    capacity: 86,
  },
  {
    id: "tm_sergey",
    name: "Сергей Орлов",
    role: "Продажи и CRM",
    email: "sergey@team.ru",
    initials: "СО",
    capacity: 72,
  },
  {
    id: "tm_anna",
    name: "Анна Волкова",
    role: "Аналитик данных",
    email: "anna@team.ru",
    initials: "АВ",
    capacity: 74,
  },
  {
    id: "tm_pavel",
    name: "Павел Ильин",
    role: "Закупки и склад",
    email: "pavel@team.ru",
    initials: "ПИ",
    capacity: 70,
  },
];

const projectSeeds: ProjectSeed[] = [
  {
    id: "proj_north_path",
    name: "Логистический хаб «Северный путь»",
    description:
      "Региональный хаб для консолидации поставок, маршрутизации транспорта и контроля запасов в северном контуре.",
    status: "planning",
    direction: "logistics",
    priority: "critical",
    health: "warning",
    start: "2026-02-01",
    end: "2026-10-31",
    budgetPlan: 22000000,
    budgetFact: 4200000,
    progress: 18,
    location: "Сургут",
    boardName: "Логистический поток",
    teamIds: ["tm_sasha", "tm_olga", "tm_alexei", "tm_anna"],
    tasks: [
      task("Согласовать площадку под хаб", "todo", "critical", "К выполнению", 10, "tm_sasha"),
      task("Проверить транспортную схему", "in_progress", "high", "В работе", 18, "tm_olga"),
      task("Подготовить договор аренды", "blocked", "high", "На проверке", 24, "tm_marina"),
      task("Запустить пилотный маршрут", "done", "medium", "Готово", 35, "tm_olga"),
    ],
    milestones: [
      milestone("Выбор площадки", "upcoming", 5, "Согласование площадки и условий аренды."),
      milestone("Старт пилота", "in_progress", 25, "Первый маршрут и контрольные KPI."),
    ],
    documents: [
      doc("Концепция логистического хаба", "docx", 220000, "tm_olga"),
      doc("Сценарий маршрутов и график поставок", "xlsx", 340000, "tm_alexei"),
    ],
    risks: [
      risk(
        "Задержка выбора площадки",
        "high",
        "high",
        4,
        "open",
        "tm_sasha",
        "Риск уходит в срок аренды и затягивает старт пилота."
      ),
    ],
  },
  {
    id: "proj_vostok_dc",
    name: "Строительство распределительного центра «Восток»",
    description:
      "Строительство склада класса A с приёмкой, кросс-доком и зоной автоматической комплектации.",
    status: "active",
    direction: "construction",
    priority: "high",
    health: "good",
    start: "2025-09-01",
    end: "2026-07-31",
    budgetPlan: 64000000,
    budgetFact: 28100000,
    progress: 56,
    location: "Казань",
    boardName: "Стройплощадка",
    teamIds: ["tm_ivan", "tm_pavel", "tm_marina", "tm_alexei"],
    tasks: [
      task("Закрыть схему финансирования", "in_progress", "critical", "В работе", 12, "tm_alexei"),
      task("Получить проектную смету", "todo", "high", "К выполнению", 18, "tm_ivan"),
      task("Согласовать подрядчика каркаса", "blocked", "high", "На проверке", 26, "tm_marina"),
      task("Начать монтаж стеллажей", "done", "medium", "Готово", 40, "tm_pavel"),
    ],
    milestones: [
      milestone("Закрыт нулевой цикл", "completed", 45, "Монолит и подготовка площадки."),
      milestone("Монтаж стеллажей", "upcoming", 70, "Переход к внутренней логистике."),
    ],
    documents: [
      doc("Проект распределительного центра", "pdf", 1400000, "tm_ivan"),
      doc("Смета и календарный план", "xlsx", 490000, "tm_alexei"),
    ],
    risks: [
      risk(
        "Рост стоимости металлокаркаса",
        "medium",
        "high",
        4,
        "open",
        "tm_alexei",
        "Цена металла влияет на бюджет каркаса и монтаж."
      ),
    ],
  },
  {
    id: "proj_promline_crm",
    name: "CRM продаж «ПромЛайн»",
    description:
      "Внедрение CRM для отдела продаж с воронкой, интеграциями, миграцией базы и обучением менеджеров.",
    status: "active",
    direction: "trade",
    priority: "medium",
    health: "good",
    start: "2026-01-15",
    end: "2026-05-31",
    budgetPlan: 4500000,
    budgetFact: 1660000,
    progress: 44,
    location: "Москва",
    boardName: "Продажи",
    teamIds: ["tm_sergey", "tm_dmitry", "tm_anna"],
    tasks: [
      task("Собрать требования отдела продаж", "done", "medium", "Готово", 5, "tm_sergey"),
      task("Настроить воронку и статусы", "in_progress", "high", "В работе", 12, "tm_dmitry"),
      task("Перенести базу клиентов", "todo", "high", "К выполнению", 18, "tm_anna"),
      task("Обучить менеджеров работе в CRM", "blocked", "medium", "На проверке", 24, "tm_sergey"),
    ],
    milestones: [
      milestone("Импорт клиентов", "completed", 10, "Перенос справочника и дублей."),
      milestone("Go-live продаж", "upcoming", 28, "Запуск боевого контура продаж."),
    ],
    documents: [
      doc("ТЗ на CRM продаж", "docx", 180000, "tm_sergey"),
      doc("Матрица интеграций CRM", "xlsx", 260000, "tm_dmitry"),
    ],
    risks: [
      risk(
        "Сопротивление менеджеров",
        "medium",
        "medium",
        3,
        "mitigated",
        "tm_sergey",
        "Пользователи привыкли работать в старой таблице и требуют адаптацию."
      ),
    ],
  },
  {
    id: "proj_riverpark_docs",
    name: "Проектная документация «Ривер Парк»",
    description:
      "Комплект проектной документации для жилого комплекса: архитектура, инженерные разделы и экспертиза.",
    status: "planning",
    direction: "construction",
    priority: "medium",
    health: "warning",
    start: "2026-03-01",
    end: "2026-08-31",
    budgetPlan: 9200000,
    budgetFact: 1450000,
    progress: 22,
    location: "Екатеринбург",
    boardName: "Документация",
    teamIds: ["tm_marina", "tm_ivan", "tm_anna"],
    tasks: [
      task("Согласовать состав пакета документации", "in_progress", "high", "В работе", 7, "tm_marina"),
      task("Подготовить архитектурный раздел", "todo", "high", "К выполнению", 14, "tm_ivan"),
      task("Проверить комплект на экспертизу", "blocked", "critical", "На проверке", 21, "tm_marina"),
      task("Сдать финальный пакет заказчику", "done", "medium", "Готово", 30, "tm_anna"),
    ],
    milestones: [
      milestone("Пакет на экспертизу", "in_progress", 12, "Черновой комплект передан на проверку."),
      milestone("Финальная сдача", "upcoming", 50, "Передача итогового пакета заказчику."),
    ],
    documents: [
      doc("Пакет рабочей документации", "pdf", 1800000, "tm_marina"),
      doc("Реестр замечаний экспертизы", "xlsx", 390000, "tm_anna"),
    ],
    risks: [
      risk(
        "Задержка экспертизы",
        "medium",
        "high",
        3,
        "open",
        "tm_marina",
        "Любая задержка со стороны экспертизы сдвигает весь график передачи."
      ),
    ],
  },
  {
    id: "proj_technosklad",
    name: "Автоматизация склада «ТехноСклад»",
    description:
      "Внедрение WMS, маркировки и сценариев автоматизации для среднего складского комплекса.",
    status: "active",
    direction: "logistics",
    priority: "critical",
    health: "good",
    start: "2025-12-01",
    end: "2026-06-30",
    budgetPlan: 18000000,
    budgetFact: 7800000,
    progress: 61,
    location: "Новосибирск",
    boardName: "Склад",
    teamIds: ["tm_dmitry", "tm_pavel", "tm_olga", "tm_anna"],
    tasks: [
      task("Собрать перечень оборудования", "done", "medium", "Готово", 4, "tm_pavel"),
      task("Настроить WMS сценарии", "in_progress", "critical", "В работе", 12, "tm_dmitry"),
      task("Протестировать интеграцию со штрихкодами", "todo", "high", "К выполнению", 20, "tm_anna"),
      task("Согласовать окно внедрения", "blocked", "high", "На проверке", 28, "tm_alexei"),
    ],
    milestones: [
      milestone("WMS blueprint approved", "completed", 15, "Архитектура внедрения утверждена."),
      milestone("Пилот на складе", "upcoming", 40, "Тестирование на боевом складе."),
    ],
    documents: [
      doc("Архитектура WMS", "pdf", 1500000, "tm_dmitry"),
      doc("План внедрения склада", "xlsx", 430000, "tm_pavel"),
    ],
    risks: [
      risk(
        "Сбой при интеграции WMS",
        "medium",
        "high",
        4,
        "open",
        "tm_dmitry",
        "Интеграция с существующим учётом может потребовать дополнительного окна."
      ),
    ],
  },
  {
    id: "proj_trassa24",
    name: "Поставка материалов «Трасса-24»",
    description:
      "Проект по поставке материалов и контролю маршрутов в северный коридор с учётом сезонных ограничений.",
    status: "at_risk",
    direction: "logistics",
    priority: "high",
    health: "critical",
    start: "2026-01-01",
    end: "2026-04-30",
    budgetPlan: 14000000,
    budgetFact: 11200000,
    progress: 74,
    location: "ЯНАО",
    boardName: "Поставка",
    teamIds: ["tm_olga", "tm_alexei", "tm_ivan"],
    tasks: [
      task("Подтвердить объём поставки", "in_progress", "critical", "В работе", 6, "tm_olga"),
      task("Согласовать цену и логистику", "blocked", "high", "На проверке", 11, "tm_alexei"),
      task("Закрепить резервный маршрут", "todo", "high", "К выполнению", 17, "tm_ivan"),
      task("Выпустить первую партию", "todo", "medium", "К выполнению", 25, "tm_olga"),
    ],
    milestones: [
      milestone("Контракт на объём", "upcoming", 8, "Зафиксирован целевой объём поставки."),
      milestone("Первая поставка", "upcoming", 22, "Окно выхода первой партии."),
    ],
    documents: [
      doc("Контракт на поставку материалов", "pdf", 860000, "tm_marina"),
      doc("Маршрутный лист и спецификация", "xlsx", 300000, "tm_olga"),
    ],
    risks: [
      risk(
        "Погодное окно для доставки",
        "high",
        "high",
        5,
        "open",
        "tm_olga",
        "Сужение зимнего окна может сорвать поставку на несколько недель."
      ),
    ],
  },
  {
    id: "proj_gps_fleet",
    name: "Пилот GPS-мониторинга автопарка «Северная линия»",
    description:
      "Пилот по GPS-контролю автопарка, маршрутам, трекингу техники и дисциплине рейсов.",
    status: "completed",
    direction: "logistics",
    priority: "medium",
    health: "good",
    start: "2025-11-01",
    end: "2026-01-31",
    budgetPlan: 2400000,
    budgetFact: 2200000,
    progress: 100,
    location: "Салехард",
    boardName: "Телеметрия",
    teamIds: ["tm_olga", "tm_dmitry"],
    tasks: [
      task("Поставить GPS-трекеры на автопарк", "done", "medium", "Готово", 3, "tm_olga"),
      task("Снять телеметрию и проверить точность", "done", "high", "Готово", 8, "tm_dmitry"),
      task("Подготовить отчёт по пилоту", "done", "medium", "Готово", 14, "tm_anna"),
      task("Передать рекомендации в эксплуатацию", "done", "low", "Готово", 20, "tm_sasha"),
    ],
    milestones: [
      milestone("Тест телеметрии", "completed", 7, "Проверка точности трекинга."),
      milestone("Передача в эксплуатацию", "completed", 25, "Пилот переведён в рабочий режим."),
    ],
    documents: [
      doc("Отчёт пилота GPS", "pdf", 740000, "tm_dmitry"),
      doc("Карта маршрутов автопарка", "xlsx", 250000, "tm_olga"),
    ],
    risks: [
      risk(
        "Расхождение GPS-меток",
        "low",
        "medium",
        2,
        "closed",
        "tm_dmitry",
        "Проверка данных показала допустимое расхождение, пилот закрыт."
      ),
    ],
  },
  {
    id: "proj_north_road",
    name: "Подряд на дорожные работы «Северный коридор»",
    description:
      "Подряд на дорожные и земляные работы с ограниченным погодным окном и плотным календарём техники.",
    status: "on_hold",
    direction: "construction",
    priority: "low",
    health: "warning",
    start: "2026-02-15",
    end: "2026-09-30",
    budgetPlan: 31000000,
    budgetFact: 2500000,
    progress: 12,
    location: "Харп",
    boardName: "Дорожные работы",
    teamIds: ["tm_ivan", "tm_pavel", "tm_sasha"],
    tasks: [
      task("Собрать график техники и людей", "todo", "medium", "К выполнению", 6, "tm_pavel"),
      task("Согласовать зимнее окно работ", "in_progress", "critical", "В работе", 12, "tm_ivan"),
      task("Подготовить ведомость материалов", "blocked", "high", "На проверке", 18, "tm_pavel"),
      task("Сдать ППР на проверку", "todo", "medium", "К выполнению", 24, "tm_marina"),
    ],
    milestones: [
      milestone("Согласование ППР", "upcoming", 15, "Проект производства работ передан на проверку."),
      milestone("Выход на объект", "upcoming", 35, "Старт полевых работ в сезонном окне."),
    ],
    documents: [
      doc("ППР дорожных работ", "pdf", 920000, "tm_ivan"),
      doc("График техники и бригад", "xlsx", 210000, "tm_pavel"),
    ],
    risks: [
      risk(
        "Сокращение дорожного окна",
        "high",
        "high",
        5,
        "open",
        "tm_ivan",
        "Если окно сместится, подряд придётся переносить на следующий сезон."
      ),
    ],
  },
];

async function clearExistingData() {
  console.log("🗑️  Clearing old data...");
  await prisma.timeEntry.deleteMany();
  await prisma.taskDependency.deleteMany();
  await prisma.task.deleteMany();
  await prisma.column.deleteMany();
  await prisma.board.deleteMany();
  await prisma.document.deleteMany();
  await prisma.milestone.deleteMany();
  await prisma.risk.deleteMany();
  await prisma.workReport.deleteMany();
  await prisma.evidenceRecord.deleteMany();
  await prisma.project.deleteMany();
  await prisma.teamMember.deleteMany();
}

async function seedTeamMembers() {
  console.log("👥 Creating team members...");
  for (const member of teamSeeds) {
    await prisma.teamMember.create({ data: member });
  }
  console.log(`✅ Created ${teamSeeds.length} team members`);
}

async function createProjectBoard(projectId: string, boardName: string) {
  const board = await prisma.board.create({
    data: {
      name: boardName,
      projectId,
      columns: {
        create: BOARD_COLUMNS.map((column) => ({
          title: column.title,
          order: column.order,
          color: column.color,
        })),
      },
    },
  });

  return prisma.board.findUniqueOrThrow({
    where: { id: board.id },
    include: {
      columns: {
        orderBy: { order: "asc" },
      },
    },
  });
}

async function seedProject(projectSeed: ProjectSeed) {
  const project = await prisma.project.create({
    data: {
      id: projectSeed.id,
      name: projectSeed.name,
      description: projectSeed.description,
      status: projectSeed.status,
      direction: projectSeed.direction,
      priority: projectSeed.priority,
      health: projectSeed.health,
      start: new Date(projectSeed.start),
      end: new Date(projectSeed.end),
      budgetPlan: projectSeed.budgetPlan,
      budgetFact: projectSeed.budgetFact,
      progress: projectSeed.progress,
      location: projectSeed.location,
      team: {
        connect: projectSeed.teamIds.map((id) => ({ id })),
      },
    },
  });

  const board = await createProjectBoard(project.id, projectSeed.boardName);
  const columnsByTitle = new Map(board.columns.map((column) => [column.title, column.id]));

  for (const taskSeed of projectSeed.tasks) {
    const columnId = columnsByTitle.get(taskSeed.columnTitle);
    if (!columnId) {
      throw new Error(`Column ${taskSeed.columnTitle} not found for ${projectSeed.name}`);
    }

    await prisma.task.create({
      data: {
        title: taskSeed.title,
        description: taskSeed.description,
        status: taskSeed.status,
        priority: taskSeed.priority,
        order: projectSeed.tasks.findIndex((task) => task.title === taskSeed.title),
        dueDate: addDays(projectSeed.start, taskSeed.dueInDays),
        projectId: project.id,
        assigneeId: taskSeed.assigneeId,
        columnId,
      },
    });
  }

  for (const milestoneSeed of projectSeed.milestones) {
    await prisma.milestone.create({
      data: {
        title: milestoneSeed.title,
        description: milestoneSeed.description,
        date: addDays(projectSeed.start, milestoneSeed.dateOffsetDays),
        status: milestoneSeed.status,
        projectId: project.id,
      },
    });
  }

  for (const documentSeed of projectSeed.documents) {
    await prisma.document.create({
      data: {
        title: documentSeed.title,
        description: documentSeed.description,
        filename: buildFilename(documentSeed.title, documentSeed.type),
        url: `https://docs.ceoclaw.local/${slugify(projectSeed.name)}/${slugify(documentSeed.title)}`,
        type: documentSeed.type,
        size: documentSeed.size,
        ownerId: documentSeed.ownerId,
        projectId: project.id,
      },
    });
  }

  for (const riskSeed of projectSeed.risks) {
    await prisma.risk.create({
      data: {
        title: riskSeed.title,
        description: riskSeed.description,
        probability: riskSeed.probability,
        impact: riskSeed.impact,
        severity: riskSeed.severity,
        status: riskSeed.status,
        ownerId: riskSeed.ownerId,
        projectId: project.id,
      },
    });
  }

  return project;
}

async function seedWorkReports(projectsById: Record<string, string>) {
  console.log("📝 Creating work reports...");
  const reports = [
    {
      reportNumber: "#202603190001",
      projectId: projectsById.proj_north_path,
      authorId: "tm_olga",
      reviewerId: "tm_sasha",
      section: "Логистика",
      reportDate: new Date("2026-03-19"),
      workDescription:
        "Проверили коридор поставки, сверили плечо доставки и согласовали окно разгрузки на следующую неделю.",
      status: "submitted",
      source: "manual",
      personnelCount: 5,
      personnelDetails: "Логистика, снабжение, аналитика, водительский штаб, координатор площадки",
    },
    {
      reportNumber: "#202603190002",
      projectId: projectsById.proj_vostok_dc,
      authorId: "tm_ivan",
      reviewerId: "tm_alexei",
      section: "Строительство",
      reportDate: new Date("2026-03-19"),
      workDescription:
        "Закрыли вопрос по каркасу, проверили смету и подтвердили поставку металла на начало следующего окна.",
      status: "approved",
      source: "manual",
      personnelCount: 8,
      personnelDetails: "Прораб, ПТО, снабжение, бухгалтерия, подрядчик каркаса",
    },
    {
      reportNumber: "#202603190003",
      projectId: projectsById.proj_promline_crm,
      authorId: "tm_sergey",
      reviewerId: "tm_dmitry",
      section: "Продажи",
      reportDate: new Date("2026-03-20"),
      workDescription:
        "Провели сверку воронки, выгрузили список клиентов и зафиксировали первые замечания по статусам сделок.",
      status: "submitted",
      source: "telegram_bot",
      externalReporterTelegramId: "telegram:promline-sales",
      externalReporterName: "Sales Bot",
      personnelCount: 6,
      personnelDetails: "Руководитель продаж, аналитик, CRM-администратор, менеджеры",
    },
    {
      reportNumber: "#202603190004",
      projectId: projectsById.proj_technosklad,
      authorId: "tm_dmitry",
      reviewerId: "tm_sasha",
      section: "Склад",
      reportDate: new Date("2026-03-20"),
      workDescription:
        "Тест WMS прошёл успешно: штрихкоды считываются, маршруты отгрузки подтверждены, блокеров нет.",
      status: "approved",
      source: "manual",
      personnelCount: 7,
      personnelDetails: "IT, складской оператор, поставщик оборудования, аналитик",
    },
  ];

  for (const report of reports) {
    await prisma.workReport.create({
      data: {
        reportNumber: report.reportNumber,
        projectId: report.projectId,
        authorId: report.authorId,
        reviewerId: report.reviewerId,
        section: report.section,
        reportDate: report.reportDate,
        workDescription: report.workDescription,
        volumesJson: JSON.stringify([
          { name: "факт", value: 1 },
          { name: "план", value: 1 },
        ]),
        personnelCount: report.personnelCount,
        personnelDetails: report.personnelDetails,
        equipment: "GPS, планшеты, рабочие станции, складское оборудование",
        weather: "stable",
        issues: "no blockers",
        nextDayPlan: "Подтвердить следующие окна работ и обновить план на завтра.",
        attachmentsJson: JSON.stringify([]),
        status: report.status,
        source: report.source,
        externalReporterTelegramId: report.externalReporterTelegramId,
        externalReporterName: report.externalReporterName,
      },
    });
  }

  console.log(`✅ Created ${reports.length} work reports`);
}

async function seedVideoFacts(projectsById: Record<string, string>) {
  console.log("🎥 Creating video facts...");
  const facts = [
    {
      entityRef: "video_fact_north_path_1",
      projectId: projectsById.proj_north_path,
      title: "Выезд на площадку логистического хаба",
      summary: "Подтверждена готовность площадки и старт маршрутов разгрузки.",
      observedAt: new Date("2026-03-19T09:10:00.000Z"),
      confidence: 0.84,
      verificationStatus: "verified",
    },
    {
      entityRef: "video_fact_wms_1",
      projectId: projectsById.proj_technosklad,
      title: "Тест WMS и сканеров",
      summary: "Штрихкоды и маршрутизация складских заказов прошли проверку на площадке.",
      observedAt: new Date("2026-03-20T11:40:00.000Z"),
      confidence: 0.9,
      verificationStatus: "observed",
    },
  ];

  for (const fact of facts) {
    await prisma.evidenceRecord.create({
      data: {
        sourceType: "video_document:intake",
        sourceRef: fact.entityRef,
        entityType: "video_fact",
        entityRef: fact.entityRef,
        projectId: fact.projectId,
        title: fact.title,
        summary: fact.summary,
        observedAt: fact.observedAt,
        reportedAt: new Date(),
        confidence: fact.confidence,
        verificationStatus: fact.verificationStatus,
        metadataJson: JSON.stringify({
          origin: "seed-demo",
          projectId: fact.projectId,
          entityRef: fact.entityRef,
        }),
      },
    });
  }

  console.log(`✅ Created ${facts.length} video facts`);
}

async function main() {
  console.log("🌱 Seeding realistic demo data...");
  await clearExistingData();

  await seedTeamMembers();

  console.log("📝 Creating projects...");
  const createdProjects: Record<string, string> = {};
  for (const projectSeed of projectSeeds) {
    const project = await seedProject(projectSeed);
    createdProjects[projectSeed.id] = project.id;
  }
  console.log(`✅ Created ${projectSeeds.length} projects`);

  await seedWorkReports(createdProjects);
  await seedVideoFacts(createdProjects);

  console.log("\n🎉 Demo seed completed!");
  console.log("📊 Summary:");
  console.log(`  - Projects: ${projectSeeds.length}`);
  console.log(`  - Team members: ${teamSeeds.length}`);
  console.log(`  - Tasks: ${projectSeeds.reduce((sum, project) => sum + project.tasks.length, 0)}`);
  console.log(`  - Milestones: ${projectSeeds.reduce((sum, project) => sum + project.milestones.length, 0)}`);
  console.log(`  - Documents: ${projectSeeds.reduce((sum, project) => sum + project.documents.length, 0)}`);
  console.log(`  - Risks: ${projectSeeds.reduce((sum, project) => sum + project.risks.length, 0)}`);
  console.log("  - Work reports: 4");
  console.log("  - Video facts: 2");
}

main()
  .catch((error) => {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
