import { useState, FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/auth-store";

export default function LoginPage() {
  const navigate = useNavigate();
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
        (err as { message?: string })?.message ?? "Login failed";
      setError(msg);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f1117] text-[#e2e8f0]">
      <form
        onSubmit={onSubmit}
        className="bg-[#1a1d27] border border-[#2a2e3d] rounded-lg p-8 w-full max-w-sm"
      >
        <h1 className="text-xl font-bold mb-6">登录 doc-intel</h1>

        <label
          htmlFor="login-email"
          className="block text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-1"
        >
          Email
        </label>
        <input
          id="login-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-2 mb-4 focus:border-[#6366f1] outline-none text-sm"
        />

        <label
          htmlFor="login-password"
          className="block text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-1"
        >
          密码
        </label>
        <input
          id="login-password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-2 mb-6 focus:border-[#6366f1] outline-none text-sm"
        />

        {error && (
          <div className="text-[#ef4444] text-xs mb-4">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#6366f1] hover:bg-[#818cf8] text-white font-semibold py-2 rounded text-sm disabled:opacity-50"
        >
          {loading ? "登录中..." : "登录"}
        </button>

        <div className="text-xs text-[#64748b] mt-4 text-center">
          还没有账号？
          <Link to="/register" className="text-[#6366f1] hover:underline">
            注册
          </Link>
        </div>
      </form>
    </div>
  );
}
