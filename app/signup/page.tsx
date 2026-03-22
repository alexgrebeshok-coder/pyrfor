import { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata: Metadata = {
  title: "Регистрация | CEO Claw",
  description: "Создайте аккаунт CEO Claw",
};

export default function SignupPage() {
  const publicSignupEnabled = process.env.NODE_ENV !== "production";

  if (!publicSignupEnabled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--surface)] p-8">
        <div className="w-full max-w-lg rounded-3xl border border-[var(--line-strong)] bg-[var(--surface-panel)] p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-[var(--ink)]">Регистрация закрыта</h1>
          <p className="mt-3 text-sm text-[var(--ink-soft)]">
            Для production-контура CEOClaw сейчас используется операторское создание аккаунтов.
            Обратитесь к администратору или войдите в уже подготовленную учетную запись.
          </p>
          <div className="mt-6">
            <Link
              href="/login"
              className="inline-flex rounded-lg bg-[#3b82f6] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2563eb]"
            >
              Перейти ко входу
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Branding/Illustration */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-[#3b82f6] to-[#2563eb] items-center justify-center p-12">
        <div className="max-w-lg text-white space-y-6">
          <div className="space-y-4">
            <h2 className="text-xl font-bold leading-tight">
              Начните работу за минуту
            </h2>
            <p className="text-lg text-white/80">
              Присоединяйтесь к тысячам команд, которые уже используют 
              CEO Claw для достижения своих целей.
            </p>
          </div>
          
          <div className="space-y-4 pt-8">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-lg">Быстрый старт</h3>
                <p className="text-white/70">
                  Создайте первый проект за 5 минут
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-lg">Бесплатный период</h3>
                <p className="text-white/70">
                  14 дней полного доступа без ограничений
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-lg">Без кредитной карты</h3>
                <p className="text-white/70">
                  Начните использовать прямо сейчас
                </p>
              </div>
            </div>
          </div>
          
          <div className="pt-8 border-t border-white/10">
            <div className="flex items-center gap-4">
              <div className="flex -space-x-2">
                <div className="w-10 h-10 rounded-full bg-white/20 border-2 border-white flex items-center justify-center text-sm font-medium">
                  АК
                </div>
                <div className="w-10 h-10 rounded-full bg-white/20 border-2 border-white flex items-center justify-center text-sm font-medium">
                  МС
                </div>
                <div className="w-10 h-10 rounded-full bg-white/20 border-2 border-white flex items-center justify-center text-sm font-medium">
                  ЕП
                </div>
              </div>
              <div>
                <p className="text-sm text-white/90">
                  <span className="font-semibold">1,200+</span> команд уже с нами
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-[var(--surface)]">
        <div className="w-full max-w-md space-y-6">
          {/* Logo & Header */}
          <div className="text-center space-y-2">
            <Link href="/" className="inline-block">
              <div className="flex items-center justify-center gap-2 mb-6">
                <div className="w-10 h-10 bg-[#3b82f6] rounded-xl flex items-center justify-center">
                  <span className="text-white font-bold text-xl">C</span>
                </div>
                <span className="text-2xl font-bold text-[var(--ink)]">
                  CEO Claw
                </span>
              </div>
            </Link>
            <h1 className="text-2xl font-bold text-[var(--ink)]">
              Создайте аккаунт
            </h1>
            <p className="text-[var(--ink-soft)]">
              Начните бесплатный период прямо сейчас
            </p>
          </div>

          {/* Signup Form Card */}
          <div className="bg-[var(--surface-panel)] border border-[var(--line-strong)] rounded-2xl p-8 shadow-sm">
            <SignupForm showOAuth={true} />
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-[var(--ink-muted)]">
            © 2024 CEO Claw. Все права защищены.
          </p>
        </div>
      </div>
    </div>
  );
}
