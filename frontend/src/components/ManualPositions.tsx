import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Trash2, Upload } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { ManualPosition } from "../api/types";
import { changeClass, fmtPct, fmtPrice } from "../lib/format";
import { Skeleton } from "./Skeleton";

const REFRESH_MS = 60_000;
const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

/**
 * Manually-tracked positions for things SnapTrade can't reach (e.g.,
 * 401k holdings, crypto, employer stock plans, private investments).
 */
export function ManualPositions({ refreshNonce }: { refreshNonce: number }) {
  const [rows, setRows] = useState<ManualPosition[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<ManualPosition[]>("/positions/manual");
      setRows(data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.detail : (e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load, refreshNonce]);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-(--color-text-dim)">
        Manual positions
        <span className="ml-2 text-xs font-normal text-(--color-text-dim)/70">
          for holdings outside SnapTrade (401k, crypto, ESPP, private…)
        </span>
      </h2>
      {err && (
        <div className="rounded-md border border-(--color-down)/40 bg-(--color-panel) p-2 text-xs text-(--color-down)">
          {err}
        </div>
      )}
      <ManualPositionsCard rows={rows} onChange={load} />
    </section>
  );
}

function ManualPositionsCard({
  rows,
  onChange,
}: {
  rows: ManualPosition[] | null;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);

  const [symbol, setSymbol] = useState("");
  const [type, setType] = useState<"stock" | "call" | "put">("stock");
  const [entry, setEntry] = useState("");
  const [qty, setQty] = useState("");
  const [strike, setStrike] = useState("");
  const [exp, setExp] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/positions/manual", {
        symbol: symbol.trim().toUpperCase(),
        position_type: type,
        entry_price: Number(entry),
        quantity: Number(qty),
        strike: strike ? Number(strike) : null,
        expiration: exp || null,
        notes: notes || null,
      });
      setSymbol("");
      setEntry("");
      setQty("");
      setStrike("");
      setExp("");
      setNotes("");
      setOpen(false);
      onChange();
    } catch (e) {
      setErr(e instanceof ApiError ? e.detail : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    try {
      await api.delete(`/positions/manual/${id}`);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = (mode: "replace" | "append") => {
    const input = fileInputRef.current;
    if (!input) return;
    input.dataset.mode = mode;
    input.click();
  };

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const mode = (e.target.dataset.mode as "replace" | "append") ?? "replace";
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    setImportErr(null);
    setImportStatus(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", mode);
      const res = await fetch(`${API_BASE}/positions/manual/import`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(body.detail ?? `${res.status}`);
      }
      const data = (await res.json()) as {
        imported: number;
        skipped: { line: string; reason: string }[];
        mode: string;
      };
      const skipNote = data.skipped.length
        ? ` · skipped ${data.skipped.length}`
        : "";
      setImportStatus(
        `Imported ${data.imported} (${data.mode})${skipNote}`,
      );
      onChange();
    } catch (e) {
      setImportErr((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <div className="mb-3 flex items-center justify-end gap-1">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onFileSelected}
          className="hidden"
        />
        <button
          onClick={() => onPickFile("replace")}
          disabled={importing}
          title="Wipe table and import from CSV"
          className="flex items-center gap-1 rounded-md border border-(--color-border) px-2 py-1 text-xs hover:bg-(--color-panel-2) disabled:opacity-50"
        >
          <Upload size={12} /> Import CSV
        </button>
        <button
          onClick={() => onPickFile("append")}
          disabled={importing}
          title="Add CSV rows to existing"
          className="rounded-md border border-(--color-border) px-2 py-1 text-xs hover:bg-(--color-panel-2) disabled:opacity-50"
        >
          +CSV
        </button>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-md border border-(--color-border) px-2 py-1 text-xs hover:bg-(--color-panel-2)"
        >
          {open ? "Cancel" : "+ Add"}
        </button>
      </div>

      {importStatus && (
        <div className="mb-2 rounded-md border border-(--color-up)/40 bg-(--color-panel-2) p-2 text-xs text-(--color-up)">
          {importStatus}
        </div>
      )}
      {importErr && (
        <div className="mb-2 rounded-md border border-(--color-down)/40 bg-(--color-panel-2) p-2 text-xs text-(--color-down)">
          {importErr}
        </div>
      )}

      {open && (
        <form onSubmit={submit} className="mb-3 grid grid-cols-2 gap-2 text-xs">
          <input
            placeholder="Symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            required
            className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1 uppercase"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "stock" | "call" | "put")}
            className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1"
          >
            <option value="stock">Stock</option>
            <option value="call">Call</option>
            <option value="put">Put</option>
          </select>
          <input
            type="number"
            step="0.01"
            placeholder="Entry price"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            required
            className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1"
          />
          <input
            type="number"
            step="any"
            placeholder="Quantity"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            required
            className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1"
          />
          {type !== "stock" && (
            <>
              <input
                type="number"
                step="0.01"
                placeholder="Strike"
                value={strike}
                onChange={(e) => setStrike(e.target.value)}
                className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1"
              />
              <input
                type="date"
                value={exp}
                onChange={(e) => setExp(e.target.value)}
                className="rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1"
              />
            </>
          )}
          <input
            placeholder="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="col-span-2 rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1"
          />
          {err && <div className="col-span-2 text-(--color-down)">{err}</div>}
          <button
            type="submit"
            disabled={busy}
            className="col-span-2 rounded-md bg-(--color-accent) px-2 py-1 font-medium text-white disabled:opacity-50"
          >
            Add position
          </button>
        </form>
      )}

      {!rows ? (
        <Skeleton className="h-16 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-(--color-text-dim)">
          No manual positions tracked. Use Import CSV or "+ Add" to add holdings
          for accounts SnapTrade can't reach (401k, crypto, ESPP, private investments).
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-(--color-text-dim)">
            <tr>
              <th className="text-left font-normal">Symbol</th>
              <th className="text-left font-normal">Type</th>
              <th className="text-right font-normal">Qty</th>
              <th className="text-right font-normal">Entry</th>
              <th className="text-right font-normal">Last</th>
              <th className="text-right font-normal">P&L</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-t border-(--color-border)">
                <td className="py-1 font-medium">
                  {m.symbol}
                  {m.position_type !== "stock" && m.strike && (
                    <span className="ml-1 text-[10px] text-(--color-text-dim)">
                      {m.strike}
                      {m.position_type[0].toUpperCase()} {m.expiration}
                    </span>
                  )}
                </td>
                <td className="py-1 capitalize">{m.position_type}</td>
                <td className="py-1 text-right tabular-nums">{m.quantity}</td>
                <td className="py-1 text-right tabular-nums">
                  ${fmtPrice(m.entry_price)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {m.last_price != null ? `$${fmtPrice(m.last_price)}` : "—"}
                </td>
                <td className={`py-1 text-right tabular-nums ${changeClass(m.pl)}`}>
                  {m.pl != null
                    ? `${m.pl >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(m.pl))}`
                    : "—"}
                  {m.pl_pct != null && (
                    <div className="text-[10px]">{fmtPct(m.pl_pct)}</div>
                  )}
                </td>
                <td className="py-1 text-right">
                  <button
                    onClick={() => remove(m.id)}
                    disabled={busy}
                    className="text-(--color-text-dim) hover:text-(--color-down)"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
