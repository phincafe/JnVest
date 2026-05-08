"""SnapTrade integration. Free tier covers up to 5 brokerage connections —
enough for a personal Roth IRA across Robinhood + Schwab/ToS + spares.

Single-user app: we register one SnapTrade end-user lazily on first call and
reuse it forever. The userSecret is stored in jnv_snaptrade_user.
"""

import secrets
from typing import Any

from snaptrade_client import SnapTrade
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import SnapTradeUser

JNVEST_USER_ID_PREFIX = "jnvest-"


def _client() -> SnapTrade:
    s = get_settings()
    if not s.snaptrade_client_id or not s.snaptrade_consumer_key:
        raise RuntimeError("SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY not configured")
    return SnapTrade(
        client_id=s.snaptrade_client_id,
        consumer_key=s.snaptrade_consumer_key,
    )


def get_or_create_user(db: Session) -> SnapTradeUser:
    row = db.query(SnapTradeUser).first()
    if row:
        return row
    user_id = f"{JNVEST_USER_ID_PREFIX}{secrets.token_hex(8)}"
    resp = _client().authentication.register_snap_trade_user(user_id=user_id)
    body = resp.body if hasattr(resp, "body") else resp
    user_secret = body["userSecret"]
    row = SnapTradeUser(user_id=user_id, user_secret=user_secret)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def login_link(user: SnapTradeUser) -> str:
    """Returns a SnapTrade-hosted URL the user opens to add a brokerage connection."""
    resp = _client().authentication.login_snap_trade_user(
        user_id=user.user_id, user_secret=user.user_secret
    )
    body = resp.body if hasattr(resp, "body") else resp
    return body["redirectURI"]


def list_authorizations(user: SnapTradeUser) -> list[dict[str, Any]]:
    resp = _client().connections.list_brokerage_authorizations(
        user_id=user.user_id, user_secret=user.user_secret
    )
    body = resp.body if hasattr(resp, "body") else resp
    return [_to_dict(item) for item in body]


def remove_authorization(user: SnapTradeUser, authorization_id: str) -> None:
    _client().connections.remove_brokerage_authorization(
        authorization_id=authorization_id,
        user_id=user.user_id,
        user_secret=user.user_secret,
    )


def all_holdings(user: SnapTradeUser) -> list[dict[str, Any]]:
    """Aggregated holdings across all connected accounts.

    Returns a list of {account, balances, positions, option_positions, orders, total_value} dicts.
    """
    resp = _client().account_information.get_all_user_holdings(
        user_id=user.user_id, user_secret=user.user_secret
    )
    body = resp.body if hasattr(resp, "body") else resp
    if not isinstance(body, list):
        body = [body]
    return [_to_dict(item) for item in body]


def _to_dict(obj: Any) -> Any:
    """SnapTrade SDK returns dict-like objects (frozendict). Coerce recursively to plain dict/list."""
    if isinstance(obj, dict):
        return {k: _to_dict(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_dict(v) for v in obj]
    if hasattr(obj, "to_dict"):
        try:
            return _to_dict(obj.to_dict())
        except Exception:
            pass
    return obj
