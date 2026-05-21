// Black-Scholes-Merton option pricing — TS port of backend/app/services/blackscholes.py.
// Kept in the frontend so the P/L calculator can recompute curves on every slider
// move without hitting the backend.

const DAYS_PER_YEAR = 365;

/** Abramowitz & Stegun 7.1.26 — JS has no erf in the std lib. */
function normCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * ax);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

export function bsPrice(
  spot: number,
  strike: number,
  iv: number,
  daysToExp: number,
  isCall: boolean,
  riskFree = 0.05,
  divYield = 0,
): number {
  if (daysToExp <= 0) {
    return isCall ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  }
  if (spot <= 0 || strike <= 0 || iv <= 0) return 0;
  const T = daysToExp / DAYS_PER_YEAR;
  const sqrtT = Math.sqrt(T);
  const d1 =
    (Math.log(spot / strike) + (riskFree - divYield + 0.5 * iv * iv) * T) /
    (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;
  if (isCall) {
    return (
      spot * Math.exp(-divYield * T) * normCdf(d1) -
      strike * Math.exp(-riskFree * T) * normCdf(d2)
    );
  }
  return (
    strike * Math.exp(-riskFree * T) * normCdf(-d2) -
    spot * Math.exp(-divYield * T) * normCdf(-d1)
  );
}

/** P/L in dollars for a single option position at a future spot + days-to-exp.
 * `qty` is signed (positive = long, negative = short). 100-share contract. */
export function optionPnL(args: {
  spot: number;
  strike: number;
  iv: number;
  daysToExp: number;
  isCall: boolean;
  qty: number;
  avgCost: number;
}): number {
  const value = bsPrice(
    args.spot,
    args.strike,
    args.iv,
    args.daysToExp,
    args.isCall,
  );
  return (value - args.avgCost) * 100 * args.qty;
}
