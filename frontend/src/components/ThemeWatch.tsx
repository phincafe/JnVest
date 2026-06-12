/**
 * Theme watch — curated static ticker lists (Space, WH policy) evaluated
 * through the Buy Watch engine. Same status badges and signals as Buy
 * Watch, but the list is hardcoded server-side and isn't user-editable.
 *
 * Backend endpoint: GET /api/theme-watch/{theme}
 * Returns rows shaped like BuyWatchTarget + a `group` field for the
 * subgroup label (e.g. "Launch & rockets").
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../api/client";
import type { BuyWatchStatus, BuyWatchTarget } from "../api/types";
import { useCachedFetch } from "../hooks/useCachedFetch";
import { fmtPrice } from "../lib/format";
import { Skeleton } from "./Skeleton";

type ThemeRow = BuyWatchTarget & { group: string };
type ThemeResponse = { theme: string; ticker_count: number; targets: ThemeRow[] };

type Props = {
  /** "space" | "wh" — must match a key in backend THEMES. */
  theme: string;
  /** Title shown in the header. */
  title: string;
  /** Short caption under the title. */
  caption?: string;
  refreshNonce: number;
  onSelect?: (symbol: string) => void;
};

type SortMode = "status" | "group";

export function ThemeWatch({
  theme,
  title,
  caption,
  refreshNonce,
  onSelect,
}: Props) {
  const { data, isFetching, refetch } = useCachedFetch<ThemeResponse>(
    `theme-watch:${theme}`,
    () => api.get(`/theme-watch/${theme}`),
    { refreshMs: 60_000, staleAfterMs: 30_000 },
  );
  void refreshNonce;
  const [sortMode, setSortMode] = useState<SortMode>("status");

  // Group rows by sub-sector when sortMode === "group"; otherwise flat
  // list sorted by status (in_zone → near → far).
  const grouped = useMemo(() => {
    if (!data) return [];
    if (sortMode === "status") {
      // Backend already returns sorted by status; pass through.
      return [{ name: "All", rows: data.targets }];
    }
    const byGroup = new Map<string, ThemeRow[]>();
    for (const t of data.targets) {
      const k = t.group || "Other";
      const arr = byGroup.get(k) ?? [];
      arr.push(t);
      byGroup.set(k, arr);
    }
    // Sort rows within each group by status, then preserve group insertion order.
    return Array.from(byGroup.entries()).map(([name, rows]) => ({
      name,
      rows: rows.slice().sort((a, b) => statusOrder(a.status) - statusOrder(b.status)),
    }));
  }, [data, sortMode]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-(--color-text-dim)">
          {title}{" "}
          <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)/70">
            {caption ?? "buy signals · sorted by closest to zone"}
          </span>
        </h2>
        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-md border border-(--color-border) bg-(--color-panel-2) p-0.5 text-[10px]">
            {(["status", "group"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setSortMode(m)}
                className={`rounded px-2 py-0.5 capitalize ${
                  sortMode === m
                    ? "bg-(--color-accent) text-white"
                    : "text-(--color-text-dim) hover:text-(--color-text)"
                }`}
              >
                {m === "status" ? "By status" : "By group"}
              </button>
            ))}
          </div>
          <button
            onClick={refetch}
            disabled={isFetching}
            className="text-xs text-(--color-text-dim) hover:text-(--color-text) disabled:opacity-50"
          >
            refresh
          </button>
        </div>
      </div>

      <p className="text-[11px] text-(--color-text-dim)">
        Status: <ZoneDot status="in_zone" /> in zone (buy now) ·{" "}
        <ZoneDot status="near" /> near (within 5%) · <ZoneDot status="far" />{" "}
        far. Score = composite 0–100 buy signal (drawdown + SMA pullback +
        RSI + trend).
      </p>

      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-3">
          {grouped.map((g) => (
            <GroupSection
              key={g.name}
              name={g.name}
              showHeader={sortMode === "group"}
              rows={g.rows}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function GroupSection({
  name,
  showHeader,
  rows,
  onSelect,
}: {
  name: string;
  showHeader: boolean;
  rows: ThemeRow[];
  onSelect?: (symbol: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-(--color-border) bg-(--color-panel)">
      {showHeader && (
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex w-full items-center justify-between gap-2 border-b border-(--color-border) px-3 py-2 text-left"
        >
          <span className="flex items-baseline gap-2">
            <span className="text-(--color-accent)">✦</span>
            <span className="text-sm font-medium">{name}</span>
            <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
              {rows.length}
            </span>
          </span>
          {collapsed ? (
            <ChevronRight size={14} className="text-(--color-text-dim)" />
          ) : (
            <ChevronDown size={14} className="text-(--color-text-dim)" />
          )}
        </button>
      )}
      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-(--color-text-dim)">
              <tr className="border-b border-(--color-border)">
                <th className="px-3 py-1.5 text-left font-normal">Status</th>
                <th className="px-3 py-1.5 text-left font-normal">Symbol</th>
                <th className="px-3 py-1.5 text-right font-normal">Last</th>
                <th className="px-3 py-1.5 text-right font-normal">Off 52w high</th>
                <th className="px-3 py-1.5 text-right font-normal">RSI(14)</th>
                <th className="px-3 py-1.5 text-right font-normal">Score</th>
                <th className="px-3 py-1.5 text-right font-normal">Distance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={t.symbol}
                  onClick={() => onSelect?.(t.symbol)}
                  className={`cursor-pointer border-t border-(--color-border) tabular-nums hover:bg-(--color-panel-2) ${
                    t.status === "in_zone" ? "bg-(--color-up)/5" : ""
                  }`}
                  title="Click to open chart + news"
                >
                  <td className="px-3 py-1.5">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-3 py-1.5 font-medium">{t.symbol}</td>
                  <td className="px-3 py-1.5 text-right">${fmtPrice(t.last)}</td>
                  <td
                    className={`px-3 py-1.5 text-right ${
                      t.off_high_pct == null
                        ? "text-(--color-text-dim)"
                        : t.off_high_pct < -10
                          ? "text-(--color-up)"
                          : ""
                    }`}
                  >
                    {t.off_high_pct == null
                      ? "—"
                      : `${t.off_high_pct.toFixed(1)}%`}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right ${
                      t.rsi14 == null
                        ? "text-(--color-text-dim)"
                        : t.rsi14 < 30
                          ? "text-(--color-up)"
                          : t.rsi14 > 70
                            ? "text-(--color-down)"
                            : ""
                    }`}
                  >
                    {/* OS/OB text marker so the signal reads without color. */}
                    {t.rsi14 == null
                      ? "—"
                      : `${t.rsi14.toFixed(1)}${t.rsi14 < 30 ? " OS" : t.rsi14 > 70 ? " OB" : ""}`}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right ${
                      t.smart_score >= 70
                        ? "text-(--color-up)"
                        : t.smart_score < 40
                          ? "text-(--color-text-dim)"
                          : ""
                    }`}
                  >
                    {t.smart_score.toFixed(0)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[11px] text-(--color-text-dim)">
                    {t.status === "in_zone"
                      ? "—"
                      : t.distance_pct != null
                        ? `${t.distance_pct >= 0 ? "+" : ""}${t.distance_pct.toFixed(1)} pts`
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: BuyWatchStatus }) {
  const map: Record<BuyWatchStatus, { label: string; cls: string }> = {
    in_zone: {
      label: "IN ZONE",
      cls: "bg-(--color-up)/20 text-(--color-up) border-(--color-up)/40",
    },
    near: {
      label: "NEAR",
      cls: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
    },
    far: {
      label: "FAR",
      cls: "bg-(--color-panel-2) text-(--color-text-dim) border-(--color-border)",
    },
    unknown: {
      label: "—",
      cls: "bg-(--color-panel-2) text-(--color-text-dim) border-(--color-border)",
    },
  };
  const m = map[status];
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

function ZoneDot({ status }: { status: BuyWatchStatus }) {
  const cls =
    status === "in_zone"
      ? "bg-(--color-up)"
      : status === "near"
        ? "bg-yellow-500"
        : "bg-(--color-text-dim)/50";
  return (
    <span className={`mx-1 inline-block h-1.5 w-1.5 rounded-full ${cls}`} />
  );
}

function statusOrder(s: BuyWatchStatus): number {
  return s === "in_zone" ? 0 : s === "near" ? 1 : s === "far" ? 2 : 3;
}
