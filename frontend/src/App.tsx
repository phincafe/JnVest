import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Briefcase, CalendarDays, LineChart, Sun } from "lucide-react";
import { api } from "./api/client";
import type { AuthStatus, WatchlistTicker } from "./api/types";
import { CommandPalette } from "./components/CommandPalette";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Header } from "./components/Header";
import { LoginModal } from "./components/Login";
import { Skeleton } from "./components/Skeleton";
import { MobileTabBar, Tabs, type TabDef } from "./components/Tabs";
import { lazyWithReload } from "./lib/lazyWithReload";

// lazyWithReload auto-recovers from "Failed to fetch dynamically imported
// module" errors that happen when a fresh deploy invalidates the asset
// hashes the running tab is referencing.
const MorningTab = lazyWithReload(() => import("./pages/MorningTab"));
const WatchlistTab = lazyWithReload(() => import("./pages/WatchlistTab"));
const PortfolioTab = lazyWithReload(() => import("./pages/PortfolioTab"));
const CalendarTab = lazyWithReload(() => import("./pages/CalendarTab"));
const BotTab = lazyWithReload(() => import("./pages/BotTab"));

const BASE_TABS: TabDef[] = [
  { id: "morning", label: "Morning", icon: Sun },
  { id: "watchlist", label: "Watchlist", icon: LineChart },
  { id: "portfolio", label: "Portfolio", icon: Briefcase },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
];
// Owner-only: trading bot dashboard. Bot is a real-money-adjacent feature
// (paper orders), so we hide the tab entirely from guests rather than
// showing it disabled.
const OWNER_TABS: TabDef[] = [{ id: "bot", label: "Bot", icon: Bot }];

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

  const tabs = useMemo(
    () => (role === "owner" ? [...BASE_TABS, ...OWNER_TABS] : BASE_TABS),
    [role],
  );

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

  // If auth resolves and the user landed on a tab they don't have access to
  // (e.g. a guest with #bot in the URL), bounce to morning.
  useEffect(() => {
    if (!authReady) return;
    if (!tabs.some((t) => t.id === active)) setActive("morning");
  }, [authReady, tabs, active]);

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
        onSearch={() => setPaletteOpen(true)}
        role={role}
      />
      <Tabs tabs={tabs} active={active} onChange={setActive} />

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
              isGuest={role === "guest"}
            />
          )}
          {active === "portfolio" && (
            <PortfolioTab
              refreshNonce={refreshNonce}
              isGuest={role === "guest"}
            />
          )}
          {active === "calendar" && <CalendarTab refreshNonce={refreshNonce} />}
          {active === "bot" && role === "owner" && (
            <BotTab refreshNonce={refreshNonce} />
          )}
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

      <MobileTabBar tabs={tabs} active={active} onChange={setActive} />

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
