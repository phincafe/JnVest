"""Plaid Investments wrapper.

Sandbox: free, fake institutions, full API surface — use it to develop and test.
Production: real institutions (Robinhood, Schwab/ToS, Fidelity, etc.) — costs money,
verify Plaid's current pricing at https://plaid.com/pricing/.

Switch via PLAID_ENV=sandbox|production env var.
"""

from typing import Any

from plaid.api import plaid_api
from plaid.api_client import ApiClient
from plaid.configuration import Configuration
from plaid.model.country_code import CountryCode
from plaid.model.investments_holdings_get_request import (
    InvestmentsHoldingsGetRequest,
)
from plaid.model.item_public_token_exchange_request import (
    ItemPublicTokenExchangeRequest,
)
from plaid.model.item_remove_request import ItemRemoveRequest
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.products import Products

from ..config import get_settings

_HOSTS = {
    "sandbox": "https://sandbox.plaid.com",
    "production": "https://production.plaid.com",
}


def _client() -> plaid_api.PlaidApi:
    s = get_settings()
    if not s.plaid_client_id or not s.plaid_secret:
        raise RuntimeError("PLAID_CLIENT_ID / PLAID_SECRET not configured")
    host = _HOSTS.get(s.plaid_env)
    if host is None:
        raise RuntimeError(f"PLAID_ENV must be sandbox or production (got {s.plaid_env!r})")
    config = Configuration(
        host=host,
        api_key={"clientId": s.plaid_client_id, "secret": s.plaid_secret},
    )
    return plaid_api.PlaidApi(ApiClient(config))


def create_link_token(user_id: str = "jnvest-user") -> str:
    """Returns a short-lived link_token to bootstrap the Plaid Link flow on the frontend."""
    req = LinkTokenCreateRequest(
        user=LinkTokenCreateRequestUser(client_user_id=user_id),
        client_name="JnVest",
        products=[Products("investments")],
        country_codes=[CountryCode("US")],
        language="en",
    )
    resp = _client().link_token_create(req)
    return resp["link_token"]


def exchange_public_token(public_token: str) -> dict[str, str]:
    """After Plaid Link completes, exchange the public_token for a long-lived access_token."""
    resp = _client().item_public_token_exchange(
        ItemPublicTokenExchangeRequest(public_token=public_token)
    )
    return {"access_token": resp["access_token"], "item_id": resp["item_id"]}


def get_holdings(access_token: str) -> dict[str, Any]:
    """Returns Plaid's raw {accounts, holdings, securities, item} response."""
    resp = _client().investments_holdings_get(
        InvestmentsHoldingsGetRequest(access_token=access_token)
    )
    return resp.to_dict()


def remove_item(access_token: str) -> None:
    _client().item_remove(ItemRemoveRequest(access_token=access_token))
