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


class PlaidItem(Base):
    """One Plaid 'item' = one connected institution. Stores the access_token in the
    clear since this is a single-user app and the DB itself is access-controlled.
    If you ever multi-tenant this, encrypt at rest."""

    __tablename__ = "jnv_plaid_items"
    __table_args__ = (UniqueConstraint("item_id", name="uq_jnv_plaid_item_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    access_token: Mapped[str] = mapped_column(String(255), nullable=False)
    institution_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    institution_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class SnapTradeUser(Base):
    """One-row table holding the JnVest SnapTrade end-user identity. Single-user app:
    we register one SnapTrade user lazily on first call and reuse it forever."""

    __tablename__ = "jnv_snaptrade_user"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    user_secret: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class IVHistory(Base):
    """Stores daily ATM IV snapshots so we can compute IV Rank/Percentile over 1Y."""

    __tablename__ = "jnv_iv_history"
    __table_args__ = (UniqueConstraint("symbol", "as_of_date", name="uq_jnv_iv_symbol_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    as_of_date: Mapped[str] = mapped_column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    atm_iv: Mapped[float] = mapped_column(Float, nullable=False)
