import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../stores/auth-store";

export default function LoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      const msg =
        (err as { message?: string })?.message ?? t("auth.loginFailed");
      setError(msg);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas text-primary">
      <form
        onSubmit={onSubmit}
        className="bg-surface border border-default rounded-lg p-8 w-full max-w-sm"
      >
        <h1 className="text-xl font-bold mb-6">{t("auth.loginTitle")}</h1>

        <label
          htmlFor="login-email"
          className="block text-xs uppercase font-semibold tracking-wider text-muted mb-1"
        >
          {t("auth.email")}
        </label>
        <input
          id="login-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-surface-input border border-default rounded px-3 py-2 mb-4 focus:border-accent outline-none text-sm"
        />

        <label
          htmlFor="login-password"
          className="block text-xs uppercase font-semibold tracking-wider text-muted mb-1"
        >
          {t("auth.password")}
        </label>
        <input
          id="login-password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-surface-input border border-default rounded px-3 py-2 mb-6 focus:border-accent outline-none text-sm"
        />

        {error && (
          <div className="text-danger text-xs mb-4">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-accent hover:bg-accent-hover text-white font-semibold py-2 rounded text-sm disabled:opacity-50"
        >
          {loading ? t("auth.signingIn") : t("auth.signIn")}
        </button>

        <div className="text-xs text-subtle mt-4 text-center">
          {t("auth.noAccount")}{" "}
          <Link to="/register" className="text-accent hover:underline">
            {t("auth.signUp")}
          </Link>
        </div>
      </form>
    </div>
  );
}
