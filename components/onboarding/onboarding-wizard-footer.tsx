import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  WandSparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import type { OnboardingWizardFooterProps } from "@/components/onboarding/onboarding-wizard.types";

export function OnboardingWizardFooter({
  currentStep,
  canGoBack,
  isLastStep,
  hasAiAnswer,
  stepComplete,
  isGenerating,
  isProvisioning,
  onBack,
  onNext,
  onFinish,
}: OnboardingWizardFooterProps) {
  return (
    <footer className="border-t border-[var(--line)]/70 bg-[color:rgba(255,255,255,0.55)] backdrop-blur supports-[backdrop-filter]:bg-[color:rgba(255,255,255,0.45)] dark:bg-[color:rgba(10,12,16,0.48)]">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={!canGoBack}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Назад
        </Button>

        {!isLastStep ? (
          <Button onClick={onNext} className="gap-2" disabled={!stepComplete[currentStep]}>
            Далее
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : hasAiAnswer ? (
          <Button
            onClick={onFinish}
            className="gap-2"
            disabled={isProvisioning || isGenerating}
          >
            <CheckCircle2 className="h-4 w-4" />
            Завершить onboarding
          </Button>
        ) : (
          <Button
            onClick={onNext}
            className="gap-2"
            disabled={!stepComplete[currentStep] || isGenerating || isProvisioning}
          >
            {isGenerating || isProvisioning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Создаем workspace…
              </>
            ) : (
              <>
                <WandSparkles className="h-4 w-4" />
                Создать workspace и получить ответ
              </>
            )}
          </Button>
        )}
      </div>
    </footer>
  );
}
