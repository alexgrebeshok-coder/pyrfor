// Production-safe seed - creates data only if missing
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding production data...');

  // Create Kanban board if not exists
  const existingBoards = await prisma.board.count();
  
  if (existingBoards === 0) {
    console.log('Creating Kanban board...');
    
    // Get first project
    const project = await prisma.project.findFirst();
    
    if (!project) {
      console.log('⚠️  No projects found, skipping board creation');
      return;
    }
    
    const board = await prisma.board.create({
      data: {
        name: 'Проекты',
        projectId: project.id,
        columns: {
          create: [
            { title: 'К выполнению', order: 0, color: '#6B7280' },
            { title: 'В работе', order: 1, color: '#3B82F6' },
            { title: 'На проверке', order: 2, color: '#F59E0B' },
            { title: 'Готово', order: 3, color: '#10B981' },
          ]
        }
      }
    });
    
    console.log('✅ Created board:', board.name);
  } else {
    console.log('⏭️  Boards already exist:', existingBoards);
  }

  // Create some tasks if not exist
  const existingTasks = await prisma.task.count();
  
  if (existingTasks < 5) {
    console.log('Creating sample tasks...');
    
    // Get first project and its board
    const project = await prisma.project.findFirst({
      include: {
        boards: {
          include: { columns: true }
        }
      }
    });
    
    if (!project || !project.boards[0]) {
      console.log('⚠️  No project/board found, skipping task creation');
      return;
    }
    
    const board = project.boards[0];
    const todoColumn = board.columns.find(c => c.title === 'К выполнению');
    const progressColumn = board.columns.find(c => c.title === 'В работе');
    const doneColumn = board.columns.find(c => c.title === 'Готово');
    
    if (!todoColumn || !progressColumn || !doneColumn) {
      console.log('⚠️  Columns not found, skipping task creation');
      return;
    }
    
    const tasks = await prisma.task.createMany({
      data: [
        { title: 'Подготовить КП для ЧЭМК', status: 'in_progress', priority: 'high', columnId: progressColumn.id, projectId: project.id, dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        { title: 'Согласовать СП с партнёрами', status: 'todo', priority: 'high', columnId: todoColumn.id, projectId: project.id, dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
        { title: 'Провести анализ рынка', status: 'done', priority: 'medium', columnId: doneColumn.id, projectId: project.id, dueDate: new Date() },
        { title: 'Подготовить презентацию', status: 'todo', priority: 'medium', columnId: todoColumn.id, projectId: project.id, dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) },
        { title: 'Встреча с инвесторами', status: 'todo', priority: 'high', columnId: todoColumn.id, projectId: project.id, dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) },
      ],
      skipDuplicates: true,
    });
    
    console.log('✅ Created tasks:', tasks.count);
  } else {
    console.log('⏭️  Tasks already exist:', existingTasks);
  }

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
