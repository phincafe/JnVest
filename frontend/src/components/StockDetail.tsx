import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { api, ApiError } from "../api/client";
import type {
  LastEarnings,
  StockBarsResponse,
  StockFundamentals,
  StockNewsResponse,
} from "../api/types";
import { fmtPrice } from "../lib/format";
import { CandlestickChart } from "./CandlestickChart";
import { InsiderPanel } from "./InsiderPanel";
import { OptionsPanel } from "./OptionsPanel";
import { Skeleton } from "./Skeleton";

const RANGES = ["1D", "5D", "1M", "3M", "6M", "1Y", "5Y", "ALL"] as const;
type Range = (typeof RANGES)[number];

// Allowed (range → timeframes) — first entry is the default. Mirrors the
// backend's RANGE_TIMEFRAMES so we can render valid pickers without an
// extra round trip. Backend rejects any combo not listed here.
const RANGE_TIMEFRAMES: Record<Range, string[]> = {
  "1D": ["5Min", "1Min", "15Min", "30Min", "1Hour"],
  "5D": ["15Min", "5Min", "30Min", "1Hour"],
  "1M": ["1Hour", "30Min", "1Day"],
  "3M": ["1Hour", "1Day"],
  "6M": ["1Day", "1Hour"],
  "1Y": ["1Day", "1Week"],
  "5Y": ["1Week", "1Day"],
  ALL: ["1Day", "1Week", "1Month"],
};

// Friendly labels for the interval pills.
const TF_LABELS: Record<string, string> = {
  "1Min": "1m",
  "5Min": "5m",
  "15Min": "15m",
  "30Min": "30m",
  "1Hour": "1h",
  "1Day": "1D",
  "1Week": "1W",
  "1Month": "1M",
};

// Approximate minutes-per-bar for display sorting (1D=1Min → 1Month=43200).
const TF_MINUTES: Record<string, number> = {
  "1Min": 1,
  "5Min": 5,
  "15Min": 15,
  "30Min": 30,
  "1Hour": 60,
  "1Day": 60 * 24,
  "1Week": 60 * 24 * 7,
  "1Month": 60 * 24 * 30,
};

type Props = { symbol: string | null };

