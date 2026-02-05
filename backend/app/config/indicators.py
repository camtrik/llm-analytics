from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, TypedDict

import yaml


class DefaultMaConfig(TypedDict):
    fast: int
    slow: int
    long: int


_FALLBACK_MA: DefaultMaConfig = {"fast": 5, "slow": 10, "long": 60}


def _config_dir() -> Path:
    return Path(__file__).resolve().parent


def _indicators_config_path() -> Path:
    return _config_dir() / "default-indicators.yaml"


@lru_cache(maxsize=1)
def load_default_indicators_config() -> dict[str, Any]:
    path = _indicators_config_path()
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return data if isinstance(data, dict) else {}


def get_default_ma_config() -> DefaultMaConfig:
    raw = load_default_indicators_config().get("ma", {})
    if not isinstance(raw, dict):
        return dict(_FALLBACK_MA)
    return {
        "fast": int(raw.get("fast", _FALLBACK_MA["fast"])),
        "slow": int(raw.get("slow", _FALLBACK_MA["slow"])),
        "long": int(raw.get("long", _FALLBACK_MA["long"])),
    }

