import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../api/client";
import type { AiWatchGroup, AiWatchResponse, AiWatchRow } from "../api/types";
import { useCachedFetch } from "../hooks/useCachedFetch";
import { changeClass, fmtPct, fmtPrice } from "../lib/format";
import { Skeleton } from "./Skeleton";

type Props = {
  refreshNonce: number;
  /** Click ticker → jump to watchlist tab + open StockDetail. */
  onSelect?: (symbol: string) => void;
};

/** Curated AI-theme watchlist by stack layer. Each group can be collapsed.
 * Groups sort by rotation_score (1M − 3M avg) so the layer where money is
 * rotating IN sits at the top. */
export function AiWatch({ refreshNonce, onSelect }: Props) {
  const { data, isFetching, refetch } = useCachedFetch<AiWatchResponse>(
    "market:ai-watch",
    () => api.get("/market/ai-watch"),
    { refreshMs: 5 * 60_000, staleAfterMs: 60_000 },
  );
  void refreshNonce;

  // Group collapse state — Compute open by default (it's where everyone looks first).
  const [open, setOpen] = useState<Record<string, boolean>>({ Compute: true });
  const toggle = (name: string) => setOpen((s) => ({ ...s, [name]: !s[name] }));

  const sortedGroups = useMemo(() => {
    if (!data) return [];
    return [...data.groups].sort(
      (a, b) =>
        (b.rotation_score ?? -1e9) - (a.rotation_score ?? -1e9),
    );
  }, [data]);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-(--color-text-dim)">
          AI Watch{" "}
          <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)/70">
            grouped by stack layer · sorted by 1M − 3M momentum
          </span>
        </h2>
        <button
          onClick={refetch}
          disabled={isFetching}
          className="text-xs text-(--color-text-dim) hover:text-(--color-text) disabled:opacity-50"
        >
          refresh
        </button>
      </div>

      {!data ? (
        <Skeleton className="h-72" />
      ) : (
        <div className="space-y-2">
          {sortedGroups.map((g) => (
            <Group
              key={g.name}
              group={g}
              open={open[g.name] ?? false}
              onToggle={() => toggle(g.name)}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function Group({
  group,
  open,
  onToggle,
  onSelect,
}: {
  group: AiWatchGroup;
  open: boolean;
  onToggle: () => void;
  onSelect?: (symbol: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-(--color-border) bg-(--color-panel)">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-(--color-panel-2)"
      >
        <span className="flex items-center gap-1.5">
          {open ? (
            <ChevronDown size={14} className="text-(--color-text-dim)" />
          ) : (
            <ChevronRight size={14} className="text-(--color-text-dim)" />
          )}
          <span className="text-sm font-medium">{group.name}</span>
          <span className="text-[10px] text-(--color-text-dim)">
            {group.rows.length} names
          </span>
        </span>
        <span className="flex shrink-0 items-baseline gap-3 text-[11px] tabular-nums">
          <Stat label="avg 1D" value={group.avg_1d_pct} />
          <Stat label="avg 1M" value={group.avg_1m_pct} />
          <Stat label="avg 3M" value={group.avg_3m_pct} />
          <RotationStat value={group.rotation_score} />
        </span>
      </button>
      {open && (
        <div className="border-t border-(--color-border) overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-(--color-text-dim)">
              <tr>
                <th className="px-3 py-1.5 text-left font-normal">Symbol</th>
                <th className="px-3 py-1.5 text-right font-normal">Last</th>
                <th className="px-3 py-1.5 text-right font-normal">1D</th>
                <th className="px-3 py-1.5 text-right font-normal">5D</th>
                <th className="px-3 py-1.5 text-right font-normal">1M</th>
                <th className="px-3 py-1.5 text-right font-normal">3M</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((r) => (
                <Row key={r.symbol} row={r} onSelect={onSelect} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({
  row,
  onSelect,
}: {
  row: AiWatchRow;
  onSelect?: (s: string) => void;
}) {
  return (
    <tr
      onClick={() => onSelect?.(row.symbol)}
      className={`border-t border-(--color-border) ${
        onSelect ? "cursor-pointer hover:bg-(--color-panel-2)" : ""
      }`}
    >
      <td className="px-3 py-1.5 font-medium">{row.symbol}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">
        ${fmtPrice(row.last)}
      </td>
      <PctCell value={row.change_1d_pct} />
      <PctCell value={row.change_5d_pct} />
      <PctCell value={row.change_1m_pct} />
      <PctCell value={row.change_3m_pct} />
    </tr>
  );
}

function PctCell({ value }: { value: number | null }) {
  return (
    <td className={`px-3 py-1.5 text-right tabular-nums ${changeClass(value)}`}>
      {value == null ? "—" : fmtPct(value)}
    </td>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="hidden items-baseline gap-1 sm:inline-flex">
      <span className="text-(--color-text-dim)">{label}</span>
      <span className={changeClass(value)}>
        {value == null ? "—" : fmtPct(value)}
      </span>
    </span>
  );
}

function RotationStat({ value }: { value: number | null }) {
  return (
    <span
      className={`inline-flex items-center gap-1 ${changeClass(value)}`}
      title="Rotation score = avg 1M − avg 3M. + = layer accelerating, − = decelerating."
    >
      {value == null ? null : value > 0 ? (
        <ArrowUpRight size={11} />
      ) : value < 0 ? (
        <ArrowDownRight size={11} />
      ) : null}
      <span>
        {value == null
          ? "—"
          : `${value > 0 ? "+" : ""}${value.toFixed(2)}`}
      </span>
    </span>
  );
}
