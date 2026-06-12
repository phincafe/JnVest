"""Sanitized client-facing strings for external-provider failures.

httpx exception messages embed the full request URL. Finnhub authenticates
via a ?token= query param, so returning str(e) to the client leaks the API
key the moment Finnhub errors (rate limits do this daily on the free tier).
Other providers (Alpaca, SnapTrade, Yahoo) keep credentials in headers but
their exception strings still expose internal URLs and request details.

Rule: log the real exception server-side, hand the client a generic string.
"""

import logging

logger = logging.getLogger("jnvest.providers")


def provider_error(provider: str, e: Exception) -> str:
    """Log the real error; return a safe message for API responses."""
    logger.warning("%s call failed: %r", provider, e)
    return f"{provider} is temporarily unavailable — try again shortly."
