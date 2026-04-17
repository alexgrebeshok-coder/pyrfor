import { OnboardingWizardFooter } from "@/components/onboarding/onboarding-wizard-footer";
import { OnboardingWizardHeader } from "@/components/onboarding/onboarding-wizard-header";
import { OnboardingWizardLoadingState } from "@/components/onboarding/onboarding-wizard-loading-state";
import { OnboardingWizardSidebar } from "@/components/onboarding/onboarding-wizard-sidebar";
import { OnboardingWizardStepPanel } from "@/components/onboarding/onboarding-wizard-step-panel";
import type { OnboardingWizardViewProps } from "@/components/onboarding/onboarding-wizard.types";

export { OnboardingWizardLoadingState };

export function OnboardingWizardView(props: OnboardingWizardViewProps) {
  const stepPanelProps = {
    currentStep: props.currentStep,
    steps: props.steps,
    draft: props.draft,
    template: props.template,
    roleOptions: props.roleOptions,
    taskCount: props.taskCount,
    budgetDelta: props.budgetDelta,
    hasAiAnswer: props.hasAiAnswer,
    error: props.error,
    warning: props.warning,
    onSelectRole: props.onSelectRole,
    onSelectTemplate: props.onSelectTemplate,
    onUpdateDraft: props.onUpdateDraft,
    onUpdateTask: props.onUpdateTask,
    onAddTask: props.onAddTask,
    onRemoveTask: props.onRemoveTask,
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_35%),linear-gradient(180deg,_var(--surface),_var(--surface))] text-[var(--ink)]">
      <OnboardingWizardHeader
        currentStep={props.currentStep}
        progress={props.progress}
        steps={props.steps}
        stepComplete={props.stepComplete}
        onStepSelect={props.onStepSelect}
      />

      <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.8fr)] lg:px-8">
        <section className="space-y-6">
          <OnboardingWizardStepPanel {...stepPanelProps} />
        </section>

        <OnboardingWizardSidebar
          draft={props.draft}
          dashboardPreview={props.dashboardPreview}
          template={props.template}
        />
      </main>

      <OnboardingWizardFooter
        currentStep={props.currentStep}
        canGoBack={props.canGoBack}
        isLastStep={props.isLastStep}
        hasAiAnswer={props.hasAiAnswer}
        stepComplete={props.stepComplete}
        isGenerating={props.isGenerating}
        isProvisioning={props.isProvisioning}
        onBack={props.onBack}
        onNext={props.onNext}
        onFinish={props.onFinish}
      />
    </div>
  );
}
