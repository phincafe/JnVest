from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Load .env from the repo root (one level above backend/) OR backend/.env, in that order.
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_ENV_FILES = (_REPO_ROOT / ".env", _REPO_ROOT / "backend" / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=tuple(str(p) for p in _ENV_FILES),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_password: str = "changeme-please"
    session_secret: str = "dev-secret-change-me"

    database_url: str = "sqlite:///./jnvest.db"

    alpaca_api_key: str = ""
    alpaca_api_secret: str = ""
    alpaca_base_url: str = "https://paper-api.alpaca.markets"
    alpaca_data_url: str = "https://data.alpaca.markets"

    finnhub_api_key: str = ""
    fred_api_key: str = ""

    # Plaid Investments — sign up at https://dashboard.plaid.com
    plaid_client_id: str = ""
    plaid_secret: str = ""
    plaid_env: str = "sandbox"  # sandbox | production

    # SnapTrade — sign up at https://dashboard.snaptrade.com (free tier: 5 connections)
    snaptrade_client_id: str = ""
    snaptrade_consumer_key: str = ""

    @property
    def is_paper(self) -> bool:
        return "paper" in self.alpaca_base_url

    @property
    def trading_enabled(self) -> bool:
        return self.is_paper and bool(self.alpaca_api_key) and bool(self.alpaca_api_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()
