"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { LogOut, Settings, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu() {
  const { data: session, status } = useSession();
  const isLoading = status === "loading";
  const publicSignupEnabled = process.env.NODE_ENV !== "production";
  const clearCachedDashboardState = () => {
    try {
      localStorage.removeItem("ceoclaw_cache");
      localStorage.removeItem("pm-dashboard-state-v1");
    } catch {
      // Ignore storage cleanup failures.
    }
  };

  if (isLoading) {
    return (
      <div className="h-10 w-10 animate-pulse rounded-full bg-[var(--panel-soft)]" />
    );
  }

  if (!session?.user) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/login">
          <Button variant="ghost" size="sm">
            Вход
          </Button>
        </Link>
        {publicSignupEnabled ? (
          <Link href="/signup">
            <Button size="sm">
              Регистрация
            </Button>
          </Link>
        ) : null}
      </div>
    );
  }

  const { user } = session;
  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user.email?.[0]?.toUpperCase() || "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Открыть меню пользователя"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line-strong)] bg-[var(--surface-panel)] text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--panel-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2"
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none text-[var(--ink)]">
              {user.name || "Пользователь"}
            </p>
            <p className="text-xs leading-none text-[var(--ink-muted)]">
              {user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link className="flex items-center" href="/settings">
            <User className="mr-2 h-4 w-4" />
            <span>Профиль</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link className="flex items-center" href="/settings">
            <Settings className="mr-2 h-4 w-4" />
            <span>Настройки</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
          onClick={() => {
            clearCachedDashboardState();
            signOut({ callbackUrl: "/" });
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Выйти</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
