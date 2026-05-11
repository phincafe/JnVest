import { useState } from "react";
import { Pencil, Plus, Target, Trash2, X } from "lucide-react";
import { api, ApiError } from "../api/client";
import type {
  BuyWatchInput,
  BuyWatchResponse,
  BuyWatchRule,
  BuyWatchStatus,
  BuyWatchTarget,
} from "../api/types";
import { useCachedFetch, clearCacheKey } from "../hooks/useCachedFetch";
import { fmtPrice } from "../lib/format";
import { Skeleton } from "./Skeleton";

type Props = {
  refreshNonce: number;
  /** Click a row → open the StockDetail. */
  onSelect?: (symbol: string) => void;
  /** Guests can view but not add/edit/delete (writes are owner-gated). */
  isGuest?: boolean;
};

/** Buy Watch: a curated list of names to accumulate on pullbacks.
 * Each row is colored by status: green = in zone, amber = near, gray = far.
 * Read-only for guests (POST/PUT/DELETE require owner). */
export function BuyWatch({ refreshNonce, onSelect, isGuest = false }: Props) {
  const { data, isFetching, refetch } = useCachedFetch<BuyWatchResponse>(
    "buy-watch",
    () => api.get("/buy-watch"),
    { refreshMs: 60_000, staleAfterMs: 30_000 },
  );
  void refreshNonce;

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BuyWatchTarget | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedErr, setSeedErr] = useState<string | null>(null);

  const reload = async () => {
    clearCacheKey("buy-watch");
    await refetch();
  };

  const seedDefaults = async () => {
    setSeedErr(null);
    setSeeding(true);
    try {
      await api.post("/buy-watch/seed-defaults");
      await reload();
    } catch (e) {
      setSeedErr(e instanceof ApiError ? e.detail : (e as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-(--color-text-dim)">
          Buy Watch{" "}
          <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)/70">
            sorted by closest to zone
          </span>
        </h2>
        <div className="flex items-center gap-2">
          {!isGuest && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 rounded-md border border-(--color-border) px-2 py-1 text-xs text-(--color-text-dim) hover:text-(--color-text)"
            >
              <Plus size={12} /> Add
            </button>
          )}
          <button
            onClick={refetch}
            disabled={isFetching}
            className="text-xs text-(--color-text-dim) hover:text-(--color-text) disabled:opacity-50"
          >
            refresh
          </button>
        </div>
      </div>

      {!data ? (
        <Skeleton className="h-32" />
      ) : data.targets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-(--color-border) bg-(--color-panel) p-6 text-center text-sm text-(--color-text-dim)">
          <Target size={22} className="mx-auto mb-2 opacity-40" />
          {isGuest ? (
            <p>The owner hasn't set any buy targets yet.</p>
          ) : (
            <>
              <p className="mb-3">
                No buy targets yet. Add a ticker manually, or seed the curated
                AI-cycle list (NVDA / MSFT / META / AVGO / MU / CEG / VRT /
                TSM / CRWV / OKLO).
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  onClick={() => setAdding(true)}
                  className="rounded-md border border-(--color-border) bg-(--color-panel-2) px-3 py-1.5 text-xs hover:border-(--color-text-dim)"
                >
                  Add manually
                </button>
                <button
                  onClick={seedDefaults}
                  disabled={seeding}
                  className="rounded-md bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {seeding ? "Seeding…" : "Use suggested defaults"}
                </button>
              </div>
              {seedErr && (
                <div className="mt-3 text-xs text-(--color-down)">{seedErr}</div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-(--color-border) bg-(--color-panel)">
          <table className="w-full text-sm">
            <thead className="text-xs text-(--color-text-dim)">
              <tr className="border-b border-(--color-border)">
                <th className="px-3 py-2 text-left font-normal">Ticker</th>
                <th className="px-3 py-2 text-left font-normal">Status</th>
                <th className="px-3 py-2 text-right font-normal">Last</th>
                <th className="px-3 py-2 text-right font-normal">Trigger</th>
                <th className="px-3 py-2 text-right font-normal">Distance</th>
                <th className="px-3 py-2 text-right font-normal">Off 52W</th>
                <th className="px-3 py-2 text-right font-normal">RSI</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.targets.map((t) => (
                <Row
                  key={t.id}
                  target={t}
                  isGuest={isGuest}
                  onSelect={onSelect}
                  onEdit={() => setEditing(t)}
                  onDelete={async () => {
                    await api.delete(`/buy-watch/${t.id}`);
                    await reload();
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-(--color-text-dim)">
        Status: <ZoneDot status="in_zone" />
        in zone (buy now) · <ZoneDot status="near" />
        within 5% · <ZoneDot status="far" />
        far. Rules are price-based or signal-based (RSI, % off high, below SMA).
      </p>

      {(adding || editing) && (
        <TargetModal
          existing={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setAdding(false);
            setEditing(null);
            await reload();
          }}
        />
      )}
    </section>
  );
}

function Row({
  target,
  isGuest,
  onSelect,
  onEdit,
  onDelete,
}: {
  target: BuyWatchTarget;
  isGuest?: boolean;
  onSelect?: (s: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const dist = target.distance_pct;
  const distLabel = (() => {
    if (dist == null) return "—";
    if (target.rule === "rsi") {
      // RSI distance is in RSI points, not %.
      return dist <= 0 ? `RSI ${Math.abs(dist).toFixed(0)} below` : `+${dist.toFixed(0)} pts`;
    }
    return dist <= 0
      ? `${dist.toFixed(1)}% in zone`
      : `+${dist.toFixed(1)}% to go`;
  })();

  return (
    <tr
      onClick={() => onSelect?.(target.symbol)}
      className={`border-t border-(--color-border) ${
        onSelect ? "cursor-pointer hover:bg-(--color-panel-2)" : ""
      } ${target.status === "in_zone" ? "bg-(--color-up)/10" : ""}`}
    >
      <td className="px-3 py-2 font-medium">
        <div>{target.symbol}</div>
        {target.note && (
          <div className="text-[10px] font-normal text-(--color-text-dim)">
            {target.note}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <StatusBadge status={target.status} />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        ${fmtPrice(target.last)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {target.rule === "rsi" ? (
          <span className="text-(--color-text-dim)">
            RSI ≤ {target.threshold ?? "—"}
          </span>
        ) : target.trigger_price != null ? (
          <>
            ${fmtPrice(target.trigger_price)}
            <span className="ml-1 text-[10px] text-(--color-text-dim)">
              ({ruleLabel(target.rule, target.threshold)})
            </span>
          </>
        ) : (
          "—"
        )}
      </td>
      <td
        className={`px-3 py-2 text-right tabular-nums ${
          target.status === "in_zone"
            ? "text-(--color-up)"
            : target.status === "near"
              ? "text-yellow-400"
              : "text-(--color-text-dim)"
        }`}
      >
        {distLabel}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-(--color-text-dim)">
        {target.off_high_pct == null ? "—" : `${target.off_high_pct.toFixed(1)}%`}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-(--color-text-dim)">
        {target.rsi14 == null ? "—" : target.rsi14.toFixed(0)}
      </td>
      <td className="px-3 py-2 text-right">
        {!isGuest && (
          <div className="inline-flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="text-(--color-text-dim) hover:text-(--color-text)"
              title="Edit"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Remove ${target.symbol} from buy watch?`)) onDelete();
              }}
              className="text-(--color-text-dim) hover:text-(--color-down)"
              title="Remove"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function ruleLabel(rule: BuyWatchRule, threshold: number | null): string {
  if (rule === "price") return "price target";
  if (rule === "off_high") return `${threshold ?? "—"}% off 52w high`;
  if (rule === "below_sma") return `≤ ${threshold ?? "—"}D SMA`;
  return rule;
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

function TargetModal({
  existing,
  onClose,
  onSaved,
}: {
  existing: BuyWatchTarget | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [symbol, setSymbol] = useState(existing?.symbol ?? "");
  const [rule, setRule] = useState<BuyWatchRule>(existing?.rule ?? "price");
  const [targetPrice, setTargetPrice] = useState<string>(
    existing?.target_price?.toString() ?? "",
  );
  const [threshold, setThreshold] = useState<string>(
    existing?.threshold?.toString() ?? defaultThreshold("price"),
  );
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      const payload: BuyWatchInput = {
        symbol: symbol.trim().toUpperCase(),
        rule,
        target_price:
          rule === "price" && targetPrice ? parseFloat(targetPrice) : null,
        threshold:
          rule !== "price" && threshold ? parseFloat(threshold) : null,
        note: note.trim() || null,
      };
      if (existing) {
        await api.put(`/buy-watch/${existing.id}`, payload);
      } else {
        await api.post("/buy-watch", payload);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.detail : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-(--color-border) bg-(--color-panel) p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium">
            {existing ? `Edit ${existing.symbol}` : "Add buy target"}
          </h3>
          <button
            onClick={onClose}
            className="text-(--color-text-dim) hover:text-(--color-text)"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          <Field label="Ticker">
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              disabled={!!existing}
              placeholder="NVDA"
              className="w-full rounded-md border border-(--color-border) bg-(--color-panel-2) px-2 py-1.5 text-sm uppercase placeholder:normal-case placeholder:text-(--color-text-dim)/60 focus:border-(--color-accent) focus:outline-none disabled:opacity-60"
            />
          </Field>
          <Field label="Rule">
            <select
              value={rule}
              onChange={(e) => {
                const r = e.target.value as BuyWatchRule;
                setRule(r);
                setThreshold(defaultThreshold(r));
              }}
              className="w-full rounded-md border border-(--color-border) bg-(--color-panel-2) px-2 py-1.5 text-sm"
            >
              <option value="price">Price target — buy when ≤ $X</option>
              <option value="off_high">% off 52w high</option>
              <option value="below_sma">Below moving average</option>
              <option value="rsi">RSI oversold</option>
            </select>
          </Field>
          {rule === "price" && (
            <Field label="Target price ($)">
              <input
                type="number"
                step="0.01"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                placeholder="180.00"
                className="w-full rounded-md border border-(--color-border) bg-(--color-panel-2) px-2 py-1.5 text-sm"
              />
            </Field>
          )}
          {rule === "off_high" && (
            <Field label="% drawdown from 52w high">
              <input
                type="number"
                step="1"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="15"
                className="w-full rounded-md border border-(--color-border) bg-(--color-panel-2) px-2 py-1.5 text-sm"
              />
            </Field>
          )}
          {rule === "below_sma" && (
            <Field label="Moving average period (20, 50, or 200)">
              <select
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-full rounded-md border border-(--color-border) bg-(--color-panel-2) px-2 py-1.5 text-sm"
              >
                <option value="20">20-day SMA</option>
                <option value="50">50-day SMA</option>
                <option value="200">200-day SMA</option>
              </select>
            </Field>
          )}
          {rule === "rsi" && (
            <Field label="RSI threshold (≤ this = oversold)">
              <input
                type="number"
                step="1"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="35"
                className="w-full rounded-md border border-(--color-border) bg-(--color-panel-2) px-2 py-1.5 text-sm"
              />
            </Field>
          )}
          <Field label="Note (optional)">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Compute layer; LEAPS bucket"
              className="w-full rounded-md border border-(--color-border) bg-(--color-panel-2) px-2 py-1.5 text-sm placeholder:text-(--color-text-dim)/60"
            />
          </Field>
          {err && (
            <div className="rounded-md border border-(--color-down)/40 bg-(--color-down)/10 p-2 text-xs text-(--color-down)">
              {err}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-(--color-text-dim) hover:text-(--color-text)"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy || !symbol.trim()}
              className="rounded-md bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {existing ? "Save" : "Add target"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function defaultThreshold(rule: BuyWatchRule): string {
  if (rule === "off_high") return "15";
  if (rule === "below_sma") return "50";
  if (rule === "rsi") return "35";
  return "";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-(--color-text-dim)">
        {label}
      </span>
      {children}
    </label>
  );
}
