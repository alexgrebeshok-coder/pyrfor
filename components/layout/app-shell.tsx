"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";

import { Sidebar } from "@/components/layout/sidebar";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { StatusBar } from "@/components/layout/status-bar";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { useDesktopHotkeys } from "@/hooks/use-desktop-hotkeys";

import { cn } from "@/lib/utils";
import { isPublicAppPath } from "@/lib/public-paths";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [mobileOpen, setMobileOpen] = useState(false);

  // Desktop keyboard shortcuts (only active in Tauri)
  useDesktopHotkeys();

  const isPublicPage = isPublicAppPath(pathname);

  if (isPublicPage) {
    return <>{children}</>;
  }

  return (
    <div className="h-[100dvh] min-h-[100dvh] overflow-hidden bg-[var(--surface)] text-[var(--ink)]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="app-shell-sidebar hidden min-h-0 shrink-0 overflow-hidden lg:block">
            <Sidebar pathname={pathname} />
          </aside>

          {/* Backdrop */}
          <div
            className={cn(
              "fixed inset-0 z-modal bg-black/60 transition-opacity duration-300 lg:hidden",
              mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
            onClick={() => setMobileOpen(false)}
          />

          {/* Drawer */}
          <div
            className={cn(
              "fixed inset-y-0 left-0 z-modal flex h-full w-[86vw] max-w-[320px] min-h-0 transform transition-transform duration-300 ease-out lg:hidden",
              mobileOpen ? "translate-x-0" : "-translate-x-full"
            )}
          >
            <div className="flex h-full w-full min-h-0 flex-col overflow-hidden border-r border-[var(--line-strong)] bg-[color:var(--surface-sidebar-mobile)] shadow-xl">
              <div className="shrink-0 flex justify-end p-4">
                <Button
                  aria-label="Close navigation"
                  onClick={() => setMobileOpen(false)}
                  size="icon"
                  variant="secondary"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <Sidebar pathname={pathname} onNavigate={() => setMobileOpen(false)} />
              </div>
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <Topbar onOpenMenu={() => setMobileOpen(true)} />
            <main
              className={cn(
                "app-shell-main app-shell-scroll-region min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 lg:px-7",
                pathname === "/chat"
                  ? "px-0 pb-0 pt-0 sm:px-0 lg:px-0"
                  : "pb-[calc(7rem+env(safe-area-inset-bottom))] sm:pb-5"
              )}
              id="main-content"
            >
              {pathname === "/chat" ? children : <div className="app-shell-content">{children}</div>}
            </main>
          </div>
        </div>

        {!pathname.startsWith("/chat") ? (
          <MobileTabBar onOpenMenu={() => setMobileOpen(true)} pathname={pathname} />
        ) : null}

        <StatusBar />
      </div>
    </div>
  );
}
