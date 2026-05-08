import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Briefcase, CalendarDays, LineChart, Sun } from "lucide-react";
import { api } from "./api/client";
import type { AuthStatus, WatchlistTicker } from "./api/types";
import { CommandPalette } from "./components/CommandPalette";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Header } from "./components/Header";
import { LoginModal } from "./components/Login";
import { Skeleton } from "./components/Skeleton";
import { MobileTabBar, Tabs, type TabDef } from "./components/Tabs";

const MorningTab = lazy(() => import("./pages/MorningTab"));
const WatchlistTab = lazy(() => import("./pages/WatchlistTab"));
const PortfolioTab = lazy(() => import("./pages/PortfolioTab"));
const CalendarTab = lazy(() => import("./pages/CalendarTab"));

const TABS: TabDef[] = [
  { id: "morning", label: "Morning", icon: Sun },
  { id: "watchlist", label: "Watchlist", icon: LineChart },
  { id: "portfolio", label: "Portfolio", icon: Briefcase },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
];

export function App() {
  const [role, setRole] = useState<"owner" | "guest">("guest");
  const [authReady, setAuthReady] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [active, setActive] = useState<string>(() =>
    typeof window !== "undefined"
      ? window.location.hash.replace("#", "") || "morning"
      : "morning",
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [requestedSymbol, setRequestedSymbol] = useState<string | null>(null);
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([]);

  const refreshAuth = useCallback(async () => {
    try {
      const s = await api.get<AuthStatus>("/auth/status");
      setRole(s.role);
    } catch {
      setRole("guest");
    } finally {
      setAuthReady(true);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  // Persist tab selection in the URL hash for bookmarkability + sane reloads.
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${active}`);
    }
  }, [active]);

  // Pull watchlist symbols so cmd+K palette has suggestions (works for guests too).
  useEffect(() => {
    api
      .get<WatchlistTicker[]>("/watchlist")
      .then((rows) => setWatchlistSymbols(rows.map((r) => r.symbol)))
      .catch(() => {});
  }, [refreshNonce]);

  // Cmd+K / Ctrl+K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onLogout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      setRole("guest");
    }
  }, []);

  const onLoginClick = useCallback(() => setLoginOpen(true), []);

  const onLoginSuccess = useCallback(() => {
    setLoginOpen(false);
    refreshAuth();
  }, [refreshAuth]);

  const onPaletteSelect = (sym: string) => {
    setRequestedSymbol(sym);
    setActive("watchlist");
  };

  if (!authReady) {
    return <div className="p-8 text-sm text-(--color-text-dim)">Loading…</div>;
  }

  return (
    <div className="min-h-screen pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">
      <Header
        refreshNonce={refreshNonce}
        onRefresh={() => setRefreshNonce((n) => n + 1)}
        onLogout={onLogout}
        onLogin={onLoginClick}
        onSearch={() => setPaletteOpen(true)}
        role={role}
      />
      <Tabs tabs={TABS} active={active} onChange={setActive} />

      <ErrorBoundary key={active}>
        <Suspense fallback={<TabSkeleton />}>
          {active === "morning" && (
            <MorningTab refreshNonce={refreshNonce} isGuest={role === "guest"} />
          )}
          {active === "watchlist" && (
            <WatchlistTab
              refreshNonce={refreshNonce}
              requestedSymbol={requestedSymbol}
              onConsumedRequestedSymbol={() => setRequestedSymbol(null)}
            />
          )}
          {active === "portfolio" && (
            <PortfolioTab
              refreshNonce={refreshNonce}
              isGuest={role === "guest"}
            />
          )}
          {active === "calendar" && <CalendarTab refreshNonce={refreshNonce} />}
        </Suspense>
      </ErrorBoundary>

      {role === "guest" && (
        <footer className="mt-12 mb-6 text-center">
          <button
            type="button"
            onClick={onLoginClick}
            className="text-[11px] text-(--color-text-dim)/70 underline-offset-2 hover:text-(--color-text-dim) hover:underline"
          >
            Owner login
          </button>
        </footer>
      )}

      <MobileTabBar tabs={TABS} active={active} onChange={setActive} />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSelect={onPaletteSelect}
        watchlistSymbols={watchlistSymbols}
      />

      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSuccess={onLoginSuccess}
      />
    </div>
  );
}

function TabSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-3 px-4 py-4">
      <Skeleton className="h-24" />
      <Skeleton className="h-72" />
    </div>
  );
}
