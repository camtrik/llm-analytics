from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os

import yaml


@dataclass(frozen=True)
class Settings:
    runtime_dir: Path
    max_limit: int
    feed_max_tickers: int
    cors_origins: list[str]


def load_settings() -> Settings:
    repo_root = Path(__file__).resolve().parents[3]
    default_config = Path(__file__).with_name("config.yaml")
    config_path = Path(os.getenv("SETTINGS_PATH", str(default_config)))
    if not config_path.exists():
        raise FileNotFoundError(f"Settings file not found: {config_path}")
    data = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError("Settings file must contain a mapping at the top level.")

    runtime_dir_value = data.get("runtime_dir", "var")
    runtime_dir = Path(str(runtime_dir_value))
    if not runtime_dir.is_absolute():
        runtime_dir = repo_root / runtime_dir

    max_limit = int(data.get("max_limit", 5000))
    feed_max_tickers = int(data.get("feed_max_tickers", 50))

    cors_origins_raw = data.get(
        "cors_origins",
        ["http://localhost:3000", "http://127.0.0.1:3000"],
    )
    if isinstance(cors_origins_raw, str):
        cors_origins = [item.strip() for item in cors_origins_raw.split(",") if item.strip()]
    else:
        cors_origins = [str(item).strip() for item in cors_origins_raw if str(item).strip()]
    return Settings(
        runtime_dir=runtime_dir,
        max_limit=max_limit,
        feed_max_tickers=feed_max_tickers,
        cors_origins=cors_origins,
    )
