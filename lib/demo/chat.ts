import type { AIChatContextBundle } from "@/lib/ai/context-builder";

type DemoSection = {
  title: string;
  bullets: string[];
};

export function composeDemoChatResponse(bundle: AIChatContextBundle): string {
  const intro =
    bundle.locale === "ru"
      ? `Коротко: ${bundle.summary}`
      : `Short answer: ${bundle.summary}`;

  const facts = collectFacts(bundle);
  const normalizedFacts = facts.length > 0 ? facts : [bundle.summary];
  const recommendation = collectRecommendation(bundle);
  const nextStep = collectNextStep(bundle);
  const headings =
    bundle.locale === "ru"
      ? {
          facts: "Факты",
          recommendation: "Рекомендация",
          nextStep: "Следующий шаг",
        }
      : {
          facts: "Facts",
          recommendation: "Recommendation",
          nextStep: "Next step",
        };

  return [
    intro,
    "",
    `${headings.facts}:`,
    ...normalizedFacts.map((fact) => `- ${fact}`),
    "",
    `${headings.recommendation}:`,
    `- ${recommendation}`,
    "",
    `${headings.nextStep}:`,
    `- ${nextStep}`,
  ].join("\n");
}

function collectFacts(bundle: AIChatContextBundle): string[] {
  const context = findSection(bundle.sections, /контекст/i);
  const planFact = findSection(bundle.sections, /план-факт/i);
  const alerts = findSection(bundle.sections, /сигналы/i);
  const evidence = findSection(bundle.sections, /evidence/i);
  const team = findSection(bundle.sections, /команда/i);

  switch (bundle.focus) {
    case "financial":
      return bundle.scope === "project"
        ? [
            context?.bullets[0],
            context?.bullets[2],
            planFact?.bullets[0],
            planFact?.bullets[1],
          ].filter(isPresent)
        : [
            context?.bullets[0],
            planFact?.bullets[0],
            planFact?.bullets[1],
            alerts?.bullets[0],
          ].filter(isPresent);
    case "risk":
      return [
        context?.bullets[0],
        alerts?.bullets[0],
        alerts?.bullets[1],
        alerts?.bullets[2],
      ].filter(isPresent);
    case "execution":
      return [
        context?.bullets[0],
        planFact?.bullets[2],
        planFact?.bullets[3],
        evidence?.bullets[0],
      ].filter(isPresent);
    case "team":
      return [team?.bullets[0], team?.bullets[1], team?.bullets[2], alerts?.bullets[0]].filter(
        isPresent
      );
    case "reporting":
      return [planFact?.bullets[2], evidence?.bullets[0], alerts?.bullets[0]].filter(isPresent);
    case "evidence":
      return [evidence?.bullets[0], evidence?.bullets[1], evidence?.bullets[2]].filter(isPresent);
    default:
      return [context?.bullets[0], planFact?.bullets[0], alerts?.bullets[0], evidence?.bullets[0]].filter(
        isPresent
      );
  }
}

function collectRecommendation(bundle: AIChatContextBundle): string {
  const alertRecommendation = bundle.alertFeed.recommendationsSummary[0];
  if (alertRecommendation) {
    return alertRecommendation;
  }

  if (bundle.locale === "ru") {
    switch (bundle.focus) {
      case "financial":
        return "Сверьте budgetPlan и budgetFact, затем подтвердите variance, CPI, SPI, EAC и VAC перед следующим решением.";
      case "risk":
        return "Снимите главный риск с помощью owner, mitigation и следующего контрольного шага.";
      case "execution":
        return "Сначала разберите просроченные и заблокированные задачи, затем обновите milestones и work reports.";
      case "team":
        return "Проверьте перегруз команды и перераспределите владельцев по критическим задачам.";
      case "reporting":
        return "Сверьте свежесть отчётности и доведите статусы до формы, готовой для руководства.";
      case "evidence":
        return "Используйте только подтверждённые evidence и не добавляйте факты без подтверждения.";
      default:
        return "Сначала дайте короткий ответ, затем приведите факты и один практический следующий шаг.";
    }
  }

  switch (bundle.focus) {
    case "financial":
      return "Reconcile budgetPlan and budgetFact, then confirm variance, CPI, SPI, EAC, and VAC before the next decision.";
    case "risk":
      return "Remove the main risk with a clear owner, mitigation, and the next control step.";
    case "execution":
      return "Start with overdue and blocked tasks, then refresh milestones and work reports.";
    case "team":
      return "Check team load and reassign owners across the critical work.";
    case "reporting":
      return "Review reporting freshness and make the status ready for leadership.";
    case "evidence":
      return "Use only verified evidence and avoid facts without support.";
    default:
      return "Start with a short answer, then facts, then one practical next step.";
  }
}

function collectNextStep(bundle: AIChatContextBundle): string {
  const recommendation = bundle.alertFeed.recommendationsSummary[1];
  if (recommendation) {
    return recommendation;
  }

  const projectLabel = bundle.projectName ?? bundle.alertFeed.alerts[0]?.projectName;

  if (bundle.locale === "ru") {
    if (projectLabel) {
      return `Откройте проект «${projectLabel}» и проверьте следующий owner, deadline и бюджетный разрыв.`;
    }

    return "Выберите 1-2 проекта с самыми заметными сигналами и назначьте на них следующий контрольный шаг.";
  }

  if (projectLabel) {
    return `Open project "${projectLabel}" and confirm the next owner, deadline, and budget gap.`;
  }

  return "Pick the 1-2 most visible projects and assign the next control step.";
}

function findSection(sections: DemoSection[], matcher: RegExp): DemoSection | null {
  return sections.find((section) => matcher.test(section.title)) ?? null;
}

function isPresent(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
