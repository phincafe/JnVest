import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { api, ApiError } from "../api/client";

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export function LoginModal({ open, onClose, onSuccess }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setPassword("");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/auth/login", { password });
      onSuccess();
    } catch (e) {
      const msg = e instanceof ApiError ? e.detail : (e as Error).message;
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[18vh] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-4 rounded-xl border border-(--color-border) bg-(--color-panel) p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Owner login</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-(--color-text-dim) hover:text-(--color-text)"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-(--color-text-dim)">
          Sign in with your owner password to see $ amounts, per-account details,
          and access write actions.
        </p>
        <input
          autoFocus
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Owner password"
          className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm focus:border-(--color-accent) focus:outline-none"
        />
        {error && <div className="text-sm text-(--color-down)">{error}</div>}
        <button
          type="submit"
          disabled={submitting || !password}
          className="w-full rounded-lg bg-(--color-accent) px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
