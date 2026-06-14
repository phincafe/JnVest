export type AuthStatus = {
  authed: boolean;
  is_paper: boolean;
  role: "owner" | "guest";
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
  days_back?: number;
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

export type ConfirmedIpo = {
  date: string | null;
  name: string | null;
  symbol: string | null;
  exchange: string | null;
  price_range: string | null;
  shares: number | null;
  total_value_usd: number | null;
  status: string | null;
};

export type IpoFilingStatus =
  | "filed"
  | "confidential_filed"
  | "rumored"
  | "no_timeline";

export type RumoredIpo = {
  name: string;
  sector: string;
  filing_status: IpoFilingStatus;
  ticker: string | null;
  est_valuation_usd: string;
  est_timing: string;
  why_it_matters: string;
  related_tickers: string[];
  source_url: string | null;
  last_verified: string; // YYYY-MM-DD
};

export type IpoCalendarResponse = {
  confirmed: ConfirmedIpo[];
  confirmed_warning: string | null;
  rumored: RumoredIpo[];
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

export type SnapTradeAccount = {
  id: string;
  name: string;
  original_name?: string;
  broker: string;
  type: string | null;
  balance: number;
  cash: number;
  equity: number;
  invested: number;
  /** All-time unrealized P/L (current value − cost basis), summed over stocks + options. */
  open_pl: number;
  /** open_pl as % of cost basis. */
  open_pl_pct: number | null;
  /** Today's change for STOCKS only (last_price − prev_close) × qty. */
  today_pl: number;
  /** today_pl as % of (equity − today_pl). */
  today_pl_pct: number | null;
  /** False when the account holds options (no option prev-close → today_pl is incomplete). */
  today_pl_complete: boolean;
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
  /** Set only in guest mode: % of total invested portfolio. */
  allocation_pct?: number | null;
  /** Days until next earnings report (≤14), null/absent otherwise. */
  earnings_days?: number | null;
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
  /** Set only in guest mode: % of total invested portfolio. */
  allocation_pct?: number | null;
  /** Days until next earnings report (≤14), null/absent otherwise. */
  earnings_days?: number | null;
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
    equity: number;
    invested: number;
    cash: number;
    cost_basis: number;
    unrealized_pl: number;
    market_value: number; // legacy alias = equity
    today_pl?: number;
    today_pl_pct?: number | null;
    today_pl_complete?: boolean;
    /** Guest-only: cash as % of (cash + invested). */
    cash_pct?: number | null;
    /** Guest-only: invested as % of (cash + invested). */
    invested_pct?: number | null;
  };
  auto_added_to_watchlist?: string[];
  guest?: boolean;
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

export type WsbItem = {
  symbol: string;
  name: string | null;
  mentions: number | null;
  mentions_24h_ago: number | null;
  rank: number | null;
  rank_24h_ago: number | null;
  upvotes: number | null;
  sentiment: number | null;
  sentiment_score: number | null;
};

export type WsbResponse = { items: WsbItem[]; warning?: string };

export type SectorRotationRow = {
  symbol: string;
  name: string;
  last: number;
  change_1d_pct: number | null;
  change_5d_pct: number | null;
  change_1m_pct: number | null;
  change_3m_pct: number | null;
  /** 1M − 3M. Positive = sector improving (money rotating IN). */
  rotation_score: number | null;
};

export type SectorRotationResponse = { sectors: SectorRotationRow[] };

export type AiWatchRow = {
  symbol: string;
  last: number;
  change_1d_pct: number | null;
  change_5d_pct: number | null;
  change_1m_pct: number | null;
  change_3m_pct: number | null;
};

export type AiWatchGroup = {
  name: string;
  avg_1d_pct: number | null;
  avg_1m_pct: number | null;
  avg_3m_pct: number | null;
  rotation_score: number | null;
  rows: AiWatchRow[];
};

export type AiWatchResponse = { groups: AiWatchGroup[] };

export type BuyWatchRule = "smart" | "price" | "off_high" | "below_sma" | "rsi";
export type BuyWatchStatus = "in_zone" | "near" | "far" | "unknown";

export type SmartScoreComponents = {
  drawdown: number;
  sma50_pullback: number;
  rsi_oversold: number;
  trend_intact: number;
  confluence: number;
};

export type BuyWatchTarget = {
  id: number;
  symbol: string;
  rule: BuyWatchRule;
  target_price: number | null;
  threshold: number | null;
  note: string | null;
  sort_order: number;
  // Live computed:
  last: number;
  high_52w: number | null;
  low_52w: number | null;
  off_high_pct: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  trigger_price: number | null;
  /** Signed: for price/off_high/below_sma rules positive = above trigger
   * (waiting), negative/zero = in zone. For RSI/smart, units differ
   * (RSI points / score points). */
  distance_pct: number | null;
  status: BuyWatchStatus;
  /** 0-100 composite buy-signal score (always computed, even when rule isn't smart). */
  smart_score: number;
  smart_components: SmartScoreComponents;
};

export type BuyWatchResponse = { targets: BuyWatchTarget[] };

export type BuyWatchInput = {
  symbol: string;
  rule: BuyWatchRule;
  target_price?: number | null;
  threshold?: number | null;
  note?: string | null;
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

export type MarketNewsItem = {
  headline: string;
  source: string;
  url: string;
  summary: string;
  ts: number;
  category: string | null;
  image: string | null;
};

export type MarketNewsResponse = {
  items: MarketNewsItem[];
  warning?: string;
};

export type InsiderTx = {
  name: string;
  share: number;
  change: number;
  transaction_price: number;
  transaction_code: string | null;
  transaction_date: string | null;
  filing_date: string | null;
};

export type InsiderResponse = {
  items: InsiderTx[];
  summary: {
    buy_shares: number;
    sell_shares: number;
    buy_value: number;
    sell_value: number;
    net_shares: number;
  } | null;
  warning?: string;
};

export type LastEarnings = {
  period: string | null;
  quarter: number | null;
  year: number | null;
  eps_actual: number | null;
  eps_estimate: number | null;
  surprise: number | null;
  surprise_percent: number | null;
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
  last_earnings: LastEarnings | null;
};

// --- Bot (SPY 0-DTE RSI-divergence) -----------------------------------------
export type BotStatus = {
  running: boolean;
  last_tick: string | null; // ISO
  day_date: string | null; // YYYY-MM-DD UTC
  day_pnl: number;
  daily_loss_cap_hit: boolean;
  is_paper: boolean;
  open_position_exists: boolean;
};

export type BotSignalRow = {
  id: number;
  detected_at: string;
  side: "call" | "put";
  spot: number;
  prior_extreme_price: number;
  current_extreme_price: number;
  prior_extreme_rsi: number;
  current_extreme_rsi: number;
  trade_id: number | null;
  skip_reason: string | null;
};

export type BotTradeRow = {
  id: number;
  signal_id: number | null;
  occ_symbol: string;
  side: "call" | "put";
  qty: number;
  entry_at: string;
  entry_price: number;
  tp_price: number;
  sl_price: number;
  exit_at: string | null;
  exit_price: number | null;
  exit_reason: "tp" | "sl" | "time" | "manual" | null;
  realized_pnl: number | null;
};

// --- Bot backtest -----------------------------------------------------------
export type BotBacktestSummary = {
  starting_equity: number;
  ending_equity: number;
  total_pnl: number;
  total_pnl_pct: number;
  trade_count: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  avg_win: number;
  avg_loss: number;
  max_drawdown: number;
  max_drawdown_pct: number;
  assumed_iv: number;
  error?: string;
};

export type BotBacktestTrade = {
  entry_idx: number;
  entry_ts: string;
  side: "call" | "put";
  spot_at_entry: number;
  strike: number;
  qty: number;
  entry_mark: number;
  exit_idx: number;
  exit_ts: string;
  spot_at_exit: number;
  exit_mark: number;
  exit_reason: "tp" | "sl" | "time";
  pnl: number;
};

export type BotBacktestResponse = {
  days_requested: number;
  bars_loaded: number;
  summary: BotBacktestSummary;
  trades: BotBacktestTrade[];
};

export type BotBacktestShockSlice = {
  iv: number;
  bars_loaded: number;
  trade_count: number;
  summary: BotBacktestSummary;
};

export type BotBacktestShockResponse = {
  days_requested: number;
  slices: BotBacktestShockSlice[];
};

// --- Price alerts -----------------------------------------------------------
export type PriceAlert = {
  id: number;
  symbol: string;
  direction: "above" | "below";
  threshold: number;
  note: string | null;
  created_at: string;
  triggered_at: string | null;
  triggered_price: number | null;
  dismissed_at: string | null;
};

// --- World Cup -------------------------------------------------------------
export type WcCompetitor = {
  id: string | null;
  name: string | null;
  abbr: string | null;
  logo: string | null;
  score: number | null;
  winner: boolean;
  home_away: "home" | "away" | null;
};

export type WcEvent = {
  id: string | null;
  date: string | null;
  state: "pre" | "in" | "post" | null;
  status_detail: string | null;
  clock: string | null;
  completed: boolean;
  venue: string | null;
  group: string | null;
  home: WcCompetitor | null;
  away: WcCompetitor | null;
};

export type WcScoreboard = {
  season: string | null;
  events: WcEvent[];
  live_count: number;
  warning?: string;
};

export type WcStandingRow = {
  id: string | null;
  name: string | null;
  abbr: string | null;
  logo: string | null;
  rank: number | null;
  played: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  gf: number | null;
  ga: number | null;
  gd: number | null;
  points: number | null;
};

export type WcGroup = { name: string | null; teams: WcStandingRow[] };
export type WcStandings = { groups: WcGroup[]; warning?: string };

export type EquityPoint = {
  date: string; // YYYY-MM-DD
  equity: number;
  invested: number;
  cash: number;
};

export type EquityHistoryResponse = { points: EquityPoint[] };

export type PriceAlertsResponse = {
  alerts: PriceAlert[];
  /** ISO time the backend evaluator last completed a tick — null until the
   * first tick after boot. Stale (>5 min) means evaluation is paused
   * (e.g. Render free-tier sleep). */
  last_evaluated_at: string | null;
};

export type PriceAlertInput = {
  symbol: string;
  direction: "above" | "below";
  threshold: number;
  note?: string | null;
};
