// Production-safe seed - creates data only if missing
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';

if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  console.log('⚠️ DATABASE_URL is not configured for Postgres; skipping production seed.');
  process.exit(0);
}

const prisma = new PrismaClient();

type ColumnDefinition = {
  title: string;
  order: number;
  color: string;
};

type TaskSeedDefinition = {
  title: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  columnTitle: string;
  dueInDays: number;
};

const columnDefinitions: ColumnDefinition[] = [
  { title: 'К выполнению', order: 0, color: '#6B7280' },
  { title: 'В работе', order: 1, color: '#3B82F6' },
  { title: 'На проверке', order: 2, color: '#F59E0B' },
  { title: 'Готово', order: 3, color: '#10B981' },
];

const taskSeedDefinitions: TaskSeedDefinition[] = [
  { title: 'Подготовить КП для ЧЭМК', status: 'in_progress', priority: 'high', columnTitle: 'В работе', dueInDays: 7 },
  { title: 'Согласовать СП с партнёрами', status: 'todo', priority: 'high', columnTitle: 'К выполнению', dueInDays: 14 },
  { title: 'Провести анализ рынка', status: 'done', priority: 'medium', columnTitle: 'Готово', dueInDays: 0 },
  { title: 'Подготовить презентацию', status: 'todo', priority: 'medium', columnTitle: 'К выполнению', dueInDays: 5 },
  { title: 'Встреча с инвесторами', status: 'todo', priority: 'high', columnTitle: 'К выполнению', dueInDays: 10 },
];

async function ensureBoard(projectId: string) {
  let board = await prisma.board.findFirst({ where: { projectId } });

  if (!board) {
    console.log('Создаём доску Kanban для проекта...');
    board = await prisma.board.create({
      data: {
        id: randomUUID(),
        name: 'Проекты',
        projectId,
        updatedAt: new Date(),
      },
    });
    console.log('✅ Доска создана:', board.name);
  } else {
    console.log('⏭️  Доска уже есть:', projectId);
  }

  for (const columnDefinition of columnDefinitions) {
    const existingColumn = await prisma.column.findFirst({
      where: {
        boardId: board.id,
        title: columnDefinition.title,
      },
    });

    if (existingColumn) {
      await prisma.column.update({
        where: { id: existingColumn.id },
        data: { order: columnDefinition.order, color: columnDefinition.color },
      });
    } else {
      await prisma.column.create({
        data: {
          id: randomUUID(),
          boardId: board.id,
          title: columnDefinition.title,
          order: columnDefinition.order,
          color: columnDefinition.color,
          updatedAt: new Date(),
        },
      });
    }
  }

  const columns = await prisma.column.findMany({
    where: { boardId: board.id },
  });

  return { board, columns };
}

async function ensureTasks(projectId: string, projectStart: Date, columns: { title: string; id: string }[]) {
  const columnsByTitle = columns.reduce<Record<string, string>>((acc, column) => {
    acc[column.title] = column.id;
    return acc;
  }, {});

  const dayMs = 24 * 60 * 60 * 1000;

  for (const taskDef of taskSeedDefinitions) {
    const columnId = columnsByTitle[taskDef.columnTitle];
    if (!columnId) {
      console.log(`⚠️   Колонка ${taskDef.columnTitle} не найдена, пропускаю ${taskDef.title}`);
      continue;
    }

    const dueDate = new Date(projectStart.getTime() + taskDef.dueInDays * dayMs);
    const existingTask = await prisma.task.findFirst({
      where: {
        projectId,
        title: taskDef.title,
      },
    });

    const taskPayload = {
      columnId,
      projectId,
      status: taskDef.status,
      priority: taskDef.priority,
      dueDate,
    };

    if (existingTask) {
      await prisma.task.update({
        where: { id: existingTask.id },
        data: taskPayload,
      });
    } else {
      await prisma.task.create({
        data: {
          id: randomUUID(),
          title: taskDef.title,
          ...taskPayload,
          updatedAt: new Date(),
        },
      });
    }
  }
}

async function main() {
  console.log('🌱 Seeding production data...');

  const project = await prisma.project.findFirst();
  if (!project) {
    console.log('⚠️  Нет проекта, пропускаю сидирование');
    return;
  }

  const { columns } = await ensureBoard(project.id);
  await ensureTasks(project.id, project.start, columns);

  console.log('✅ Seed completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
