from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml


def _config_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "config"


def _strategy_config_path() -> Path:
    return _config_dir() / "strategy.yaml"


@lru_cache(maxsize=1)
def load_strategy_config() -> dict[str, Any]:
    path = _strategy_config_path()
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return data if isinstance(data, dict) else {}


def get_low_volume_pullback_config() -> dict[str, Any]:
    cfg = load_strategy_config().get("low_volume_pullback", {})
    return cfg if isinstance(cfg, dict) else {}


def resolve_universe_file(universe_file: str | None) -> Path | None:
    if not universe_file:
        return None
    path = Path(universe_file)
    if path.is_absolute():
        return path
    return _config_dir() / universe_file

