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
  warning?: string | null;
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
  date?: string | null;
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

export type AccountSummary = {
  equity: number;
  last_equity: number;
  cash: number;
  buying_power: number;
  long_market_value: number;
  short_market_value: number;
  today_pl: number;
  today_pl_pct: number;
  is_paper: boolean;
};

export type AlpacaPosition = {
  symbol: string;
  asset_class: string;
  qty: number;
  side: string;
  avg_entry_price: number;
  market_value: number;
  current_price: number;
  unrealized_pl: number;
  unrealized_plpc: number;
  unrealized_intraday_pl: number;
};

export type AlpacaOrder = {
  id: string;
  symbol: string;
  side: string;
  qty: number;
  filled_qty: number;
  type: string;
  limit_price: string | null;
  status: string;
  submitted_at: string | null;
  filled_at: string | null;
  filled_avg_price: string | null;
};

export type PlaidItem = {
  id: number;
  item_id: string;
  institution_id: string | null;
  institution_name: string | null;
  created_at: string;
};

export type PlaidHolding = {
  ticker: string | null;
  name: string | null;
  type: string | null;
  account_name: string | null;
  account_subtype: string | null;
  quantity: number;
  price: number;
  cost_basis_per_share: number | null;
  market_value: number;
  cost_basis_total: number | null;
  unrealized_pl: number | null;
  unrealized_pl_pct: number | null;
};

export type PlaidAccount = {
  name: string | null;
  subtype: string | null;
  balance: number;
};

export type PlaidItemHoldings = {
  id: number;
  institution_name: string | null;
  error?: string;
  holdings: PlaidHolding[];
  accounts: PlaidAccount[];
};

export type PlaidHoldingsResponse = {
  items: PlaidItemHoldings[];
  totals: {
    market_value: number;
    cost_basis: number;
    unrealized_pl: number | null;
    unrealized_pl_pct: number | null;
  };
};

export type SnapTradeAccount = {
  id: string;
  name: string;
  broker: string;
  type: string | null;
  balance: number;
  cash: number;
  equity: number;
};

export type SnapTradeStock = {
  account_id: string;
  account: string;
  broker: string;
  ticker: string | null;
  description: string | null;
  quantity: number;
  price: number;
  avg_cost: number | null;
  market_value: number;
  unrealized_pl: number | null;
  unrealized_pl_pct: number | null;
};

export type SnapTradeOption = {
  account_id: string;
  account: string;
  broker: string;
  underlying: string | null;
  ticker: string | null;
  option_type: string | null;
  strike: number | null;
  expiration: string | null;
  quantity: number;
  price: number;
  avg_cost: number | null;
  market_value: number;
  unrealized_pl: number | null;
  unrealized_pl_pct: number | null;
};

export type SnapTradeOrder = {
  account_id: string | null;
  account: string;
  broker: string;
  ticker: string | null;
  is_option: boolean;
  option_type: string | null;
  strike: number | null;
  expiration: string | null;
  action: string | null;
  order_type: string | null;
  status: string | null;
  total_quantity: number | null;
  filled_quantity: number | null;
  execution_price: number | null;
  time: string | null;
};

export type SnapTradeHoldings = {
  accounts: SnapTradeAccount[];
  positions: SnapTradeStock[];
  options: SnapTradeOption[];
  orders: SnapTradeOrder[];
  totals: {
    market_value: number;
    equity: number;
    cash: number;
    unrealized_pl: number;
    cost_basis: number;
  };
};

export type SnapTradeAuthorization = {
  id: string;
  brokerage?: { name?: string; slug?: string } | null;
  created_date?: string;
  updated_date?: string;
  disabled?: boolean;
  disabled_date?: string | null;
};

export type ManualPosition = {
  id: number;
  symbol: string;
  position_type: "stock" | "call" | "put";
  entry_price: number;
  quantity: number;
  expiration: string | null;
  strike: number | null;
  notes: string | null;
  created_at: string;
  last_price: number | null;
  pl: number | null;
  pl_pct: number | null;
};

export type AnalystRecommendation = {
  strong_buy: number;
  buy: number;
  hold: number;
  sell: number;
  strong_sell: number;
  total: number;
  period: string | null;
};

export type Mover = {
  symbol: string;
  last: number;
  change: number;
  change_pct: number;
};

export type MoversResponse = {
  gainers: Mover[];
  losers: Mover[];
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
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
  analyst_recommendation: AnalystRecommendation | null;
};
