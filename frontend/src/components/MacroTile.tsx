import { Line, LineChart, ResponsiveContainer } from "recharts";
import type { MacroEntry } from "../api/types";
import { changeClass, fmtPct, fmtPrice } from "../lib/format";

const LABELS: Record<string, string> = {
  VIXY: "Vol (VIXY)",
  UUP: "USD Index (UUP)",
};

type Props = { name: string; tile: MacroEntry };

export function MacroTile({ name, tile }: Props) {
  const data = tile.spark.map((y, x) => ({ x, y }));
  return (
    <div className="rounded-lg border border-(--color-border) bg-(--color-panel) p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
          {LABELS[name] ?? name}
        </span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div>
          <div className="text-lg font-semibold tabular-nums leading-tight">
            {fmtPrice(tile.last)}
          </div>
          <div className={`text-[11px] tabular-nums ${changeClass(tile.change_pct)}`}>
            {fmtPct(tile.change_pct)}
          </div>
        </div>
        <div className="h-7 w-20">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <Line
                dataKey="y"
                stroke={tile.change_pct >= 0 ? "#16a34a" : "#dc2626"}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
