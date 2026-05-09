import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { api } from "../api/client";
import type { SectorRotationResponse } from "../api/types";
import { useCachedFetch } from "../hooks/useCachedFetch";
import { changeClass, fmtPct } from "../lib/format";
import { Skeleton } from "./Skeleton";

/** Relative-strength rotation across S&P sectors. The *spread* between the
 * top sector and the bottom is the rotation signal; the rotation_score
 * (1M − 3M) flags sectors whose recent strength is improving (money in)
 * or fading (money out). Price-derived — no real fund-flow data. */
export function SectorRotation({ refreshNonce }: { refreshNonce: number }) {
  const { data, isFetching, refetch } = useCachedFetch<SectorRotationResponse>(
    "market:sector-rotation",
    () => api.get("/market/sector-rotation"),
    { refreshMs: 5 * 60_000, staleAfterMs: 60_000 },
  );
  void refreshNonce;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-(--color-text-dim)">
          Sector Rotation{" "}
          <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)/70">
            sorted by 1M − 3M momentum
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
        <Skeleton className="h-64" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-(--color-border) bg-(--color-panel)">
          <table className="w-full text-sm">
            <thead className="text-xs text-(--color-text-dim)">
              <tr className="border-b border-(--color-border)">
                <th className="px-3 py-2 text-left font-normal">Sector</th>
                <th className="px-3 py-2 text-right font-normal">1D</th>
                <th className="px-3 py-2 text-right font-normal">5D</th>
                <th className="px-3 py-2 text-right font-normal">1M</th>
                <th className="px-3 py-2 text-right font-normal">3M</th>
                <th
                  className="px-3 py-2 text-right font-normal"
                  title="1M change minus 3M change. + means recent strength > longer-term: money rotating IN. − means cooling off: rotating OUT."
                >
                  Rotation
                </th>
              </tr>
            </thead>
            <tbody>
              {data.sectors.map((s) => (
                <tr
                  key={s.symbol}
                  className="border-t border-(--color-border) hover:bg-(--color-panel-2)"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-[10px] text-(--color-text-dim)">{s.symbol}</div>
                  </td>
                  <PctCell value={s.change_1d_pct} />
                  <PctCell value={s.change_5d_pct} />
                  <PctCell value={s.change_1m_pct} />
                  <PctCell value={s.change_3m_pct} />
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${changeClass(s.rotation_score)}`}
                  >
                    {s.rotation_score == null ? (
                      "—"
                    ) : (
                      <span className="inline-flex items-center justify-end gap-1">
                        {s.rotation_score > 0 ? (
                          <ArrowUpRight size={12} />
                        ) : s.rotation_score < 0 ? (
                          <ArrowDownRight size={12} />
                        ) : null}
                        {s.rotation_score > 0 ? "+" : ""}
                        {s.rotation_score.toFixed(2)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-(--color-text-dim)">
        Price-derived rotation, not actual fund flows. Free APIs don't expose
        ETF creations/redemptions in $.
      </p>
    </section>
  );
}

function PctCell({ value }: { value: number | null }) {
  return (
    <td className={`px-3 py-2 text-right tabular-nums ${changeClass(value)}`}>
      {value == null ? "—" : fmtPct(value)}
    </td>
  );
}
