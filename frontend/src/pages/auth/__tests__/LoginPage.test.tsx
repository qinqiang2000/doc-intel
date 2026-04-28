import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock react-router-dom's useNavigate before importing the page
const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return { ...actual, useNavigate: () => navigateMock };
});

// Mock the auth-store
const loginMock = vi.fn();
vi.mock("../../../stores/auth-store", () => ({
  useAuthStore: (selector: (s: any) => unknown) =>
    selector({ login: loginMock, loading: false }),
}));

import LoginPage from "../LoginPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  loginMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LoginPage", () => {
  it("renders email + password fields and a submit button", () => {
    renderPage();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/密码/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /登录/i })).toBeInTheDocument();
  });

  it("submits credentials and navigates to /dashboard on success", async () => {
    loginMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/email/i), "alice@x.com");
    await user.type(screen.getByLabelText(/密码/i), "secret123");
    await user.click(screen.getByRole("button", { name: /登录/i }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith("alice@x.com", "secret123");
    });
    expect(navigateMock).toHaveBeenCalledWith("/dashboard");
  });

  it("shows the error message when login throws", async () => {
    loginMock.mockRejectedValueOnce({
      code: "invalid_credentials",
      message: "Email or password incorrect.",
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/email/i), "alice@x.com");
    await user.type(screen.getByLabelText(/密码/i), "wrong");
    await user.click(screen.getByRole("button", { name: /登录/i }));

    expect(
      await screen.findByText(/Email or password incorrect/i)
    ).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("links to /register", () => {
    renderPage();
    const link = screen.getByRole("link", { name: /注册/i });
    expect(link).toHaveAttribute("href", "/register");
  });
});
