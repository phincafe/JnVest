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

export type IvSummary = {
  symbol: string;
  spot: number;
  atm_iv: number | null;
  iv_rank: number | null;
  iv_percentile: number | null;
  history_days: number;
  term_structure: { expiration: string; atm_iv: number; atm_strike: number }[];
  skew: { strike: number; iv: number }[];
};

export type OptionRow = {
  strike: number;
  bid: number;
  ask: number;
  last: number | null;
  volume: number;
  open_interest: number;
  iv: number;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  spread_pct: number | null;
  unusual_volume: boolean;
  in_the_money: boolean;
};

export type ChainResponse = {
  symbol: string;
  expiration: string;
  spot: number;
  days_to_exp: number;
  calls: OptionRow[];
  puts: OptionRow[];
};

export type ExpirationsResponse = {
  symbol: string;
  expirations: string[];
};

export type EconEvent = {
  event: string;
  country: string;
  time: string | null;
  impact: "high" | "medium" | "low";
  actual: string | number | null;
  estimate: string | number | null;
  previous: string | number | null;
  unit: string | null;
};

export type EarningsEvent = {
  symbol: string;
  date: string;
  hour: string | null;
  eps_estimate: number | null;
  eps_actual: number | null;
};

export type CalendarResponse = {
  econ: EconEvent[];
  earnings: EarningsEvent[];
  econ_warning: string | null;
  earnings_warning: string | null;
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
