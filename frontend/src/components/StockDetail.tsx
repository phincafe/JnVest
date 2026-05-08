import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { api, ApiError } from "../api/client";
import type {
  StockBarsResponse,
  StockFundamentals,
  StockNewsResponse,
} from "../api/types";
import { fmtPrice } from "../lib/format";
import { CandlestickChart } from "./CandlestickChart";
import { InsiderPanel } from "./InsiderPanel";
import { OptionsPanel } from "./OptionsPanel";
import { Skeleton } from "./Skeleton";

const RANGES = ["1D", "5D", "1M", "6M", "1Y"] as const;
type Range = (typeof RANGES)[number];

type Props = { symbol: string | null };

export function StockDetail({ symbol }: Props) {
  const [range, setRange] = useState<Range>("1M");
  const [bars, setBars] = useState<StockBarsResponse | null>(null);
  const [news, setNews] = useState<StockNewsResponse | null>(null);
  const [fund, setFund] = useState<StockFundamentals | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setErr(null);
    setBars(null);
    setNews(null);
    setFund(null);
    Promise.all([
      api.get<StockBarsResponse>(`/stock/${symbol}/bars?range=${range}`),
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
  }, [symbol, range]);

  if (!symbol) {
    return (
      <section className="rounded-xl border border-(--color-border) bg-(--color-panel) p-6 text-sm text-(--color-text-dim)">
        Select a ticker from the watchlist to see chart, news, and fundamentals.
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{symbol}</h2>
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
    { label: "Strong Buy", count: rec.strong_buy, color: "bg-emerald-500" },
    { label: "Buy", count: rec.buy, color: "bg-(--color-up)" },
    { label: "Hold", count: rec.hold, color: "bg-yellow-500" },
    { label: "Sell", count: rec.sell, color: "bg-orange-500" },
    { label: "Strong Sell", count: rec.strong_sell, color: "bg-(--color-down)" },
  ];
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
      <div className="flex h-2 overflow-hidden rounded-full bg-(--color-panel-2)">
        {segs.map((s) =>
          s.count > 0 ? (
            <div
              key={s.label}
              className={s.color}
              style={{ width: `${(s.count / rec.total) * 100}%` }}
              title={`${s.label}: ${s.count}`}
            />
          ) : null,
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-(--color-text-dim) tabular-nums">
        {segs.map((s) => (
          <span key={s.label}>{s.count}</span>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
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
