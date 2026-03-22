import { Risk } from './calculator';

interface Project {
  id: string;
  name: string;
  budgetPlan: number;
  budgetFact: number;
  startDate: Date;
  endDate: Date;
  tasks: any[]; // Assuming generic task structure
  team: any[];  // Assuming generic team structure
}

export function detectBudgetRisk(project: Project): Risk[] {
  const risks: Risk[] = [];
  const overrun = (project.budgetFact - project.budgetPlan) / project.budgetPlan;

  if (overrun > 0.15) {
    risks.push({
      type: 'budget',
      severity: 'critical',
      probability: 0.9,
      impact: 5,
      urgency: 3,
      description: `Бюджет превышен на ${(overrun * 100).toFixed(0)}%`,
      mitigation: ['Пересмотреть бюджет', 'Оптимизировать расходы', 'Запросить дополнительное финансирование']
    });
  }

  return risks;
}

export function detectScheduleRisk(project: Project): Risk[] {
  const risks: Risk[] = [];
  // Assuming a simplistic delay calculation for now
  const delayInDays = 20; 
  
  if (delayInDays > 14) {
    risks.push({
      type: 'schedule',
      severity: 'high',
      probability: 0.8,
      impact: 4,
      urgency: 2,
      description: `Задержка ${delayInDays} дней`,
      mitigation: ['Добавить ресурсы', 'Пересмотреть сроки', 'Приоритизировать задачи']
    });
  }
  
  return risks;
}

export function detectResourceRisk(project: Project): Risk[] {
  const risks: Risk[] = [];
  // Mock check for capacity
  const teamCapacity = 0.4; 
  
  if (teamCapacity < 0.5) {
    risks.push({
      type: 'resource',
      severity: 'medium',
      probability: 0.6,
      impact: 3,
      urgency: 2,
      description: `Загрузка команды ниже 50%`,
      mitigation: ['Нанять подрядчиков', 'Перераспределить нагрузку', 'Отложить низкоприоритетные задачи']
    });
  }
  
  return risks;
}
