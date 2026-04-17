import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

import type { OnboardingWizardLoadingStateProps } from "@/components/onboarding/onboarding-wizard.types";

export function OnboardingWizardLoadingState({
  progress = 45,
}: OnboardingWizardLoadingStateProps) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.16),_transparent_35%),linear-gradient(180deg,_var(--surface),_var(--surface))] flex items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Загружаем onboarding</CardTitle>
          <CardDescription>
            Восстанавливаем ваш прогресс из localStorage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={progress} />
        </CardContent>
      </Card>
    </div>
  );
}
