import { Calendar } from "../components/Calendar";

export default function CalendarTab({ refreshNonce }: { refreshNonce: number }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-4">
      <Calendar refreshNonce={refreshNonce} />
    </div>
  );
}
