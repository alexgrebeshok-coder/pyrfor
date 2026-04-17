import type { LucideIcon } from "lucide-react";

import type { ObjectiveTheme, ObjectiveSummary } from "@/lib/goals/objective-summary";
import type { PortfolioScenarioOutlook } from "@/lib/portfolio/portfolio-outlook";
import type { Project } from "@/lib/types";

export type GoalClusterKey = "delivery" | "budget" | "evidence" | "capacity";

export type GoalCluster = {
  key: GoalClusterKey;
  title: string;
  description: string;
  nextAction: string;
  currentLabel: string;
  targetLabel: string;
  metricLabel: string;
  score: number;
  variant: "success" | "warning" | "danger" | "info";
  icon: LucideIcon;
  highlights: string[];
};

export type ProjectCardModel = {
  project: Project;
  warningCount: number;
  overdueTasks: number;
  budgetUsage: number;
};

export type GoalsEnumLabel = (
  category:
    | "severity"
    | "projectStatus"
    | "taskStatus"
    | "priority"
    | "direction"
    | "riskStatus",
  value: string
) => string;

export interface GoalsHeroProps {
  clusters: GoalCluster[];
  deviationCount: number;
  overloadedMembersCount: number;
  projectsCount: number;
  showLoadingState: boolean;
}

export interface GoalsPriorityPanelProps {
  budgetError: unknown;
  budgetLoading: boolean;
  budgetUsed: number;
  capacityError: unknown;
  capacityLoading: boolean;
  capacityUtilization: number;
  objectiveSummary: ObjectiveSummary;
  planFactCpi?: number | null;
  priorityCluster: GoalCluster | null;
  scenarioOutlook: PortfolioScenarioOutlook;
}

export interface GoalsProjectsPanelProps {
  activeObjective: string | null;
  enumLabel: GoalsEnumLabel;
  onObjectiveChange: (objective: string | null) => void;
  onQueryChange: (value: string) => void;
  projectCards: ProjectCardModel[];
  query: string;
  showLoadingState: boolean;
  topObjectiveThemes: ObjectiveTheme[];
}
