/** "ER 3d" chip for positions whose underlying reports earnings soon.
 * Red below 3 days (IV crush imminent for option holders), purple otherwise.
 * Renders nothing when no report is within the backend's 14-day window. */
export function ErBadge({ days }: { days: number | null | undefined }) {
  if (days == null) return null;
  const urgent = days <= 2;
  return (
    <span
      className={`ml-1.5 rounded px-1 py-0.5 text-[9px] font-medium uppercase ${
        urgent ? "bg-(--color-down)/25 text-(--color-down)" : "bg-purple-500/30 text-purple-200"
      }`}
      title={`Earnings in ${days} day${days === 1 ? "" : "s"} — expect elevated IV into the print and a crush after`}
    >
      ER {days}d
    </span>
  );
}
