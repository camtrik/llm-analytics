from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, TypedDict

import yaml


class DefaultMaConfig(TypedDict):
    fast: int
    slow: int
    long: int

def _config_dir() -> Path:
    return Path(__file__).resolve().parent


def _indicators_config_path() -> Path:
    return _config_dir() / "files" / "default-indicators.yaml"


@lru_cache(maxsize=1)
def load_default_indicators_config() -> dict[str, Any]:
    path = _indicators_config_path()
    if not path.exists():
        raise RuntimeError(f"Missing indicators config: {path}")
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise RuntimeError(f"Invalid indicators config format: {path}")
    return data


def get_default_ma_config() -> DefaultMaConfig:
    raw = load_default_indicators_config().get("ma")
    if not isinstance(raw, dict):
        raise RuntimeError("default-indicators.yaml must contain a top-level 'ma' object")
    missing = [key for key in ("fast", "slow", "long") if key not in raw]
    if missing:
        raise RuntimeError(f"default-indicators.yaml missing required ma keys: {', '.join(missing)}")
    try:
        fast = int(raw["fast"])
        slow = int(raw["slow"])
        long = int(raw["long"])
    except (TypeError, ValueError) as exc:
        raise RuntimeError("ma.fast/ma.slow/ma.long must be integers") from exc
    if fast <= 0 or slow <= 0 or long <= 0:
        raise RuntimeError("ma.fast/ma.slow/ma.long must be > 0")
    return {
        "fast": fast,
        "slow": slow,
        "long": long,
    }
