import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";

type Props = { onLogin: () => void };

export function Login({ onLogin }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/auth/login", { password });
      onLogin();
    } catch (e) {
      const msg = e instanceof ApiError ? e.detail : (e as Error).message;
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-(--color-border) bg-(--color-panel) p-6"
      >
        <h1 className="text-xl font-semibold">JnVest</h1>
        <p className="text-sm text-(--color-text-dim)">Daily trading dashboard.</p>
        <input
          autoFocus
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm focus:border-(--color-accent) focus:outline-none"
        />
        {error && <div className="text-sm text-(--color-down)">{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-(--color-accent) px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
