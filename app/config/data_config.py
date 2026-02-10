from __future__ import annotations

from pathlib import Path

import yaml

from app.config.timeframes import TIMEFRAME_COMBOS


def _config_files_dir() -> Path:
    return Path(__file__).resolve().parent / "files"


def _load_tickers() -> dict[str, str]:
    path = _config_files_dir() / "watchlist.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    mapping: dict[str, str] = {}
    for item in data.get("tickers", []) or []:
        symbol = str(item.get("symbol", "")).strip()
        name = str(item.get("name", "")).strip()
        if symbol:
            mapping[symbol] = name or symbol
    return mapping


def _load_nikkei225() -> dict[str, str]:
    path = _config_files_dir() / "nikkei225.yml"
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    mapping: dict[str, str] = {}
    for item in data.get("tickers", []) or []:
        symbol = str(item.get("symbol", "")).strip()
        name = str(item.get("name", "")).strip()
        if symbol:
            mapping[symbol] = name or symbol
    return mapping


WATCHLIST_LABELS = _load_tickers()
NIKKEI_LABELS = _load_nikkei225()

TICKER_LABELS = {**NIKKEI_LABELS, **WATCHLIST_LABELS}
ALL_TICKERS = sorted(TICKER_LABELS.keys())
WATCHLIST_TICKERS = sorted(WATCHLIST_LABELS.keys())
