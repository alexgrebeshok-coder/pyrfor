import type { Metadata } from "next";

import { OnboardingWizard } from "@/components/onboarding/wizard";

export const metadata: Metadata = {
  title: "Lite onboarding — CEOClaw",
  description:
    "Выберите роль, шаблон проекта, стартовые задачи, бюджет и получите AI-ответ для быстрого запуска workspace.",
};

export default function OnboardingPage() {
  return <OnboardingWizard />;
}
