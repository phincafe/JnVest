import { useCallback, useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { api } from "./api/client";
import type { AuthStatus } from "./api/types";
import { Calendar } from "./components/Calendar";
import { Login } from "./components/Login";
import { MarketContext } from "./components/MarketContext";
import { StockDetail } from "./components/StockDetail";
import { Watchlist } from "./components/Watchlist";

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isPaper, setIsPaper] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const refreshAuth = useCallback(async () => {
    try {
      const s = await api.get<AuthStatus>("/auth/status");
      setAuthed(s.authed);
      setIsPaper(s.is_paper);
    } catch {
      setAuthed(false);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  if (authed === null) {
    return <div className="p-8 text-sm text-(--color-text-dim)">Loading…</div>;
  }

  if (!authed) {
    return <Login onLogin={refreshAuth} />;
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-(--color-border) bg-(--color-bg)/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold">JnVest</h1>
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                isPaper
                  ? "bg-yellow-600/30 text-yellow-200"
                  : "bg-red-600/30 text-red-200"
              }`}
            >
              {isPaper ? "PAPER" : "LIVE"}
            </span>
          </div>
          <button
            onClick={() => setRefreshNonce((n) => n + 1)}
            className="flex items-center gap-1.5 rounded-md border border-(--color-border) px-3 py-1.5 text-xs text-(--color-text-dim) hover:text-(--color-text)"
            aria-label="Refresh"
          >
            <RefreshCcw size={14} /> Refresh
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-4">
        <MarketContext refreshNonce={refreshNonce} />
        <Watchlist
          refreshNonce={refreshNonce}
          selected={selectedSymbol}
          onSelect={setSelectedSymbol}
        />
        <StockDetail symbol={selectedSymbol} />
        <Calendar refreshNonce={refreshNonce} />
        <ApiBanner />
      </main>
    </div>
  );
}

function ApiBanner() {
  const [needs, setNeeds] = useState(false);
  useEffect(() => {
    api
      .get<{ alpaca_configured: boolean }>("/health")
      .then((r) => setNeeds(!r.alpaca_configured))
      .catch(() => {
        /* ignore */
      });
  }, []);
  if (!needs) return null;
  return (
    <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
      Alpaca API keys are not configured. Add <code>ALPACA_API_KEY</code> and{" "}
      <code>ALPACA_API_SECRET</code> to your <code>.env</code> (paper keys recommended).
    </div>
  );
}
