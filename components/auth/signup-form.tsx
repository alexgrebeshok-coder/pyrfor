"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { SignupFormOAuth } from "@/components/auth/signup-form-oauth";
import {
  signupSchema,
  getPasswordStrength,
  type SignupFormData,
} from "@/lib/auth/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert } from "@/components/ui/alert";
import {
  Loader2,
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
} from "lucide-react";

interface SignupFormProps {
  onSuccess?: () => void;
  showOAuth?: boolean;
}

export function SignupForm({ onSuccess, showOAuth = true }: SignupFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const hasGoogleOAuth = !!(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
  const hasGitHubOAuth = !!(process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID);
  const showOAuthButtons = showOAuth && (hasGoogleOAuth || hasGitHubOAuth);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      terms: false,
    },
  });

  const password = watch("password");
  const passwordStrength = password ? getPasswordStrength(password) : null;

  const onSubmit = async (data: SignupFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          password: data.password,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.message || "Ошибка регистрации");
        return;
      }

      const result = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        setError("Аккаунт создан, но не удалось войти");
        router.push("/login");
        return;
      }

      if (onSuccess) {
        onSuccess();
      } else {
        router.push("/onboarding");
        router.refresh();
      }
    } catch {
      setError("Произошла ошибка. Попробуйте позже.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOAuthSignIn = async (provider: "google" | "github") => {
    setIsLoading(true);
    try {
      await signIn(provider, {
        callbackUrl: "/onboarding",
      });
    } catch {
      setError("Ошибка авторизации через " + provider);
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="error">
          <p>{error}</p>
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="name">Имя</Label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ink-muted)]" />
            <Input
              id="name"
              type="text"
              placeholder="Иван Иванов"
              className="pl-10"
              autoComplete="name"
              disabled={isLoading}
              aria-describedby={errors.name ? "name-error" : undefined}
              {...register("name")}
            />
          </div>
          {errors.name && (
            <p id="name-error" className="text-sm text-red-500">
              {errors.name.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ink-muted)]" />
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              className="pl-10"
              autoComplete="email"
              disabled={isLoading}
              aria-describedby={errors.email ? "email-error" : undefined}
              {...register("email")}
            />
          </div>
          {errors.email && (
            <p id="email-error" className="text-sm text-red-500">
              {errors.email.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Пароль</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ink-muted)]" />
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              className="pl-10 pr-10"
              autoComplete="new-password"
              disabled={isLoading}
              aria-describedby={errors.password ? "password-error" : undefined}
              {...register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>

          {password && passwordStrength && (
            <div className="space-y-2">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((level) => (
                  <div
                    key={level}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      level <= passwordStrength.score
                        ? passwordStrength.color
                        : "bg-gray-200 dark:bg-gray-700"
                    }`}
                  />
                ))}
              </div>
              <p className="text-xs text-[var(--ink-soft)]">
                Надёжность: <span className="font-medium">{passwordStrength.label}</span>
              </p>
            </div>
          )}

          {errors.password && (
            <p id="password-error" className="text-sm text-red-500">
              {errors.password.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Подтвердите пароль</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ink-muted)]" />
            <Input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              placeholder="••••••••"
              className="pl-10 pr-10"
              autoComplete="new-password"
              disabled={isLoading}
              aria-describedby={
                errors.confirmPassword ? "confirmPassword-error" : undefined
              }
              {...register("confirmPassword")}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
              aria-label={showConfirmPassword ? "Скрыть пароль" : "Показать пароль"}
            >
              {showConfirmPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          {errors.confirmPassword && (
            <p id="confirmPassword-error" className="text-sm text-red-500">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <Checkbox
              id="terms"
              disabled={isLoading}
              aria-describedby={errors.terms ? "terms-error" : undefined}
              {...register("terms")}
            />
            <label
              htmlFor="terms"
              className="text-sm text-[var(--ink-soft)] cursor-pointer select-none leading-relaxed"
            >
              Я принимаю{" "}
              <a
                href="/terms"
                className="text-[#3b82f6] hover:text-[#2563eb] transition-colors"
              >
                условия использования
              </a>{" "}
              и{" "}
              <a
                href="/privacy"
                className="text-[#3b82f6] hover:text-[#2563eb] transition-colors"
              >
                политику конфиденциальности
              </a>
            </label>
          </div>
          {errors.terms && (
            <p id="terms-error" className="text-sm text-red-500">
              {errors.terms.message}
            </p>
          )}
        </div>

        <Button
          type="submit"
          className="w-full h-11 bg-[#3b82f6] hover:bg-[#2563eb] text-white font-medium rounded-lg transition-all duration-200"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Регистрация...</span>
            </>
          ) : (
            "Зарегистрироваться"
          )}
        </Button>
      </form>

      {showOAuthButtons && (
        <SignupFormOAuth
          hasGitHubOAuth={hasGitHubOAuth}
          hasGoogleOAuth={hasGoogleOAuth}
          isLoading={isLoading}
          onOAuthSignIn={handleOAuthSignIn}
        />
      )}

      <p className="text-center text-sm text-[var(--ink-soft)]">
        Уже есть аккаунт?{" "}
        <a
          href="/login"
          className="text-[#3b82f6] hover:text-[#2563eb] font-medium transition-colors"
        >
          Войти
        </a>
      </p>
    </div>
  );
}
