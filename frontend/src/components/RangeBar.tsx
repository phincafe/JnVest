type Props = {
  low: number;
  high: number;
  value: number;
};

export function RangeBar({ low, high, value }: Props) {
  if (high <= low) return null;
  const pct = Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
  return (
    <div className="w-24">
      <div className="relative h-1.5 rounded-full bg-(--color-panel-2)">
        <div
          className="absolute -top-0.5 h-2.5 w-0.5 rounded bg-(--color-text)"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-(--color-text-dim) tabular-nums">
        <span>{low.toFixed(0)}</span>
        <span>{high.toFixed(0)}</span>
      </div>
    </div>
  );
}
