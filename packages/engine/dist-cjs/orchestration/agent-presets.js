"use strict";
/**
 * Agent Presets — ready-to-use agent configurations for construction industry
 *
 * These are used by the "Agent Templates" UI to quickly create pre-configured agents.
 * Each preset maps to an existing agent definition from agents.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_PRESETS = void 0;
exports.getPreset = getPreset;
exports.AGENT_PRESETS = [
    {
        id: "pm-monitor",
        name: "PM Monitor",
        nameRu: "PM-Монитор",
        role: "pm",
        definitionId: "project-status",
        description: "Monitors project health: tracks overdue tasks, SPI/CPI metrics, milestone progress. Sends alerts on deviations.",
        descriptionRu: "Мониторит здоровье проекта: отслеживает просроченные задачи, метрики SPI/CPI, прогресс вех. Отправляет алерты при отклонениях.",
        suggestedSchedule: "0 8 * * 1-5",
        suggestedBudgetCents: 2000,
        systemPromptSuffix: `Focus on:
- Overdue tasks and approaching deadlines
- EVM metrics: CPI < 0.9 or SPI < 0.9 are RED flags
- Milestone progress vs baseline
- Resource utilization anomalies
Format output as a concise status report with RAG (Red/Amber/Green) indicators.`,
        permissions: { canCreateTasks: true },
    },
    {
        id: "analyst",
        name: "Analyst",
        nameRu: "Аналитик",
        role: "analyst",
        definitionId: "risk-analyst",
        description: "Analyzes project risks, forecasts trends, identifies bottlenecks. Weekly deep-dive reports.",
        descriptionRu: "Анализирует риски проекта, прогнозирует тренды, выявляет узкие места. Еженедельные глубокие отчёты.",
        suggestedSchedule: "0 6 * * 1",
        suggestedBudgetCents: 3000,
        systemPromptSuffix: `Your weekly analysis should cover:
- Risk register changes (new, escalated, mitigated)
- Cost trend analysis and forecast
- Schedule performance trends
- Resource bottleneck identification
- Recommendations with priority (P1/P2/P3)
Use data from tasks, expenses, and project metrics. Be specific with numbers.`,
        permissions: { canCreateTasks: false },
    },
    {
        id: "finance",
        name: "Finance Agent",
        nameRu: "Финансист",
        role: "finance",
        definitionId: "cost-control",
        description: "Tracks expenses, budget burn rate, forecasts project costs. Alerts on budget overruns.",
        descriptionRu: "Отслеживает расходы, скорость выгорания бюджета, прогнозирует стоимость проекта. Алерты при превышении бюджета.",
        suggestedSchedule: "0 9 * * 2,4",
        suggestedBudgetCents: 1500,
        systemPromptSuffix: `Monitor and report on:
- Budget vs actuals (plan/fact analysis)
- Expense trends by category
- Cost forecast to completion (EAC, ETC)
- CPI trends and projections
- Cash flow status
- 1С integration sync status if available
Flag any expense > 10% over budget category with ⚠️.`,
        permissions: { canCreateTasks: true },
    },
    {
        id: "daily-standup",
        name: "Daily Standup Bot",
        nameRu: "Бот дейли-стендапа",
        role: "communicator",
        definitionId: "progress-tracker",
        description: "Generates daily standup summaries from task changes. Posts to Telegram.",
        descriptionRu: "Генерирует ежедневные саммари из изменений задач. Отправляет в Telegram.",
        suggestedSchedule: "30 8 * * 1-5",
        suggestedBudgetCents: 1000,
        systemPromptSuffix: `Generate a concise daily standup update:
1. What was completed yesterday (tasks moved to done)
2. What's in progress today
3. Blockers and risks
Keep it brief — max 5 bullets per section. Include task IDs for reference.`,
        permissions: {},
    },
    {
        id: "quality-checker",
        name: "Quality Checker",
        nameRu: "Контролёр качества",
        role: "specialist",
        definitionId: "quality-control",
        description: "Reviews task completeness, checks documentation quality, validates deliverables.",
        descriptionRu: "Проверяет полноту задач, качество документации, валидирует результаты.",
        suggestedSchedule: "0 14 * * 3",
        suggestedBudgetCents: 2000,
        systemPromptSuffix: `Review recently completed tasks for:
- Completeness of deliverables
- Documentation quality
- Compliance with standards (ГОСТ, СНиП if applicable)
- Missing attachments or approvals
Rate each item: ✅ Pass, ⚠️ Needs attention, ❌ Fail.`,
        permissions: { canCreateTasks: true },
    },
];
function getPreset(id) {
    return exports.AGENT_PRESETS.find((p) => p.id === id);
}
