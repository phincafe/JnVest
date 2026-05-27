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
  BotBacktestShockResponse,
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
                <th className="text-left font-normal">Contract</th>
                <th className="text-right font-normal">Qty</th>
                <th className="text-right font-normal">Entry $</th>
                <th className="text-right font-normal">TP / SL</th>
                <th className="text-right font-normal">Exit $</th>
                <th className="text-left font-normal">Exit time</th>
                <th className="text-right font-normal">P/L</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const parsed = parseOcc(t.occ_symbol);
                const dur =
                  t.exit_at != null
                    ? formatDuration(
                        new Date(t.exit_at).getTime() -
                          new Date(t.entry_at).getTime(),
                      )
                    : null;
                return (
                <tr
                  key={t.id}
                  className="border-t border-(--color-border) tabular-nums"
                >
                  <td className="py-1.5">{fmtTime(t.entry_at)}</td>
                  <td className="py-1.5 text-[11px]">
                    {parsed ? (
                      <span>
                        {parsed.underlying}{" "}
                        <span className="text-(--color-text-dim)">
                          ${parsed.strike}
                          {parsed.side[0].toUpperCase()}
                        </span>{" "}
                        <span className="text-(--color-text-dim)">
                          {parsed.expiration}
                        </span>
                      </span>
                    ) : (
                      <span className="text-(--color-text-dim)">
                        {t.occ_symbol}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">{t.qty}</td>
                  <td className="py-1.5 text-right">
                    ${fmtPrice(t.entry_price)}
                  </td>
                  <td className="py-1.5 text-right text-[10px] text-(--color-text-dim)">
                    <span className="text-(--color-up)">
                      ${fmtPrice(t.tp_price)}
                    </span>{" "}
                    /{" "}
                    <span className="text-(--color-down)">
                      ${fmtPrice(t.sl_price)}
                    </span>
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
                  <td className="py-1.5 text-[11px] text-(--color-text-dim)">
                    {t.exit_at ? (
                      <span>
                        {fmtTime(t.exit_at)}
                        {dur && (
                          <span className="ml-1 text-[10px]">
                            ({dur})
                          </span>
                        )}
                      </span>
                    ) : (
                      "—"
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Parse an OCC option symbol like "SPY260527C00750000" into readable
 * fields: SPY / 2026-05-27 / 750 / call. Returns null on malformed input. */
function parseOcc(
  occ: string,
): { underlying: string; expiration: string; side: "call" | "put"; strike: number } | null {
  const m = occ.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  const [, underlying, yy, mm, dd, cp, strikeStr] = m;
  const year = 2000 + parseInt(yy, 10);
  const expiration = `${year}-${mm}-${dd}`;
  const strike = parseInt(strikeStr, 10) / 1000;
  return {
    underlying,
    expiration,
    side: cp === "C" ? "call" : "put",
    strike,
  };
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${m}m` : `${h}h`;
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
type BacktestConfig = {
  swing_width: number;
  min_bars_between: number;
  min_rsi_gap: number;
  min_price_gap_pct: number;
  tp_pct: number;
  sl_pct: number;
  entry_start_et: string;
  entry_end_et: string;
  assumed_iv: number;
  confirm_bars: number;
  confirm_max_wait: number;
};

const DEFAULT_CFG: BacktestConfig = {
  swing_width: 2,
  min_bars_between: 3,
  min_rsi_gap: 0,
  min_price_gap_pct: 0,
  tp_pct: 0.2,
  sl_pct: 0.2,
  entry_start_et: "09:30",
  entry_end_et: "15:30",
  assumed_iv: 0.15,
  confirm_bars: 2,
  confirm_max_wait: 10,
};

const CFG_LS_KEY = "jnvest:bot:backtest_cfg";

function loadCfg(): BacktestConfig {
  try {
    const raw = localStorage.getItem(CFG_LS_KEY);
    if (!raw) return DEFAULT_CFG;
    return { ...DEFAULT_CFG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CFG;
  }
}

function BacktestPanel() {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [busyShock, setBusyShock] = useState(false);
  const [result, setResult] = useState<BotBacktestResponse | null>(null);
  const [shock, setShock] = useState<BotBacktestShockResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cfg, setCfg] = useState<BacktestConfig>(loadCfg);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(CFG_LS_KEY, JSON.stringify(cfg));
    } catch {
      /* ignore */
    }
  }, [cfg]);

  const buildQuery = () =>
    new URLSearchParams({
      days: String(days),
      swing_width: String(cfg.swing_width),
      min_bars_between: String(cfg.min_bars_between),
      min_rsi_gap: String(cfg.min_rsi_gap),
      min_price_gap_pct: String(cfg.min_price_gap_pct),
      tp_pct: String(cfg.tp_pct),
      sl_pct: String(cfg.sl_pct),
      entry_start_et: cfg.entry_start_et,
      entry_end_et: cfg.entry_end_et,
      confirm_bars: String(cfg.confirm_bars),
      confirm_max_wait: String(cfg.confirm_max_wait),
    });

  const run = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    setShock(null);
    try {
      const q = buildQuery();
      q.set("assumed_iv", String(cfg.assumed_iv));
      const r = await api.post<BotBacktestResponse>(`/bot/backtest?${q}`);
      setResult(r);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Backtest failed");
    } finally {
      setBusy(false);
    }
  };

  const runShock = async () => {
    setBusyShock(true);
    setErr(null);
    setResult(null);
    setShock(null);
    try {
      const r = await api.post<BotBacktestShockResponse>(
        `/bot/backtest/shock?${buildQuery()}`,
      );
      setShock(r);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Backtest failed");
    } finally {
      setBusyShock(false);
    }
  };

  const updateCfg = <K extends keyof BacktestConfig>(
    k: K,
    v: BacktestConfig[K],
  ) => setCfg((p) => ({ ...p, [k]: v }));
  const resetCfg = () => setCfg(DEFAULT_CFG);
  const isDefault =
    JSON.stringify(cfg) === JSON.stringify(DEFAULT_CFG);

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
            onClick={() => setShowSettings((s) => !s)}
            className="rounded-md border border-(--color-border) px-2 py-1 text-xs text-(--color-text-dim) hover:text-(--color-text)"
            title="Tune detector + exit parameters"
          >
            {showSettings ? "Hide settings" : `Settings${isDefault ? "" : " ·"}`}
            {!isDefault && (
              <span className="ml-0.5 text-(--color-accent)">●</span>
            )}
          </button>
          <button
            type="button"
            onClick={run}
            disabled={busy || busyShock}
            className="rounded-md bg-(--color-accent) px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy ? "Running…" : "Run backtest"}
          </button>
          <button
            type="button"
            onClick={runShock}
            disabled={busy || busyShock}
            title="Run at 15% / 25% / 35% IV side-by-side to see if the strategy is IV-fragile"
            className="rounded-md border border-(--color-accent) px-3 py-1 text-xs font-medium text-(--color-accent) hover:bg-(--color-accent)/10 disabled:opacity-50"
          >
            {busyShock ? "Running…" : "IV shock test"}
          </button>
        </div>
      </header>

      {showSettings && (
        <SettingsPanel cfg={cfg} onChange={updateCfg} onReset={resetCfg} />
      )}

      {err && (
        <div className="rounded-md border border-(--color-down)/50 bg-(--color-down)/10 px-3 py-2 text-sm text-(--color-down)">
          {err}
        </div>
      )}

      {(busy || busyShock) && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {shock && <ShockResults shock={shock} />}

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

function SettingsPanel({
  cfg,
  onChange,
  onReset,
}: {
  cfg: BacktestConfig;
  onChange: <K extends keyof BacktestConfig>(k: K, v: BacktestConfig[K]) => void;
  onReset: () => void;
}) {
  return (
    <div className="mb-3 rounded-md border border-(--color-border) bg-(--color-panel-2) p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
          Detector settings · persist in browser
        </span>
        <button
          type="button"
          onClick={onReset}
          className="text-[10px] uppercase tracking-wide text-(--color-text-dim) hover:text-(--color-text)"
        >
          Reset
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <CfgField
          label="Min RSI gap"
          help="Reject divergences where |RSI_curr − RSI_prior| is below this. Try 3-8 to filter weak signals."
          value={cfg.min_rsi_gap}
          step={0.5}
          onChange={(v) => onChange("min_rsi_gap", v)}
        />
        <CfgField
          label="Min price gap %"
          help="Reject swings where price moved less than this percent. Try 0.1-0.5."
          value={cfg.min_price_gap_pct}
          step={0.05}
          onChange={(v) => onChange("min_price_gap_pct", v)}
        />
        <CfgField
          label="Min bars between"
          help="Minimum bar count between the prior swing and the current one. Higher = require sustained moves."
          value={cfg.min_bars_between}
          step={1}
          int
          onChange={(v) => onChange("min_bars_between", v)}
        />
        <CfgField
          label="Swing width"
          help="A point is a swing only if it's the highest/lowest of `2×width + 1` consecutive bars."
          value={cfg.swing_width}
          step={1}
          int
          onChange={(v) => onChange("swing_width", v)}
        />
        <CfgField
          label="TP %"
          help="Take-profit threshold on the option mark, as a fraction (0.20 = +20%)."
          value={cfg.tp_pct}
          step={0.05}
          onChange={(v) => onChange("tp_pct", v)}
        />
        <CfgField
          label="SL %"
          help="Stop-loss threshold on the option mark, as a fraction (0.20 = -20%)."
          value={cfg.sl_pct}
          step={0.05}
          onChange={(v) => onChange("sl_pct", v)}
        />
        <CfgField
          label="Assumed IV"
          help="IV used for option pricing in the single backtest. Real 0-DTE SPY ATM IV varies ~12-35%. The 'IV shock' button tests 15/25/35 side-by-side."
          value={cfg.assumed_iv}
          step={0.05}
          onChange={(v) => onChange("assumed_iv", v)}
        />
        <CfgField
          label="Confirm bars"
          help="After divergence is detected, wait for this many consecutive higher-closes (bullish) or lower-closes (bearish) before entering. Skips entries into the falling-knife bottom. 0 = enter immediately."
          value={cfg.confirm_bars}
          step={1}
          onChange={(v) => onChange("confirm_bars", v)}
        />
        <CfgField
          label="Confirm max wait"
          help="If confirmation doesn't happen within this many bars of the divergence swing, discard the signal as stale."
          value={cfg.confirm_max_wait}
          step={1}
          onChange={(v) => onChange("confirm_max_wait", v)}
        />
        <CfgTimeField
          label="Entry from (ET)"
          help="No new entries before this time. Try 10:00 to skip opening volatility."
          value={cfg.entry_start_et}
          onChange={(v) => onChange("entry_start_et", v)}
        />
        <CfgTimeField
          label="Entry until (ET)"
          help="No new entries after this time. Position monitor still exits at 15:30 regardless."
          value={cfg.entry_end_et}
          onChange={(v) => onChange("entry_end_et", v)}
        />
      </div>
    </div>
  );
}

function CfgField({
  label,
  help,
  value,
  onChange,
  step = 0.1,
  int = false,
}: {
  label: string;
  help: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  int?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1" title={help}>
      <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
        {label}
      </span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => {
          const n = int
            ? parseInt(e.target.value, 10)
            : parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="w-full rounded-md border border-(--color-border) bg-(--color-panel) px-2 py-1 text-right tabular-nums focus:outline-none"
      />
    </label>
  );
}

function CfgTimeField({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1" title={help}>
      <span className="text-[10px] uppercase tracking-wide text-(--color-text-dim)">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="HH:MM"
        className="w-full rounded-md border border-(--color-border) bg-(--color-panel) px-2 py-1 text-right tabular-nums focus:outline-none"
      />
    </label>
  );
}

/** Side-by-side comparison of the strategy at three IV levels. A strategy
 * that's only profitable at the lowest IV is IV-fragile and probably won't
 * survive live trading. */
function ShockResults({ shock }: { shock: BotBacktestShockResponse }) {
  const allProfitable = shock.slices.every((s) => s.summary.total_pnl > 0);
  const noneProfitable = shock.slices.every((s) => s.summary.total_pnl <= 0);
  const onlyLowProfitable =
    shock.slices.length >= 2 &&
    shock.slices[0].summary.total_pnl > 0 &&
    shock.slices[shock.slices.length - 1].summary.total_pnl <= 0;
  const verdict = allProfitable
    ? { tone: "up" as const, text: "Robust — positive at all three IV levels." }
    : noneProfitable
      ? {
          tone: "down" as const,
          text: "No edge — negative at every IV level. Tweak config or pivot.",
        }
      : onlyLowProfitable
        ? {
            tone: "down" as const,
            text:
              "IV-fragile — profitable only at low IV. Real IV is usually higher when divergence fires; live performance likely negative.",
          }
        : {
            tone: "dim" as const,
            text: "Mixed results — read each column carefully.",
          };
  const verdictClass =
    verdict.tone === "up"
      ? "border-(--color-up)/50 bg-(--color-up)/10 text-(--color-up)"
      : verdict.tone === "down"
        ? "border-(--color-down)/50 bg-(--color-down)/10 text-(--color-down)"
        : "border-(--color-border) bg-(--color-panel-2) text-(--color-text-dim)";
  return (
    <div className="mt-2 space-y-3">
      <div className={`rounded-md border px-3 py-2 text-sm ${verdictClass}`}>
        {verdict.text}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {shock.slices.map((s) => {
          const profitable = s.summary.total_pnl > 0;
          return (
            <div
              key={s.iv}
              className={`rounded-md border px-3 py-2 text-xs ${
                profitable
                  ? "border-(--color-up)/40 bg-(--color-up)/5"
                  : "border-(--color-down)/40 bg-(--color-down)/5"
              }`}
            >
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-sm font-medium tabular-nums">
                  IV {(s.iv * 100).toFixed(0)}%
                </span>
                <span
                  className={`text-[10px] uppercase tracking-wide ${
                    profitable
                      ? "text-(--color-up)"
                      : "text-(--color-down)"
                  }`}
                >
                  {profitable ? "Profitable" : "Loss"}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
                <dt className="text-(--color-text-dim)">Trades</dt>
                <dd className="text-right">{s.summary.trade_count}</dd>
                <dt className="text-(--color-text-dim)">Win rate</dt>
                <dd className="text-right">{s.summary.win_rate_pct}%</dd>
                <dt className="text-(--color-text-dim)">Total P/L</dt>
                <dd
                  className={`text-right ${changeClass(s.summary.total_pnl)}`}
                >
                  {s.summary.total_pnl >= 0 ? "+" : "-"}$
                  {fmtPrice(Math.abs(s.summary.total_pnl))}
                </dd>
                <dt className="text-(--color-text-dim)">Return</dt>
                <dd
                  className={`text-right ${changeClass(s.summary.total_pnl_pct)}`}
                >
                  {s.summary.total_pnl_pct >= 0 ? "+" : ""}
                  {s.summary.total_pnl_pct}%
                </dd>
                <dt className="text-(--color-text-dim)">Max DD</dt>
                <dd className="text-right text-(--color-down)">
                  -${fmtPrice(s.summary.max_drawdown)} ({s.summary.max_drawdown_pct}%)
                </dd>
              </dl>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-(--color-text-dim)">
        Same config, three IV assumptions. A robust strategy stays positive
        across all three. If only the 15% column is positive, it's IV-fragile
        — real live IV is usually higher when divergence fires.
      </p>
    </div>
  );
}
