from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class WatchlistTicker(Base):
    __tablename__ = "jnv_watchlist_tickers"
    __table_args__ = (UniqueConstraint("symbol", name="uq_jnv_watchlist_symbol"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class ManualPosition(Base):
    __tablename__ = "jnv_manual_positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    position_type: Mapped[str] = mapped_column(String(16), nullable=False)  # stock | call | put
    entry_price: Mapped[float] = mapped_column(Float, nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    expiration: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD
    strike: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class SnapTradeUser(Base):
    """One-row table holding the JnVest SnapTrade end-user identity. Single-user app:
    we register one SnapTrade user lazily on first call and reuse it forever."""

    __tablename__ = "jnv_snaptrade_user"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    user_secret: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class BrokerageAccountAlias(Base):
    """User-chosen display name for a SnapTrade account_id, so you can rename
    'Robinhood Roth Ira' → 'My Roth' or 'Wife's IRA'."""

    __tablename__ = "jnv_brokerage_account_aliases"
    __table_args__ = (UniqueConstraint("account_id", name="uq_jnv_acct_alias"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    nickname: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class BuyTarget(Base):
    """A 'buy on dip' watch entry. Each row is one ticker the owner wants to
    accumulate at a chosen price/condition. Status (in zone / near / far) is
    computed dynamically from live prices — we just persist the rule."""

    __tablename__ = "jnv_buy_targets"
    __table_args__ = (UniqueConstraint("symbol", name="uq_jnv_buy_target_symbol"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    # rule = how to decide when this is "in the buy zone":
    #   "price"      → trigger when last <= target_price
    #   "off_high"   → trigger when last is `threshold`% (or more) below 52w high
    #   "below_sma"  → trigger when last <= the chosen SMA (threshold = 20/50/200)
    #   "rsi"        → trigger when RSI(14) <= threshold (e.g., 35 for oversold)
    rule: Mapped[str] = mapped_column(String(16), nullable=False, default="price")
    target_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class IVHistory(Base):
    """Stores daily ATM IV snapshots so we can compute IV Rank/Percentile over 1Y."""

    __tablename__ = "jnv_iv_history"
    __table_args__ = (UniqueConstraint("symbol", "as_of_date", name="uq_jnv_iv_symbol_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    as_of_date: Mapped[str] = mapped_column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    atm_iv: Mapped[float] = mapped_column(Float, nullable=False)
