/**
 * Seed Memory with Project Facts
 * 
 * Run: npx ts-node scripts/seed-memory.ts
 */

import { prisma } from '../lib/db';
import { logger } from '../lib/logger';

interface ProjectFact {
  key: string;
  value: any;
  category: 'project' | 'fact';
  confidence: number;
  source: 'system' | 'user';
}

async function main() {
  logger.info('[Seed] Starting memory seed...');
  
  // Get all projects
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      progress: true,
      budgetPlan: true,
      budgetFact: true,
      start: true,
      end: true,
      location: true,
      direction: true,
      priority: true,
      health: true,
    },
  });
  
  logger.info(`[Seed] Found ${projects.length} projects`);
  
  const facts: ProjectFact[] = [];
  
  for (const p of projects) {
    // Project overview
    facts.push({
      key: `project:${p.name}:status`,
      value: {
        status: p.status,
        progress: p.progress,
        health: p.health,
        priority: p.priority,
      },
      category: 'project',
      confidence: 100,
      source: 'system',
    });
    
    // Budget info
    if (p.budgetPlan) {
      const budgetUsed = p.budgetFact / p.budgetPlan;
      facts.push({
        key: `project:${p.name}:budget`,
        value: {
          plan: p.budgetPlan,
          fact: p.budgetFact,
          usedPercent: Math.round(budgetUsed * 100),
          cpi: budgetUsed > 0 ? (p.progress / 100) / budgetUsed : null,
        },
        category: 'project',
        confidence: 100,
        source: 'system',
      });
    }
    
    // Timeline
    if (p.start && p.end) {
      const totalDays = Math.ceil((p.end.getTime() - p.start.getTime()) / (1000 * 60 * 60 * 24));
      const elapsed = Math.ceil((Date.now() - p.start.getTime()) / (1000 * 60 * 60 * 24));
      facts.push({
        key: `project:${p.name}:timeline`,
        value: {
          start: p.start,
          end: p.end,
          totalDays,
          elapsedDays: Math.max(0, elapsed),
          expectedProgress: Math.min(100, Math.round((elapsed / totalDays) * 100)),
          actualProgress: p.progress,
        },
        category: 'project',
        confidence: 100,
        source: 'system',
      });
    }
    
    // Location
    if (p.location) {
      facts.push({
        key: `project:${p.name}:location`,
        value: { location: p.location, direction: p.direction },
        category: 'project',
        confidence: 100,
        source: 'system',
      });
    }
  }
  
  // Add general facts
  facts.push({
    key: 'company:name',
    value: { name: 'Северавтодор', location: 'Лабытнанги, ЯНАО' },
    category: 'fact',
    confidence: 100,
    source: 'user',
  });
  
  facts.push({
    key: 'user:role',
    value: { role: 'Советник генерального директора', company: 'Северавтодор' },
    category: 'fact',
    confidence: 100,
    source: 'user',
  });
  
  facts.push({
    key: 'evm:formulas',
    value: {
      SPI: 'BCWP / BCWS (Schedule Performance Index)',
      CPI: 'BCWP / ACWP (Cost Performance Index)',
      EAC: 'BAC / CPI (Estimate at Completion)',
      VAC: 'BAC - EAC (Variance at Completion)',
      interpretation: {
        SPI_greater_1: 'Опережение графика',
        SPI_less_1: 'Отставание от графика',
        CPI_greater_1: 'Экономия бюджета',
        CPI_less_1: 'Перерасход бюджета',
      },
    },
    category: 'fact',
    confidence: 100,
    source: 'system',
  });
  
  // Clear old memories (optional)
  // await prisma.memory.deleteMany({});
  
  // Insert facts
  let inserted = 0;
  for (const fact of facts) {
    try {
      await prisma.memory.create({
        data: {
          id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          type: 'long_term',
          category: fact.category,
          key: fact.key,
          value: JSON.stringify(fact.value),
          confidence: fact.confidence,
          source: fact.source,
          updatedAt: new Date(),
        },
      });
      inserted++;
    } catch (error) {
      // Skip duplicates
      logger.warn(`[Seed] Skipped ${fact.key}: ${error}`);
    }
  }
  
  logger.info(`[Seed] Inserted ${inserted} facts`);
  
  // Show stats
  const total = await prisma.memory.count();
  const byCategory = await prisma.memory.groupBy({
    by: ['category'],
    _count: true,
  });
  
  console.log('\n📊 Memory Stats:');
  console.log(`   Total: ${total}`);
  byCategory.forEach(c => {
    console.log(`   ${c.category}: ${c._count}`);
  });
  
  await prisma.$disconnect();
}

main().catch(error => {
  console.error('[Seed] Error:', error);
  process.exit(1);
});
