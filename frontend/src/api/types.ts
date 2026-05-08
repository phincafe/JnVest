export type AuthStatus = {
  authed: boolean;
  is_paper: boolean;
};

export type IndexTile = {
  symbol: string;
  last: number;
  prev_close: number;
  change: number;
  change_pct: number;
  ts: string | null;
};

export type IndicesResponse = {
  tiles: IndexTile[];
};

export type SectorsResponse = {
  tiles: IndexTile[];
};

export type MacroEntry = IndexTile & { spark: number[] };
export type MacroResponse = Record<string, MacroEntry>;

export type WatchlistTicker = {
  id: number;
  symbol: string;
  sort_order: number;
};

export type WatchlistRow = {
  symbol: string;
  last: number;
  prev_close: number;
  change: number;
  change_pct: number;
  volume: number;
  avg_volume_30d: number;
  rel_volume: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  high_52w: number | null;
  low_52w: number | null;
  next_earnings: string | null;
  earnings_in_days: number | null;
};

export type WatchlistQuotesResponse = {
  rows: WatchlistRow[];
};

export type Bar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type StockBarsResponse = {
  symbol: string;
  range: string;
  timeframe: string;
  bars: Bar[];
  sma20: (number | null)[];
  sma50: (number | null)[];
  sma200: (number | null)[];
};

export type NewsItem = {
  headline: string;
  source: string;
  url: string;
  summary: string;
  ts: number;
};

export type StockNewsResponse = {
  items: NewsItem[];
  warning?: string;
};

export type StockFundamentals = {
  symbol: string;
  next_earnings: string | null;
  ex_dividend: string | null;
  analyst_target_mean: number | null;
  analyst_target_high: number | null;
  analyst_target_low: number | null;
  analyst_count: number | null;
  market_cap: number | null;
  trailing_pe: number | null;
  forward_pe: number | null;
};
