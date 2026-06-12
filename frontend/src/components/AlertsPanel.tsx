/**
 * Price alerts — owner sets a (symbol, above/below, threshold) tuple; the
 * backend evaluator marks them triggered as quotes cross the line. This
 * panel polls every 30s and fires a browser Notification for any alert
 * whose triggered_at landed since the last poll (and the user has granted
 * Notification permission).
 *
 * Owner-only — the entire panel is hidden for guests.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellRing, Plus, Trash2, X } from "lucide-react";
import { api, ApiError } from "../api/client";
import type {
  PriceAlert,
  PriceAlertInput,
  PriceAlertsResponse,
} from "../api/types";
import { fmtPrice } from "../lib/format";

const POLL_MS = 30_000;

type Props = {
  refreshNonce: number;
};

export function AlertsPanel({ refreshNonce }: Props) {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [lastEvaluated, setLastEvaluated] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  // Track IDs we've already notified for, so we don't re-fire a browser
  // notification for the same alert each tick.
  const notifiedIdsRef = useRef<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const r = await api.get<PriceAlertsResponse>("/alerts");
      setAlerts(r.alerts);
      setLastEvaluated(r.last_evaluated_at ?? null);
      setErr(null);
      // Fire browser Notification for any newly-triggered, undismissed
      // alert we haven't already notified for.
      const perm = typeof Notification !== "undefined" ? Notification.permission : "denied";
      if (perm === "granted") {
        for (const a of r.alerts) {
          if (
            a.triggered_at &&
            !a.dismissed_at &&
            !notifiedIdsRef.current.has(a.id)
          ) {
            notifiedIdsRef.current.add(a.id);
            try {
              new Notification(
                `${a.symbol} ${a.direction} $${fmtPrice(a.threshold)}`,
                {
                  body: `Last price: $${fmtPrice(a.triggered_price ?? 0)}`,
                  tag: `jnv-alert-${a.id}`,
                  icon: "/favicon.svg",
                },
              );
            } catch {
              // SecurityError on insecure origins, etc. — ignore.
            }
          }
        }
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load alerts");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load, refreshNonce]);

  const onAdd = async (payload: PriceAlertInput) => {
    setBusy(true);
    setErr(null);
    try {
      await api.post("/alerts", payload);
      setShowForm(false);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.detail : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: number) => {
    setBusy(true);
    try {
      await api.delete(`/alerts/${id}`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const onDismiss = async (id: number) => {
    setBusy(true);
    try {
      await api.post(`/alerts/${id}/dismiss`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const active = alerts.filter((a) => !a.triggered_at);
  const triggered = alerts.filter((a) => a.triggered_at && !a.dismissed_at);

  const askForPermission = () => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  };

  return (
    <section className="rounded-xl border border-(--color-border) bg-(--color-panel)">
      <header className="flex items-center justify-between border-b border-(--color-border) px-4 py-3">
        <div className="flex items-center gap-2">
          <Bell size={14} className="text-(--color-accent)" />
          <h3 className="text-sm font-semibold">
            Price alerts{" "}
            <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
              {active.length} active · {triggered.length} pending
            </span>
          </h3>
          <EvaluatorStatus lastEvaluated={lastEvaluated} />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              askForPermission();
              setShowForm((v) => !v);
            }}
            className="flex items-center gap-1 rounded-md border border-(--color-border) px-2 py-1 text-xs text-(--color-text-dim) hover:text-(--color-text)"
          >
            <Plus size={12} /> Add
          </button>
        </div>
      </header>

      {err && (
        <div className="border-b border-(--color-down)/30 bg-(--color-down)/5 px-4 py-2 text-xs text-(--color-down)">
          {err}
        </div>
      )}

      {showForm && (
        <AddAlertForm
          onCancel={() => setShowForm(false)}
          onSubmit={onAdd}
          busy={busy}
        />
      )}

      {triggered.length > 0 && (
        <div className="space-y-1 border-b border-(--color-border) p-3">
          <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-(--color-up)">
            <BellRing size={11} /> Triggered
          </div>
          {triggered.map((a) => (
            <AlertRow
              key={a.id}
              alert={a}
              triggered
              busy={busy}
              onDelete={() => onDelete(a.id)}
              onDismiss={() => onDismiss(a.id)}
            />
          ))}
        </div>
      )}

      <div className="p-3">
        {active.length === 0 ? (
          <p className="py-4 text-center text-sm text-(--color-text-dim)">
            No active alerts. Click <span className="text-(--color-text)">Add</span>{" "}
            to set one — e.g. "SPY above 450" — and you'll get a browser
            notification when it triggers.
          </p>
        ) : (
          <div className="space-y-1">
            {active.map((a) => (
              <AlertRow
                key={a.id}
                alert={a}
                busy={busy}
                onDelete={() => onDelete(a.id)}
              />
            ))}
          </div>
        )}
      </div>

      {typeof Notification !== "undefined" &&
        Notification.permission === "denied" && (
          <p className="border-t border-(--color-border) bg-(--color-panel-2) px-4 py-2 text-[11px] text-(--color-text-dim)">
            Browser notifications are blocked — you'll still see triggered
            alerts in this panel, but no push pops up. Re-enable in your
            browser site settings.
          </p>
        )}
    </section>
  );
}

function AlertRow({
  alert,
  triggered = false,
  busy,
  onDelete,
  onDismiss,
}: {
  alert: PriceAlert;
  triggered?: boolean;
  busy: boolean;
  onDelete: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs ${
        triggered
          ? "bg-(--color-up)/10"
          : "hover:bg-(--color-panel-2)"
      }`}
    >
      <div className="flex min-w-0 items-baseline gap-2 tabular-nums">
        <span className="font-medium">{alert.symbol}</span>
        <span className="text-(--color-text-dim)">{alert.direction}</span>
        <span>${fmtPrice(alert.threshold)}</span>
        {triggered && alert.triggered_price != null && (
          <span className="text-[10px] text-(--color-up)">
            → hit at ${fmtPrice(alert.triggered_price)}
          </span>
        )}
        {alert.note && (
          <span className="truncate text-[10px] text-(--color-text-dim)">
            {alert.note}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {triggered && onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="rounded p-1 text-(--color-text-dim) hover:text-(--color-text)"
            title="Dismiss"
          >
            <X size={12} />
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="rounded p-1 text-(--color-text-dim) hover:text-(--color-down)"
          title="Delete"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function AddAlertForm({
  onCancel,
  onSubmit,
  busy,
}: {
  onCancel: () => void;
  onSubmit: (p: PriceAlertInput) => void;
  busy: boolean;
}) {
  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [threshold, setThreshold] = useState("");
  const [note, setNote] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = symbol.trim().toUpperCase();
    const t = parseFloat(threshold);
    if (!sym || !Number.isFinite(t) || t <= 0) return;
    onSubmit({
      symbol: sym,
      direction,
      threshold: t,
      note: note.trim() || null,
    });
  };
  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-1 gap-2 border-b border-(--color-border) bg-(--color-panel-2) p-3 sm:grid-cols-[1.2fr_1fr_1fr_2fr_auto]"
    >
      <input
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        placeholder="Symbol (SPY, AAPL…)"
        className="rounded-md border border-(--color-border) bg-(--color-panel) px-2 py-1.5 text-xs uppercase focus:border-(--color-accent) focus:outline-none"
      />
      <select
        value={direction}
        onChange={(e) => setDirection(e.target.value as "above" | "below")}
        className="rounded-md border border-(--color-border) bg-(--color-panel) px-2 py-1.5 text-xs focus:border-(--color-accent) focus:outline-none"
      >
        <option value="above">above</option>
        <option value="below">below</option>
      </select>
      <input
        type="number"
        step="0.01"
        inputMode="decimal"
        value={threshold}
        onChange={(e) => setThreshold(e.target.value)}
        placeholder="Price"
        className="rounded-md border border-(--color-border) bg-(--color-panel) px-2 py-1.5 text-xs tabular-nums focus:border-(--color-accent) focus:outline-none"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        maxLength={140}
        className="rounded-md border border-(--color-border) bg-(--color-panel) px-2 py-1.5 text-xs focus:border-(--color-accent) focus:outline-none"
      />
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-(--color-border) px-2 py-1.5 text-xs text-(--color-text-dim) hover:text-(--color-text)"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </form>
  );
}

/** Shows when the backend evaluator last completed a tick. On Render's free
 * tier the instance sleeps after ~15 min idle and alerts silently stop
 * evaluating — this makes that visible (yellow warning past 5 minutes). */
function EvaluatorStatus({ lastEvaluated }: { lastEvaluated: string | null }) {
  if (!lastEvaluated) {
    return (
      <span
        className="rounded bg-(--color-panel-2) px-1.5 py-0.5 text-[10px] text-(--color-text-dim)"
        title="The evaluator hasn't completed a tick since the server started."
      >
        evaluator starting…
      </span>
    );
  }
  const ageMin = Math.floor((Date.now() - new Date(lastEvaluated).getTime()) / 60_000);
  const stalled = ageMin >= 5;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] ${
        stalled
          ? "bg-yellow-500/20 text-yellow-200"
          : "bg-(--color-panel-2) text-(--color-text-dim)"
      }`}
      title={
        stalled
          ? "Evaluation may be paused — Render free tier sleeps after 15 min idle. A ping service (e.g. UptimeRobot on /api/health) keeps it awake."
          : "Background evaluator is running (checks every 60s during the session)."
      }
    >
      {stalled
        ? `⚠ checked ${ageMin}m ago`
        : `checked ${ageMin < 1 ? "<1" : ageMin}m ago`}
    </span>
  );
}
