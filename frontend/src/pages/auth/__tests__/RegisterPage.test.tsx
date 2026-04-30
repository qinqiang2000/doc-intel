import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return { ...actual, useNavigate: () => navigateMock };
});

const registerMock = vi.fn();
vi.mock("../../../stores/auth-store", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ register: registerMock, loading: false }),
}));

import RegisterPage from "../RegisterPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  registerMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("RegisterPage", () => {
  it("renders email, displayName, password fields and submit", () => {
    renderPage();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /register and sign in/i })
    ).toBeInTheDocument();
  });

  it("rejects passwords shorter than 8 chars (client-side)", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/email/i), "a@x.com");
    await user.type(screen.getByLabelText(/display name/i), "A");
    // The browser-level minLength=8 may swallow the form submit, but our JS
    // handler also enforces this. We bypass DOM validation by typing 7 chars
    // and clicking — registerMock should NOT be called.
    await user.type(screen.getByLabelText(/password/i), "1234567"); // 7 chars
    await user.click(screen.getByRole("button", { name: /register and sign in/i }));

    expect(registerMock).not.toHaveBeenCalled();
  });

  it("submits and navigates to /workspaces/new on success", async () => {
    registerMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/email/i), "alice@x.com");
    await user.type(screen.getByLabelText(/display name/i), "Alice");
    await user.type(screen.getByLabelText(/password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /register and sign in/i }));

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith(
        "alice@x.com",
        "secret123",
        "Alice"
      );
    });
    expect(navigateMock).toHaveBeenCalledWith("/workspaces/new");
  });

  it("shows error when register throws", async () => {
    registerMock.mockRejectedValueOnce({
      code: "email_already_registered",
      message: "Email already registered.",
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/email/i), "dup@x.com");
    await user.type(screen.getByLabelText(/display name/i), "Dup");
    await user.type(screen.getByLabelText(/password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /register and sign in/i }));

    expect(
      await screen.findByText(/Email already registered/i)
    ).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("links to /login", () => {
    renderPage();
    const link = screen.getByRole("link", { name: /sign in/i });
    expect(link).toHaveAttribute("href", "/login");
  });
});
