"use client";

import { useState } from "react";
import { WelcomeStep } from "./steps/welcome-step";
import { ModeStep } from "./steps/mode-step";
import { AIStep } from "./steps/ai-step";
import { ReadyStep } from "./steps/ready-step";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";

const IS_PRODUCTION_LAUNCH = process.env.NODE_ENV === "production";

export interface OnboardingData {
  mode: "demo" | "production";
  aiProvider: "openrouter" | "zai" | "openai" | "mock";
  apiKey: string;
}

const STEPS = [
  { id: "welcome", title: "Добро пожаловать" },
  { id: "mode", title: "Режим работы" },
  { id: "ai", title: "AI настройка" },
  { id: "ready", title: "Готово!" },
];

export function OnboardingWizard() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<OnboardingData>({
    mode: IS_PRODUCTION_LAUNCH ? "production" : "demo",
    aiProvider: IS_PRODUCTION_LAUNCH ? "openrouter" : "mock",
    apiKey: "",
  });

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    // Save onboarding data
    const finalData = IS_PRODUCTION_LAUNCH
      ? {
          ...data,
          mode: "production" as const,
          aiProvider: data.aiProvider === "mock" ? ("openrouter" as const) : data.aiProvider,
        }
      : data;

    localStorage.setItem("ceoclaw-onboarding", JSON.stringify(finalData));
    localStorage.setItem("ceoclaw-onboarding-complete", "true");

    // Redirect to dashboard
    router.push("/");
  };

  const updateData = (updates: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...updates }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex flex-col">
      {/* Header */}
      <header className="p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                CEOClaw
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                AI-powered Project Management
              </p>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Шаг {currentStep + 1} из {STEPS.length}
            </div>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-2xl">
          {currentStep === 0 && <WelcomeStep />}
          {currentStep === 1 && (
            <ModeStep
              data={data}
              isProductionLaunch={IS_PRODUCTION_LAUNCH}
              updateData={updateData}
            />
          )}
          {currentStep === 2 && (
            <AIStep
              data={data}
              isProductionLaunch={IS_PRODUCTION_LAUNCH}
              updateData={updateData}
            />
          )}
          {currentStep === 3 && (
            <ReadyStep data={data} isProductionLaunch={IS_PRODUCTION_LAUNCH} />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="p-6">
        <div className="max-w-4xl mx-auto flex justify-between">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={currentStep === 0}
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Назад
          </Button>

          {currentStep < STEPS.length - 1 ? (
            <Button onClick={handleNext} className="gap-2">
              Далее
              <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={handleComplete} className="gap-2">
              Начать работу
              <ArrowRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
