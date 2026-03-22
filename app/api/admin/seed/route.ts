/**
 * Admin API - Seed initial data for CEOClaw
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/app/api/middleware/auth';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { authorizeAdminRoute } from "../_utils";

export async function GET(request: NextRequest) {
  const authResult = await authorizeAdminRoute(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const results: string[] = [];

    // 1. Create Organization
    const org = await prisma.organization.upsert({
      where: { slug: 'default-org' },
      update: {},
      create: {
        id: 'org_default',
        slug: 'default-org',
        name: 'Моя организация',
        description: 'Организация по умолчанию',
        updatedAt: new Date(),
      },
    });
    results.push(`Organization: ${org.name}`);

    // 2. Create Workspace
    const workspace = await prisma.workspace.upsert({
      where: { id: 'ws_default' },
      update: {},
      create: {
        id: 'ws_default',
        organizationId: org.id,
        key: 'MAIN',
        name: 'Основной проект',
        initials: 'ОП',
        description: 'Рабочее пространство по умолчанию',
        isDefault: true,
        updatedAt: new Date(),
      },
    });
    results.push(`Workspace: ${workspace.name}`);

    // 3. Update User with membership (if exists)
    const existingUser = await prisma.user.findFirst();
    if (existingUser) {
      await prisma.membership.upsert({
        where: { id: 'member_default' },
        update: {},
        create: {
          id: 'member_default',
          organizationId: org.id,
          userId: existingUser.id,
          displayName: existingUser.name || 'User',
          email: existingUser.email,
          role: 'OWNER',
          updatedAt: new Date(),
        },
      });
      results.push(`Membership created for: ${existingUser.email}`);
    }

    // 4. Create Team Members
    const teamMembers = [
      { id: 'tm_1', name: 'Александр', initials: 'АГ', role: 'Руководитель проекта', email: 'alex@example.com', capacity: 100 },
      { id: 'tm_2', name: 'Мария', initials: 'МП', role: 'Аналитик', email: 'maria@example.com', capacity: 80 },
      { id: 'tm_3', name: 'Дмитрий', initials: 'ДК', role: 'Разработчик', email: 'dmitry@example.com', capacity: 100 },
      { id: 'tm_4', name: 'Елена', initials: 'ЕС', role: 'Дизайнер', email: 'elena@example.com', capacity: 60 },
    ];

    for (const tm of teamMembers) {
      await prisma.teamMember.upsert({
        where: { id: tm.id },
        update: {},
        create: {
          id: tm.id,
          name: tm.name,
          initials: tm.initials,
          role: tm.role,
          email: tm.email,
          capacity: tm.capacity,
          updatedAt: new Date(),
        },
      });
    }
    results.push(`Team Members: ${teamMembers.length}`);

    // 5. Create Projects
    const projects = [
      {
        id: 'proj_1',
        name: 'ЧЭМК — Переработка дунита',
        description: 'Проект по переработке дунита в Харпе, ЯНАО',
        status: 'active',
        direction: 'metallurgy',
        priority: 'high',
        health: 'good',
        progress: 35,
        budgetPlan: 50000000,
        budgetFact: 17500000,
        location: 'Харп, ЯНАО',
        start: new Date('2026-01-01'),
        end: new Date('2026-12-31'),
      },
      {
        id: 'proj_2',
        name: 'Бентонитовые глины',
        description: 'Карьер в Казахстане → поставка в РФ',
        status: 'planning',
        direction: 'logistics',
        priority: 'medium',
        health: 'good',
        progress: 15,
        budgetPlan: 25000000,
        budgetFact: 3750000,
        location: 'Казахстан',
        start: new Date('2026-03-01'),
        end: new Date('2026-12-31'),
      },
      {
        id: 'proj_3',
        name: 'CEOClaw Dashboard',
        description: 'AI-powered PM Dashboard',
        status: 'active',
        direction: 'construction',
        priority: 'high',
        health: 'good',
        progress: 70,
        budgetPlan: 5000000,
        budgetFact: 3500000,
        location: 'Remote',
        start: new Date('2026-02-01'),
        end: new Date('2026-06-30'),
      },
    ];

    for (const proj of projects) {
      await prisma.project.upsert({
        where: { id: proj.id },
        update: {},
        create: {
          id: proj.id,
          name: proj.name,
          description: proj.description,
          status: proj.status,
          direction: proj.direction,
          priority: proj.priority,
          health: proj.health,
          progress: proj.progress,
          budgetPlan: proj.budgetPlan,
          budgetFact: proj.budgetFact,
          location: proj.location,
          start: proj.start,
          end: proj.end,
          updatedAt: new Date(),
        },
      });
    }
    results.push(`Projects: ${projects.length}`);

    // 6. Create Tasks
    const tasks = [
      { id: 'task_1', title: 'Согласовать СП с ЧЭМК', status: 'in_progress', priority: 'high', dueDate: new Date('2026-04-15'), projectId: 'proj_1' },
      { id: 'task_2', title: 'Подготовить КП для МИПТЭК', status: 'todo', priority: 'high', dueDate: new Date('2026-04-30'), projectId: 'proj_1' },
      { id: 'task_3', title: 'Анализ рынка бентонита', status: 'done', priority: 'medium', dueDate: new Date('2026-03-20'), projectId: 'proj_2' },
      { id: 'task_4', title: 'Интеграция AI чата', status: 'done', priority: 'high', dueDate: new Date('2026-03-15'), projectId: 'proj_3' },
      { id: 'task_5', title: 'Telegram Bot интеграция', status: 'todo', priority: 'medium', dueDate: new Date('2026-05-01'), projectId: 'proj_3' },
      { id: 'task_6', title: 'Мультиязычность (RU/EN/ZH)', status: 'todo', priority: 'low', dueDate: new Date('2026-06-01'), projectId: 'proj_3' },
    ];

    for (const task of tasks) {
      await prisma.task.upsert({
        where: { id: task.id },
        update: {},
        create: {
          id: task.id,
          title: task.title,
          description: '',
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          projectId: task.projectId,
          updatedAt: new Date(),
        },
      });
    }
    results.push(`Tasks: ${tasks.length}`);

    // 7. Create Risks
    const risks = [
      { id: 'risk_1', title: 'Задержка согласования СП', probability: 'high', impact: 'high', severity: 4, status: 'open', projectId: 'proj_1' },
      { id: 'risk_2', title: 'Изменение цен на логистику', probability: 'medium', impact: 'medium', severity: 3, status: 'mitigating', projectId: 'proj_2' },
      { id: 'risk_3', title: 'Блокировка Neon из РФ', probability: 'high', impact: 'low', severity: 2, status: 'mitigated', projectId: 'proj_3' },
    ];

    for (const risk of risks) {
      await prisma.risk.upsert({
        where: { id: risk.id },
        update: {},
        create: {
          id: risk.id,
          title: risk.title,
          description: '',
          probability: risk.probability,
          impact: risk.impact,
          severity: risk.severity,
          status: risk.status,
          projectId: risk.projectId,
          updatedAt: new Date(),
        },
      });
    }
    results.push(`Risks: ${risks.length}`);

    // 8. Create some initial Memory entries
    await prisma.memory.createMany({
      data: [
        {
          id: 'mem_1',
          key: 'user_name',
          value: JSON.stringify({ value: 'Саша' }),
          category: 'fact',
          type: 'long_term',
          source: 'user',
          confidence: 1,
          updatedAt: new Date(),
        },
        {
          id: 'mem_2',
          key: 'user_role',
          value: JSON.stringify({ value: 'Советник гендиректора' }),
          category: 'fact',
          type: 'long_term',
          source: 'user',
          confidence: 1,
          updatedAt: new Date(),
        },
        {
          id: 'mem_3',
          key: 'user_company',
          value: JSON.stringify({ value: 'Северавтодор' }),
          category: 'fact',
          type: 'long_term',
          source: 'user',
          confidence: 1,
          updatedAt: new Date(),
        },
      ],
    });
    results.push('Memory: Initial facts created');

    return NextResponse.json({ 
      success: true, 
      message: 'Database seeded successfully',
      results
    });
  } catch (error) {
    console.error('Seed error:', error);
    return NextResponse.json({ 
      success: false, 
      error: String(error)
    }, { status: 500 });
  }
}
