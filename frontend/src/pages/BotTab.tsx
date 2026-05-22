/**
 * SPY 0-DTE RSI-divergence bot dashboard.
 *
 * Owner-only. The bot itself runs on the backend (a background asyncio loop);
 * this page is read + a kill-switch. It polls /api/bot/status every 15s so
 * the state stays fresh, and refreshes signals/trades on the same beat.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FlaskConical, Pause, Play, RefreshCcw } from "lucide-react";
import { api, ApiError } from "../api/client";
import type {
  BotBacktestResponse,
  BotSignalRow,
  BotStatus,
  BotTradeRow,
} from "../api/types";
import { Skeleton } from "../components/Skeleton";
import { changeClass, fmtPrice } from "../lib/format";

const POLL_MS = 15_000;

export default function BotTab({ refreshNonce }: { refreshNonce: number }) {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [signals, setSignals] = useState<BotSignalRow[]>([]);
  const [trades, setTrades] = useState<BotTradeRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, sigs, tr] = await Promise.all([
        api.get<BotStatus>("/bot/status"),
        api.get<BotSignalRow[]>("/bot/signals?limit=50"),
        api.get<BotTradeRow[]>("/bot/trades?limit=50"),
      ]);
      setStatus(s);
      setSignals(sigs);
      setTrades(tr);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load, refreshNonce]);

  const onStart = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post("/bot/start");
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Start failed");
    } finally {
      setBusy(false);
    }
  };

  const onStop = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post("/bot/stop");
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Stop failed");
    } finally {
      setBusy(false);
    }
  };

  if (status == null) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-4">
      <StatusCard
        status={status}
        busy={busy}
        onStart={onStart}
        onStop={onStop}
        onRefresh={load}
      />

      {err && (
        <div className="rounded-md border border-(--color-down)/50 bg-(--color-down)/10 px-3 py-2 text-sm text-(--color-down)">
          {err}
        </div>
      )}

      {status.daily_loss_cap_hit && (
        <div className="flex items-start gap-2 rounded-md border border-(--color-down)/50 bg-(--color-down)/10 px-3 py-2 text-sm text-(--color-down)">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Daily loss cap hit</div>
            <div className="text-(--color-text-dim)">
              The bot is down ≥5% of equity today. New entries are blocked until
              tomorrow; existing positions are still being monitored to exit.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TradesPanel trades={trades} />
        <SignalsPanel signals={signals} />
      </div>

      <BacktestPanel />

      <p className="text-[11px] text-(--color-text-dim)">
        Strategy: RSI(14) divergence on SPY 5-minute bars → buy 0-DTE ATM call
        (bullish div) or put (bearish div). Exit at +20% / −20% / 15:30 ET.
        Sizing −2% of equity per trade, capped at 20 contracts. Paper trading
        only.
      </p>
    </div>
  );
}

function StatusCard({
  status,
  busy,
  onStart,
  onStop,
  onRefresh,
}: {
  status: BotStatus;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onRefresh: () => void;
}) {
  const lastTickRel = status.last_tick
    ? formatRelative(new Date(status.last_tick))
    : "never";
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">SPY divergence bot</h2>
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                status.running
                  ? "bg-(--color-up)/20 text-(--color-up)"
                  : "bg-(--color-text-dim)/20 text-(--color-text-dim)"
              }`}
            >
              {status.running ? "Running" : "Stopped"}
            </span>
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                status.is_paper
                  ? "bg-(--color-accent)/20 text-(--color-accent)"
                  : "bg-(--color-down)/20 text-(--color-down)"
              }`}
            >
              {status.is_paper ? "Paper" : "Live ⚠"}
            </span>
          </div>
          <p className="mt-1 text-xs text-(--color-text-dim)">
            Last tick {lastTickRel} · {status.day_date ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            className="flex items-center gap-1 rounded-md border border-(--color-border) px-2 py-1.5 text-xs text-(--color-text-dim) hover:text-(--color-text)"
            aria-label="Refresh"
          >
            <RefreshCcw size={12} />
          </button>
          {status.running ? (
            <button
              type="button"
              onClick={onStop}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md bg-(--color-down) px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              <Pause size={13} />
              Stop bot
            </button>
          ) : (
            <button
              type="button"
              onClick={onStart}
              disabled={busy || !status.is_paper}
              title={
                !status.is_paper
                  ? "Bot refuses to start unless ALPACA_BASE_URL is the paper host"
                  : undefined
              }
              className="flex items-center gap-1.5 rounded-md bg-(--color-up) px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              <Play size={13} />
              Start bot
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label="Today's P/L"
          value={`${status.day_pnl >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(status.day_pnl))}`}
          tone={status.day_pnl >= 0 ? "up" : "down"}
        />
        <Stat
          label="Open position"
          value={status.open_position_exists ? "Yes" : "No"}
          tone={status.open_position_exists ? "accent" : "dim"}
        />
        <Stat
          label="Loss-cap hit"
          value={status.daily_loss_cap_hit ? "Yes" : "No"}
          tone={status.daily_loss_cap_hit ? "down" : "dim"}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "up" | "down" | "accent" | "dim";
}) {
  const toneClass =
    tone === "up"
      ? "text-(--color-up)"
      : tone === "down"
        ? "text-(--color-down)"
        : tone === "accent"
          ? "text-(--color-accent)"
          : tone === "dim"
            ? "text-(--color-text-dim)"
            : "";
  return (
    <div className="rounded-md border border-(--color-border) bg-(--color-panel-2) px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
        {label}
      </div>
      <div className={`text-sm tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function TradesPanel({ trades }: { trades: BotTradeRow[] }) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-3 text-sm font-medium">Trades ({trades.length})</h3>
      {trades.length === 0 ? (
        <p className="py-8 text-center text-sm text-(--color-text-dim)">
          No trades yet. Bot is opt-in; click Start to begin scanning.
        </p>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-(--color-text-dim)">
              <tr>
                <th className="text-left font-normal">Entry</th>
                <th className="text-left font-normal">Side</th>
                <th className="text-right font-normal">Qty</th>
                <th className="text-right font-normal">Entry $</th>
                <th className="text-right font-normal">Exit</th>
                <th className="text-right font-normal">P/L</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr
                  key={t.id}
                  className="border-t border-(--color-border) tabular-nums"
                >
                  <td className="py-1.5">{fmtTime(t.entry_at)}</td>
                  <td className="py-1.5 capitalize">{t.side}</td>
                  <td className="py-1.5 text-right">{t.qty}</td>
                  <td className="py-1.5 text-right">
                    ${fmtPrice(t.entry_price)}
                  </td>
                  <td className="py-1.5 text-right">
                    {t.exit_at ? (
                      <span>
                        ${t.exit_price != null ? fmtPrice(t.exit_price) : "—"}
                        <span className="ml-1 text-[10px] text-(--color-text-dim)">
                          ({t.exit_reason})
                        </span>
                      </span>
                    ) : (
                      <span className="text-(--color-accent)">Open</span>
                    )}
                  </td>
                  <td
                    className={`py-1.5 text-right ${changeClass(t.realized_pnl)}`}
                  >
                    {t.realized_pnl == null
                      ? "—"
                      : `${t.realized_pnl >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(t.realized_pnl))}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SignalsPanel({ signals }: { signals: BotSignalRow[] }) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-3 text-sm font-medium">Signals ({signals.length})</h3>
      {signals.length === 0 ? (
        <p className="py-8 text-center text-sm text-(--color-text-dim)">
          No signals yet. Signals are logged whether or not they were traded.
        </p>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-(--color-text-dim)">
              <tr>
                <th className="text-left font-normal">Time</th>
                <th className="text-left font-normal">Side</th>
                <th className="text-right font-normal">Spot</th>
                <th className="text-right font-normal">Prior → Curr RSI</th>
                <th className="text-left font-normal">Result</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-(--color-border) tabular-nums"
                >
                  <td className="py-1.5">{fmtTime(s.detected_at)}</td>
                  <td className="py-1.5 capitalize">{s.side}</td>
                  <td className="py-1.5 text-right">${fmtPrice(s.spot)}</td>
                  <td className="py-1.5 text-right">
                    {s.prior_extreme_rsi.toFixed(1)} →{" "}
                    {s.current_extreme_rsi.toFixed(1)}
                  </td>
                  <td className="py-1.5 text-[11px]">
                    {s.trade_id ? (
                      <span className="text-(--color-up)">
                        Traded #{s.trade_id}
                      </span>
                    ) : (
                      <span className="text-(--color-text-dim)">
                        {s.skip_reason ?? "—"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(d: Date): string {
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return d.toLocaleDateString();
}

/** Backtest the strategy on historical SPY 5m bars. POSTs to
 * /api/bot/backtest and renders the summary stats + a scrollable trade
 * table. ~10-30s round-trip; shows a loading state.
 *
 * NB: simulated option marks use a fixed 15% IV — directionally useful,
 * not precise. Banner reminds the user.
 */
