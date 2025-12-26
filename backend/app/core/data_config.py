from __future__ import annotations

from pathlib import Path

import yaml

from app.core.timeframes import TIMEFRAME_COMBOS


def _load_tickers() -> dict[str, str]:
    path = Path(__file__).with_name("tickers.yaml")
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    mapping: dict[str, str] = {}
    for group in ("core", "optional"):
        for item in data.get(group, []) or []:
            symbol = str(item.get("symbol", "")).strip()
            name = str(item.get("name", "")).strip()
            if symbol:
                mapping[symbol] = name or symbol
    return mapping


TICKER_LABELS = _load_tickers()
ALL_TICKERS = list(TICKER_LABELS.keys())
