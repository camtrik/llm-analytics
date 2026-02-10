from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml


def _config_dir() -> Path:
    return Path(__file__).resolve().parent


def _config_files_dir() -> Path:
    return _config_dir() / "files"


def _strategy_config_path() -> Path:
    return _config_files_dir() / "strategy.yaml"


@lru_cache(maxsize=1)
def load_strategy_config() -> dict[str, Any]:
    path = _strategy_config_path()
    if not path.exists():
        raise RuntimeError(f"Missing strategy config: {path}")
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise RuntimeError(f"Invalid strategy config format: {path}")
    return data


def get_low_volume_pullback_config() -> dict[str, Any]:
    cfg = load_strategy_config().get("low_volume_pullback")
    if not isinstance(cfg, dict):
        raise RuntimeError("strategy.yaml must contain a 'low_volume_pullback' object")
    if "timeframe" not in cfg:
        raise RuntimeError("strategy.yaml low_volume_pullback.timeframe is required")
    params = cfg.get("params")
    if not isinstance(params, dict):
        raise RuntimeError("strategy.yaml low_volume_pullback.params must be an object")
    missing = [key for key in ("fastMA", "slowMA", "longMA") if key not in params]
    if missing:
        raise RuntimeError(f"strategy.yaml missing required params keys: {', '.join(missing)}")
    return cfg


def resolve_universe_file(universe_file: str | None) -> Path | None:
    if not universe_file:
        return None
    path = Path(universe_file)
    if path.is_absolute():
        return path
    return _config_files_dir() / universe_file
