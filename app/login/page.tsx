import { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Вход | CEO Claw",
  description: "Войдите в свой аккаунт CEO Claw",
};

export default function LoginPage() {
  return (
    <div className="min-h-screen flex">
      {/* Left Side - Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-[var(--surface)]">
        <div className="w-full max-w-md space-y-6">
          {/* Logo & Header */}
          <div className="text-center space-y-2">
            <Link href="/landing" className="inline-block">
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
              С возвращением!
            </h1>
            <p className="text-[var(--ink-soft)]">
              Войдите в свой аккаунт для продолжения
            </p>
          </div>

          {/* Login Form Card */}
          <div className="bg-[var(--surface-panel)] border border-[var(--line-strong)] rounded-2xl p-8 shadow-sm">
            <LoginForm showOAuth={true} />
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-[var(--ink-muted)]">
            © 2024 CEO Claw. Все права защищены.
          </p>
        </div>
      </div>

      {/* Right Side - Branding/Illustration */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-[#3b82f6] to-[#2563eb] items-center justify-center p-12">
        <div className="max-w-lg text-white space-y-6">
          <div className="space-y-4">
            <h2 className="text-xl font-bold leading-tight">
              Управляйте проектами с умом
            </h2>
            <p className="text-lg text-white/80">
              CEO Claw — современная платформа для управления проектами, 
              которая помогает командам работать эффективнее.
            </p>
          </div>
          
          <div className="grid grid-cols-2 gap-4 pt-8">
            <div className="space-y-2">
              <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="font-semibold">Аналитика</h3>
              <p className="text-sm text-white/70">
                Отслеживайте прогресс в реальном времени
              </p>
            </div>
            
            <div className="space-y-2">
              <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <h3 className="font-semibold">Команда</h3>
              <p className="text-sm text-white/70">
                Эффективное взаимодействие
              </p>
            </div>
            
            <div className="space-y-2">
              <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="font-semibold">Безопасность</h3>
              <p className="text-sm text-white/70">
                Защита данных на уровне банка
              </p>
            </div>
            
            <div className="space-y-2">
              <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="font-semibold">Скорость</h3>
              <p className="text-sm text-white/70">
                Мгновенный доступ к данным
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
