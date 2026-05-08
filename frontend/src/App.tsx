import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Briefcase, CalendarDays, LineChart, Sun } from "lucide-react";
import { api } from "./api/client";
import type { AuthStatus } from "./api/types";
import { Header } from "./components/Header";
import { Login } from "./components/Login";
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
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [active, setActive] = useState<string>(() =>
    typeof window !== "undefined"
      ? window.location.hash.replace("#", "") || "morning"
      : "morning",
  );

  const refreshAuth = useCallback(async () => {
    try {
      const s = await api.get<AuthStatus>("/auth/status");
      setAuthed(s.authed);
    } catch {
      setAuthed(false);
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

  const onLogout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      setAuthed(false);
    }
  }, []);

  if (authed === null) {
    return (
      <div className="p-8 text-sm text-(--color-text-dim)">Loading…</div>
    );
  }

  if (!authed) {
    return <Login onLogin={refreshAuth} />;
  }

  return (
    <div className="min-h-screen pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">
      <Header
        refreshNonce={refreshNonce}
        onRefresh={() => setRefreshNonce((n) => n + 1)}
        onLogout={onLogout}
      />
      <Tabs tabs={TABS} active={active} onChange={setActive} />

      <Suspense fallback={<TabSkeleton />}>
        {active === "morning" && <MorningTab refreshNonce={refreshNonce} />}
        {active === "watchlist" && <WatchlistTab refreshNonce={refreshNonce} />}
        {active === "portfolio" && <PortfolioTab refreshNonce={refreshNonce} />}
        {active === "calendar" && <CalendarTab refreshNonce={refreshNonce} />}
      </Suspense>

      <MobileTabBar tabs={TABS} active={active} onChange={setActive} />
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
