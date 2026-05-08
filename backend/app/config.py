from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
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

    @property
    def is_paper(self) -> bool:
        return "paper" in self.alpaca_base_url

    @property
    def trading_enabled(self) -> bool:
        return self.is_paper and bool(self.alpaca_api_key) and bool(self.alpaca_api_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()