function BacktestPanel() {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BotBacktestResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api.post<BotBacktestResponse>(`/bot/backtest?days=${days}`);
      setResult(r);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Backtest failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FlaskConical size={16} className="text-(--color-accent)" />
          <h3 className="text-sm font-medium">Backtest</h3>
          <span className="text-[10px] text-(--color-text-dim)">
            simulated, 15% IV — directional only
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-(--color-text-dim)">
            Days
            <input
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 0)))}
              disabled={busy}
              className="w-16 rounded-md border border-(--color-border) bg-(--color-panel-2) px-2 py-1 text-right tabular-nums focus:outline-none disabled:opacity-50"
            />
          </label>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="rounded-md bg-(--color-accent) px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy ? "Running…" : "Run backtest"}
          </button>
        </div>
      </header>

      {err && (
        <div className="rounded-md border border-(--color-down)/50 bg-(--color-down)/10 px-3 py-2 text-sm text-(--color-down)">
          {err}
        </div>
      )}

      {busy && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {result && result.summary.error && (
        <div className="text-sm text-(--color-down)">
          Backtest error: {result.summary.error}
        </div>
      )}

      {result && !result.summary.error && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-7">
            <BTStat
              label="Trades"
              value={String(result.summary.trade_count)}
            />
            <BTStat
              label="Win rate"
              value={`${result.summary.win_rate_pct}%`}
              tone={result.summary.win_rate_pct >= 50 ? "up" : "down"}
            />
            <BTStat
              label="Total P/L"
              value={`${result.summary.total_pnl >= 0 ? "+" : "-"}$${fmtPrice(Math.abs(result.summary.total_pnl))}`}
              tone={result.summary.total_pnl >= 0 ? "up" : "down"}
            />
            <BTStat
              label="Return"
              value={`${result.summary.total_pnl_pct >= 0 ? "+" : ""}${result.summary.total_pnl_pct}%`}
              tone={result.summary.total_pnl_pct >= 0 ? "up" : "down"}
            />
            <BTStat
              label="Avg win"
              value={`+$${fmtPrice(result.summary.avg_win)}`}
              tone="up"
            />
            <BTStat
              label="Avg loss"
              value={`-$${fmtPrice(Math.abs(result.summary.avg_loss))}`}
              tone="down"
            />
            <BTStat
              label="Max DD"
              value={`-$${fmtPrice(result.summary.max_drawdown)} (${result.summary.max_drawdown_pct}%)`}
              tone="down"
            />
          </div>
          <div className="text-[10px] text-(--color-text-dim)">
            {result.bars_loaded} bars over {result.days_requested}d ·
            starting equity ${fmtPrice(result.summary.starting_equity, 0)} ·
            assumed IV {(result.summary.assumed_iv * 100).toFixed(0)}%
          </div>
          {result.trades.length > 0 && (
            <div className="mt-3 max-h-72 overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-(--color-text-dim)">
                  <tr>
                    <th className="text-left font-normal">Entry</th>
                    <th className="text-left font-normal">Side</th>
                    <th className="text-right font-normal">Strike</th>
                    <th className="text-right font-normal">Qty</th>
                    <th className="text-right font-normal">Entry $</th>
                    <th className="text-right font-normal">Exit $</th>
                    <th className="text-right font-normal">Reason</th>
                    <th className="text-right font-normal">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((t, i) => (
                    <tr
                      key={i}
                      className="border-t border-(--color-border) tabular-nums"
                    >
                      <td className="py-1">{fmtTime(t.entry_ts)}</td>
                      <td className="py-1 capitalize">{t.side}</td>
                      <td className="py-1 text-right">${t.strike}</td>
                      <td className="py-1 text-right">{t.qty}</td>
                      <td className="py-1 text-right">${fmtPrice(t.entry_mark)}</td>
                      <td className="py-1 text-right">${fmtPrice(t.exit_mark)}</td>
                      <td className="py-1 text-right text-(--color-text-dim)">
                        {t.exit_reason}
                      </td>
                      <td className={`py-1 text-right ${changeClass(t.pnl)}`}>
                        {t.pnl >= 0 ? "+" : "-"}${fmtPrice(Math.abs(t.pnl))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BTStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "up" | "down";
}) {
  const toneClass =
    tone === "up"
      ? "text-(--color-up)"
      : tone === "down"
        ? "text-(--color-down)"
        : "";
  return (
    <div className="rounded-md border border-(--color-border) bg-(--color-panel-2) px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-(--color-text-dim)">
        {label}
      </div>
      <div className={`text-sm tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
