/**
 * Custom option P/L calculator entry point — lets guests (and the owner)
 * build a synthetic option contract and see its projected P/L via the same
 * OptionPnLModal that wraps owned positions. Modeled after the workflow on
 * optionsprofitcalculator.com.
 *
 * The synthetic option fakes a SnapTradeOption shape; the modal's existing
 * "public view" fallback (synthetic qty=1 @ chain mark) handles the case
 * where avg_cost is left blank.
 */
import { useEffect, useState } from "react";
import { Calculator, ChevronDown, ChevronUp, Search } from "lucide-react";
import { api } from "../api/client";
import type { ExpirationsResponse, SnapTradeOption } from "../api/types";
import { useTickerSearch } from "../hooks/useTickerSearch";
import { OptionPnLModal } from "./OptionPnLModal";

type FormState = {
  underlying: string;
  optionType: "call" | "put";
  strike: string;
  expiration: string;
  quantity: string;
  avgCost: string;
};

const EMPTY: FormState = {
  underlying: "",
  optionType: "call",
  strike: "",
  expiration: "",
  quantity: "1",
  avgCost: "",
};

export function CustomOptionPanel({ isGuest = false }: { isGuest?: boolean }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [selected, setSelected] = useState<SnapTradeOption | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Available expirations for the current underlying, fetched from
  // /api/options/{symbol}/expirations. Drives the expiration <select>.
  const [expirations, setExpirations] = useState<string[]>([]);
  const [expsLoading, setExpsLoading] = useState(false);

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  // Whenever the underlying changes, refetch the expirations list. Debounce
  // a bit so we don't slam the API while the user is typing.
  useEffect(() => {
    const sym = form.underlying.trim().toUpperCase();
    if (!sym) {
      setExpirations([]);
      return;
    }
    let cancelled = false;
    setExpsLoading(true);
    const id = setTimeout(() => {
      api
        .get<ExpirationsResponse>(`/options/${sym}/expirations`)
        .then((r) => {
          if (cancelled) return;
          setExpirations(r.expirations ?? []);
          // If the currently-selected expiration is no longer valid for
          // this underlying, clear it so the user picks a fresh one.
          if (form.expiration && !(r.expirations ?? []).includes(form.expiration)) {
            setField("expiration", "");
          }
        })
        .catch(() => {
          if (cancelled) return;
          setExpirations([]);
        })
        .finally(() => {
          if (!cancelled) setExpsLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.underlying]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const underlying = form.underlying.trim().toUpperCase();
    const strike = parseFloat(form.strike);
    const qty = parseInt(form.quantity, 10);
    const avgCost = form.avgCost.trim() === "" ? null : parseFloat(form.avgCost);
    if (!underlying) return setErr("Underlying is required");
    if (!form.expiration) return setErr("Expiration is required");
    if (!Number.isFinite(strike) || strike <= 0) return setErr("Strike must be positive");
    if (!Number.isFinite(qty) || qty === 0) return setErr("Quantity must be non-zero");
    if (avgCost != null && (!Number.isFinite(avgCost) || avgCost < 0))
      return setErr("Avg cost must be ≥ 0 (or blank to use chain mark)");
    const synthetic: SnapTradeOption = {
      account_id: "synthetic",
      account: "Custom calculator",
      broker: "—",
      underlying,
      ticker: null,
      option_type: form.optionType,
      strike,
      expiration: form.expiration,
      quantity: qty,
      // Leave at 0 so the modal pulls the actual current mark from the chain
      // (matchedRow.bid/ask) instead of mistaking the avg_cost for the mark.
      price: 0,
      avg_cost: avgCost,
      market_value: avgCost != null ? avgCost * 100 * qty : 0,
      unrealized_pl: null,
      unrealized_pl_pct: null,
    };
    setSelected(synthetic);
  };

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel)">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Calculator size={16} className="text-(--color-accent)" />
          <div>
            <div className="text-sm font-semibold">Option P/L calculator</div>
            <div className="text-[11px] text-(--color-text-dim)">
              Build any option contract — see chart, heatmap, IV scenarios.
              {isGuest && " No account needed."}
            </div>
          </div>
        </div>
        {open ? (
          <ChevronUp size={16} className="text-(--color-text-dim)" />
        ) : (
          <ChevronDown size={16} className="text-(--color-text-dim)" />
        )}
      </button>

      {open && (
        <form
          onSubmit={onSubmit}
          className="grid grid-cols-1 gap-3 border-t border-(--color-border) p-4 sm:grid-cols-2 lg:grid-cols-6"
        >
          <UnderlyingField
            value={form.underlying}
            onChange={(v) => setField("underlying", v)}
          />
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
              Type
            </label>
            <div className="inline-flex rounded-md border border-(--color-border) bg-(--color-panel-2) p-0.5">
              {(["call", "put"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setField("optionType", t)}
                  className={`flex-1 rounded px-2 py-1.5 text-xs capitalize ${
                    form.optionType === t
                      ? "bg-(--color-accent) text-white"
                      : "text-(--color-text-dim) hover:text-(--color-text)"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <NumberField
            label="Strike"
            placeholder="200"
            value={form.strike}
            step="0.5"
            onChange={(v) => setField("strike", v)}
          />
          <ExpirationField
            value={form.expiration}
            options={expirations}
            loading={expsLoading}
            disabled={!form.underlying.trim()}
            onChange={(v) => setField("expiration", v)}
          />
          <NumberField
            label="Qty (signed)"
            placeholder="1"
            value={form.quantity}
            step="1"
            help="Positive = long, negative = short"
            onChange={(v) => setField("quantity", v)}
          />
          <NumberField
            label="Avg cost (opt)"
            placeholder="blank = chain mark"
            value={form.avgCost}
            step="0.05"
            onChange={(v) => setField("avgCost", v)}
          />

          {err && (
            <div className="rounded-md border border-(--color-down)/50 bg-(--color-down)/10 px-3 py-2 text-xs text-(--color-down) sm:col-span-2 lg:col-span-6">
              {err}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 sm:col-span-2 lg:col-span-6">
            <button
              type="button"
              onClick={() => {
                setForm(EMPTY);
                setErr(null);
              }}
              className="rounded-md border border-(--color-border) px-3 py-1.5 text-xs text-(--color-text-dim) hover:text-(--color-text)"
            >
              Clear
            </button>
            <button
              type="submit"
              className="rounded-md bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white"
            >
              Calculate P/L
            </button>
          </div>
        </form>
      )}

      <OptionPnLModal
        option={selected}
        onClose={() => setSelected(null)}
        isGuest={isGuest}
      />
    </div>
  );
}

function UnderlyingField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const results = useTickerSearch(value);
  return (
    <div className="relative flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
        Underlying
      </label>
      <div className="flex items-center gap-2 rounded-md border border-(--color-border) bg-(--color-panel-2) px-2 py-1.5 focus-within:border-(--color-accent)">
        <Search size={13} className="shrink-0 text-(--color-text-dim)" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="AAPL"
          className="w-full bg-transparent text-sm uppercase placeholder:normal-case placeholder:text-(--color-text-dim)/60 focus:outline-none"
        />
      </div>
      {focused && value.trim() && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-auto rounded-md border border-(--color-border) bg-(--color-panel-2) text-xs shadow-lg">
          {results.slice(0, 8).map((r) => (
            <li key={r.symbol}>
              <button
                type="button"
                onClick={() => onChange(r.symbol)}
                className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left hover:bg-(--color-panel)"
              >
                <span className="font-medium">{r.symbol}</span>
                {r.description && (
                  <span className="truncate text-[10px] text-(--color-text-dim)">
                    {r.description}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  placeholder,
  step = "1",
  help,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  step?: string;
  help?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        className="text-[10px] uppercase tracking-wide text-(--color-text-dim)"
        title={help}
      >
        {label}
      </label>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-(--color-border) bg-(--color-panel-2) px-2 py-1.5 text-sm tabular-nums focus:border-(--color-accent) focus:outline-none"
      />
    </div>
  );
}

function ExpirationField({
  value,
  options,
  loading,
  disabled,
  onChange,
}: {
  value: string;
  options: string[];
  loading: boolean;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const placeholder = disabled
    ? "Pick a ticker first"
    : loading
      ? "Loading expirations…"
      : options.length === 0
        ? "No expirations available"
        : "Pick an expiration";
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
        Expiration
      </label>
      <select
        value={value}
        disabled={disabled || loading || options.length === 0}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-(--color-border) bg-(--color-panel-2) px-2 py-1.5 text-sm tabular-nums focus:border-(--color-accent) focus:outline-none disabled:opacity-60"
      >
        <option value="">{placeholder}</option>
        {options.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </div>
  );
}


