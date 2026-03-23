import { describe, expect, it, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { waitFor } from "@testing-library/react";

import { render, screen } from "@/__tests__/utils/render";
import { LoginForm } from "@/components/auth/login-form";

const { mockSignIn, mockGetSession, mockSearchParamsGet } = vi.hoisted(() => ({
  mockSignIn: vi.fn(),
  mockGetSession: vi.fn(),
  mockSearchParamsGet: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  signIn: mockSignIn,
  getSession: mockGetSession,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: mockSearchParamsGet,
  }),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsGet.mockReturnValue("/");
  });

  it("waits for an authenticated session before continuing after successful sign-in", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();

    mockSignIn.mockResolvedValue({
      error: undefined,
      url: "/",
    });
    mockGetSession
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        user: {
          id: "user-1",
          email: "prod-test@ceoclaw.dev",
        },
      });

    render(<LoginForm onSuccess={onSuccess} showOAuth={false} />);

    await user.type(screen.getByLabelText(/email/i), "prod-test@ceoclaw.dev");
    await user.type(screen.getByLabelText(/пароль/i, { selector: "input" }), "CeoClaw#Prod#4278!");
    await user.click(screen.getByRole("button", { name: /войти/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    expect(mockSignIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({
        email: "prod-test@ceoclaw.dev",
        password: "CeoClaw#Prod#4278!",
        redirect: false,
        callbackUrl: "/",
      })
    );
    expect(mockGetSession).toHaveBeenCalledTimes(3);
  });
});
