import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { PWAInstallPrompt } from "@/components/pwa-install-prompt";

const mockUsePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

describe("PWAInstallPrompt", () => {
  beforeEach(() => {
    mockUsePathname.mockReset();
    mockUsePathname.mockReturnValue("/projects");
    localStorage.clear();
    delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
  });

  it("stays hidden on public routes", () => {
    mockUsePathname.mockReturnValue("/login");

    render(<PWAInstallPrompt />);

    expect(screen.queryByRole("region", { name: /установка ceoclaw/i })).toBeNull();
  });

  it("stays hidden inside a native shell", () => {
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = {};

    render(<PWAInstallPrompt />);

    expect(screen.queryByRole("region", { name: /установка ceoclaw/i })).toBeNull();
  });
});
