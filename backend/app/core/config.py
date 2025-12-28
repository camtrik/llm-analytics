from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os


@dataclass(frozen=True)
class Settings:
    data_csv_path: Path
    runtime_dir: Path
    max_limit: int
    cache_ttl_seconds: int
    feed_max_tickers: int
    cors_origins: list[str]


def load_settings() -> Settings:
    repo_root = Path(__file__).resolve().parents[3]
    default_csv = repo_root / "data" / "stock_data.csv"
    data_csv_path = Path(os.getenv("DATA_CSV_PATH", str(default_csv)))
    runtime_dir = Path(os.getenv("RUNTIME_DIR", str(repo_root / "var")))
    max_limit = int(os.getenv("MAX_LIMIT", "5000"))
    cache_ttl_seconds = int(os.getenv("CACHE_TTL_SECONDS", "60"))
    feed_max_tickers = int(os.getenv("FEED_MAX_TICKERS", "50"))
    cors_origins_raw = os.getenv(
        "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    )
    cors_origins = [origin.strip() for origin in cors_origins_raw.split(",") if origin.strip()]
    return Settings(
        data_csv_path=data_csv_path,
        runtime_dir=runtime_dir,
        max_limit=max_limit,
        cache_ttl_seconds=cache_ttl_seconds,
        feed_max_tickers=feed_max_tickers,
        cors_origins=cors_origins,
    )