export function StockDetail({ symbol }: Props) {
  const [range, setRange] = useState<Range>("1M");
  const [timeframe, setTimeframe] = useState<string>(RANGE_TIMEFRAMES["1M"][0]);
  const [bars, setBars] = useState<StockBarsResponse | null>(null);
  const [news, setNews] = useState<StockNewsResponse | null>(null);
  const [fund, setFund] = useState<StockFundamentals | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // When range changes, snap timeframe to the new range's default so we
  // never end up with an invalid combo (e.g., 1Min + 1Y).
  useEffect(() => {
    const allowed = RANGE_TIMEFRAMES[range];
    if (!allowed.includes(timeframe)) {
      setTimeframe(allowed[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setErr(null);
    setBars(null);
    setNews(null);
    setFund(null);
    Promise.all([
      api.get<StockBarsResponse>(
        `/stock/${symbol}/bars?range=${range}&timeframe=${encodeURIComponent(timeframe)}`,
      ),
      api.get<StockNewsResponse>(`/stock/${symbol}/news?limit=10`),
      api.get<StockFundamentals>(`/stock/${symbol}/fundamentals`),
    ])
      .then(([b, n, f]) => {
        if (cancelled) return;
        setBars(b);
        setNews(n);
        setFund(f);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof ApiError ? e.detail : (e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, range, timeframe]);

  if (!symbol) {
    return (
      <section className="rounded-xl border border-(--color-border) bg-(--color-panel) p-6 text-sm text-(--color-text-dim)">
        Select a ticker from the watchlist to see chart, news, and fundamentals.
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{symbol}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {/* Interval picker — only shows valid timeframes for the current range. */}
          <div className="flex items-center gap-1 rounded-md border border-(--color-border) bg-(--color-panel) p-0.5">
            {/* Sort ascending by candle size for display; the array's "first
                entry is the default" semantics still hold via the snap effect. */}
            {[...RANGE_TIMEFRAMES[range]]
              .sort((a, b) => (TF_MINUTES[a] ?? 0) - (TF_MINUTES[b] ?? 0))
              .map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`rounded px-2 py-1 text-xs ${
                    tf === timeframe
                      ? "bg-(--color-accent) text-white"
                      : "text-(--color-text-dim) hover:text-(--color-text)"
                  }`}
                  title={`Candle: ${TF_LABELS[tf] ?? tf}`}
                >
                  {TF_LABELS[tf] ?? tf}
                </button>
              ))}
          </div>
          {/* Range picker. */}
          <div className="flex items-center gap-1 rounded-md border border-(--color-border) bg-(--color-panel) p-0.5">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded px-2 py-1 text-xs ${
                  r === range
                    ? "bg-(--color-accent) text-white"
                    : "text-(--color-text-dim) hover:text-(--color-text)"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-(--color-down)/40 bg-(--color-panel) p-2 text-xs text-(--color-down)">
          {err}
        </div>
      )}

      <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-3">
        {bars ? (
          <CandlestickChart
            bars={bars.bars}
            sma20={bars.sma20}
            sma50={bars.sma50}
            sma200={bars.sma200}
          />
        ) : (
          <Skeleton className="h-[360px] w-full" />
        )}
        <div className="mt-2 flex items-center gap-3 text-xs text-(--color-text-dim)">
          <LegendDot color="#3b82f6" /> SMA 20
          <LegendDot color="#f59e0b" /> SMA 50
          <LegendDot color="#a855f7" /> SMA 200
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <FundamentalsCard fund={fund} />
        <NewsCard news={news} />
      </div>

      <InsiderPanel symbol={symbol} />
      <OptionsPanel symbol={symbol} />
    </section>
  );
}

function LegendDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

/** Finnhub returns marketCapitalization in millions of USD. Format compactly:
 *   750     → "$750M"
 *   3500    → "$3.50B"
 *   3500000 → "$3.50T" */
function fmtMarketCap(mcapMillions: number | null | undefined): string {
  if (mcapMillions == null || mcapMillions <= 0) return "—";
  if (mcapMillions >= 1_000_000) return `$${(mcapMillions / 1_000_000).toFixed(2)}T`;
  if (mcapMillions >= 1_000) return `$${(mcapMillions / 1_000).toFixed(2)}B`;
  return `$${mcapMillions.toFixed(0)}M`;
}

function fmtLastEarningsPeriod(le: LastEarnings | null): string {
  if (!le) return "—";
  if (le.quarter && le.year) return `Q${le.quarter} ${le.year}`;
  return le.period ?? "—";
}

function fmtEps(v: number | null | undefined): string {
  if (v == null) return "—";
  // EPS can be negative; show sign so a $-0.42 actual is unmistakable.
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
}

function LastEpsValue({ le }: { le: LastEarnings | null }) {
  if (!le || (le.eps_actual == null && le.eps_estimate == null)) {
    return <span>—</span>;
  }
  const actual = fmtEps(le.eps_actual);
  const est = fmtEps(le.eps_estimate);
  const pct = le.surprise_percent;
  const surpriseClass =
    pct == null
      ? "text-(--color-text-dim)"
      : pct >= 0
        ? "text-(--color-up)"
        : "text-(--color-down)";
  return (
    <span>
      {actual} / {est}
      {pct != null && (
        <span className={`ml-1 ${surpriseClass}`}>
          {pct >= 0 ? "+" : ""}
          {pct.toFixed(1)}%
        </span>
      )}
    </span>
  );
}

function FundamentalsCard({ fund }: { fund: StockFundamentals | null }) {
  const hasAnalystData =
    !!fund &&
    (fund.analyst_target_mean != null ||
      fund.analyst_target_high != null ||
      fund.analyst_recommendation != null);

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-3 text-sm font-medium text-(--color-text-dim)">Fundamentals</h3>
      {!fund ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <Row label="Next earnings" value={fund.next_earnings ?? "—"} />
            <Row label="Ex-dividend" value={fund.ex_dividend ?? "—"} />
            <Row
              label="Last earnings"
              value={fmtLastEarningsPeriod(fund.last_earnings)}
            />
            <Row
              label="EPS (act / est)"
              value={<LastEpsValue le={fund.last_earnings} />}
            />
            <Row label="Market cap" value={fmtMarketCap(fund.market_cap)} />
            <Row
              label="Analyst target avg"
              value={
                fund.analyst_target_mean
                  ? `$${fmtPrice(fund.analyst_target_mean)}` +
                    (fund.analyst_count ? ` (${fund.analyst_count})` : "")
                  : "—"
              }
            />
            <Row
              label="Target range"
              value={
                fund.analyst_target_low && fund.analyst_target_high
                  ? `$${fmtPrice(fund.analyst_target_low)} – $${fmtPrice(fund.analyst_target_high)}`
                  : "—"
              }
            />
            <Row
              label="Trailing P/E"
              value={fund.trailing_pe ? fund.trailing_pe.toFixed(1) : "—"}
            />
            <Row
              label="Forward P/E"
              value={fund.forward_pe ? fund.forward_pe.toFixed(1) : "—"}
            />
            <Row
              label="52W high"
              value={
                fund.fifty_two_week_high ? `$${fmtPrice(fund.fifty_two_week_high)}` : "—"
              }
            />
            <Row
              label="52W low"
              value={
                fund.fifty_two_week_low ? `$${fmtPrice(fund.fifty_two_week_low)}` : "—"
              }
            />
          </dl>
          {fund.analyst_recommendation && fund.analyst_recommendation.total > 0 && (
            <RecommendationBar rec={fund.analyst_recommendation} />
          )}
          {!hasAnalystData && (
            <p className="mt-2 text-xs text-(--color-text-dim)">
              Analyst coverage data not available for this ticker on the free Finnhub
              tier.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function RecommendationBar({
  rec,
}: {
  rec: NonNullable<StockFundamentals["analyst_recommendation"]>;
}) {
  const segs = [
    { label: "Strong Buy", short: "S.Buy", count: rec.strong_buy, color: "bg-emerald-500", text: "text-emerald-400" },
    { label: "Buy", short: "Buy", count: rec.buy, color: "bg-(--color-up)", text: "text-(--color-up)" },
    { label: "Hold", short: "Hold", count: rec.hold, color: "bg-yellow-500", text: "text-yellow-300" },
    { label: "Sell", short: "Sell", count: rec.sell, color: "bg-orange-500", text: "text-orange-300" },
    { label: "Strong Sell", short: "S.Sell", count: rec.strong_sell, color: "bg-(--color-down)", text: "text-(--color-down)" },
  ];
  // Compute consensus: weighted score on a 1 (Strong Sell) → 5 (Strong Buy) scale.
  const score =
    rec.total > 0
      ? (5 * rec.strong_buy +
          4 * rec.buy +
          3 * rec.hold +
          2 * rec.sell +
          1 * rec.strong_sell) /
        rec.total
      : null;
  const consensus =
    score == null
      ? "—"
      : score >= 4.5
        ? "Strong Buy"
        : score >= 3.5
          ? "Buy"
          : score >= 2.5
            ? "Hold"
            : score >= 1.5
              ? "Sell"
              : "Strong Sell";
  const consensusColor =
    score == null
      ? "text-(--color-text-dim)"
      : score >= 4.5
        ? "text-emerald-400"
        : score >= 3.5
          ? "text-(--color-up)"
          : score >= 2.5
            ? "text-yellow-300"
            : score >= 1.5
              ? "text-orange-300"
              : "text-(--color-down)";
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className="text-(--color-text-dim) uppercase tracking-wide">
          Analyst recommendation
        </span>
        <span className="text-(--color-text-dim)">
          {rec.total} analyst{rec.total === 1 ? "" : "s"}
          {rec.period ? ` · ${rec.period}` : ""}
        </span>
      </div>

      {/* Bar with hover tooltips per segment */}
      <div className="flex h-2.5 overflow-hidden rounded-full bg-(--color-panel-2)">
        {segs.map((s) =>
          s.count > 0 ? (
            <div
              key={s.label}
              className={s.color}
              style={{ width: `${(s.count / rec.total) * 100}%` }}
              title={`${s.label}: ${s.count} of ${rec.total}`}
            />
          ) : null,
        )}
      </div>

      {/* Legend with color dot, label, and count — Bloomberg/Yahoo Finance style */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-(--color-text-dim)">
        {segs.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${s.color}`} />
            <span>{s.short}</span>
            <span className="font-medium tabular-nums text-(--color-text)">{s.count}</span>
          </span>
        ))}
      </div>

      {/* Plain-English consensus + scale explanation */}
      <div className="mt-2 flex items-baseline justify-between gap-2 rounded-md bg-(--color-panel-2) px-2 py-1.5 text-[11px]">
        <div>
          <span className="text-(--color-text-dim)">Consensus: </span>
          <span className={`font-semibold ${consensusColor}`}>{consensus}</span>
          {score != null && (
            <span className="ml-1 text-(--color-text-dim) tabular-nums">
              ({score.toFixed(2)} / 5.00)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="text-(--color-text-dim)">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </>
  );
}

function NewsCard({ news }: { news: StockNewsResponse | null }) {
  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-panel) p-4">
      <h3 className="mb-3 text-sm font-medium text-(--color-text-dim)">Recent news</h3>
      {!news ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : news.warning ? (
        <p className="text-sm text-(--color-text-dim)">{news.warning}</p>
      ) : news.items.length === 0 ? (
        <p className="text-sm text-(--color-text-dim)">
          No headlines in the last {news.days_back ?? 30} days. Thinly-covered
          small/mid-caps often go quiet between earnings.
        </p>
      ) : (
        <ul className="space-y-3">
          {news.items.map((item, i) => (
            <li key={i} className="text-sm">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-(--color-text) hover:text-(--color-accent)"
              >
                {item.headline}
                <ExternalLink size={12} className="ml-1 inline" />
              </a>
              <div className="mt-0.5 text-xs text-(--color-text-dim)">
                {item.source}
                {item.ts && ` · ${new Date(item.ts * 1000).toLocaleString()}`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
