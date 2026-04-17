import type { DashboardState } from "@/lib/types";
import type {
  OnboardingDraft,
  OnboardingRole,
  OnboardingRoleOption,
  OnboardingTemplate,
  OnboardingTemplateId,
} from "@/lib/onboarding";

export type StepItem = {
  id: string;
  title: string;
};

export interface OnboardingWizardLoadingStateProps {
  progress?: number;
}

export interface OnboardingWizardHeaderProps {
  currentStep: number;
  progress: number;
  steps: readonly StepItem[];
  stepComplete: readonly boolean[];
  onStepSelect: (index: number) => void;
}

export interface OnboardingWizardStepPanelProps {
  currentStep: number;
  steps: readonly StepItem[];
  draft: OnboardingDraft;
  template: OnboardingTemplate;
  roleOptions: readonly OnboardingRoleOption[];
  taskCount: number;
  budgetDelta: number;
  hasAiAnswer: boolean;
  error: string | null;
  warning: string | null;
  onSelectRole: (role: OnboardingRole) => void;
  onSelectTemplate: (templateId: OnboardingTemplateId) => void;
  onUpdateDraft: (updates: Partial<OnboardingDraft>) => void;
  onUpdateTask: (index: number, updates: Partial<OnboardingDraft["tasks"][number]>) => void;
  onAddTask: () => void;
  onRemoveTask: (index: number) => void;
}

export interface OnboardingWizardSidebarProps {
  draft: OnboardingDraft;
  dashboardPreview: DashboardState;
  template: OnboardingTemplate;
}

export interface OnboardingWizardFooterProps {
  currentStep: number;
  canGoBack: boolean;
  isLastStep: boolean;
  hasAiAnswer: boolean;
  stepComplete: readonly boolean[];
  isGenerating: boolean;
  isProvisioning: boolean;
  onBack: () => void;
  onNext: () => void | Promise<void>;
  onFinish: () => void;
}

export interface OnboardingWizardViewProps {
  currentStep: number;
  progress: number;
  steps: readonly StepItem[];
  stepComplete: readonly boolean[];
  draft: OnboardingDraft;
  dashboardPreview: DashboardState;
  template: OnboardingTemplate;
  roleOptions: readonly OnboardingRoleOption[];
  error: string | null;
  warning: string | null;
  taskCount: number;
  budgetDelta: number;
  hasAiAnswer: boolean;
  canGoBack: boolean;
  isLastStep: boolean;
  isGenerating: boolean;
  isProvisioning: boolean;
  onStepSelect: (index: number) => void;
  onSelectRole: (role: OnboardingRole) => void;
  onSelectTemplate: (templateId: OnboardingTemplateId) => void;
  onUpdateDraft: (updates: Partial<OnboardingDraft>) => void;
  onUpdateTask: (index: number, updates: Partial<OnboardingDraft["tasks"][number]>) => void;
  onAddTask: () => void;
  onRemoveTask: (index: number) => void;
  onBack: () => void;
  onNext: () => void | Promise<void>;
  onFinish: () => void;
}
