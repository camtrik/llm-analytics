from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator

import pandas as pd
import yaml

from app.config.settings import load_settings
from app.config.timeframes import TIMEFRAME_COMBOS
from app.data.market_cache import MarketCache
from app.errors import ApiError
from app.quant.engine import _bars_to_df


@dataclass(frozen=True)
class LowVolumePullbackParams:
    fast_ma: int = 5
    slow_ma: int = 10
    long_ma: int = 60
    long_ma_slope_window: int = 3
    long_ma_slope_min_pct: float = 0.0
    vol_avg_window: int = 5
    vol_ratio_max: float = 0.5
    min_body_pct: float = 0.002
    min_range_pct: float | None = None
    lookback_bars: int = 3
    eps: float = 1e-12


def load_tickers(path: Path) -> list[dict[str, str]]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    raw = data.get("tickers", [])
    items: list[dict[str, str]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        symbol = str(entry.get("symbol") or "").strip()
        name = str(entry.get("name") or "").strip()
        if symbol:
            items.append({"symbol": symbol, "name": name})
    return items


def screen_low_volume_pullback(
    tickers: Iterable[str],
    timeframe: str = "6M_1d",
    params: LowVolumePullbackParams | None = None,
    cache: MarketCache | None = None,
) -> Iterator[dict[str, object]]:
    params = params or LowVolumePullbackParams()
    tf_map = {tf.name: tf for tf in TIMEFRAME_COMBOS}
    if timeframe not in tf_map:
        raise ValueError(f"Unsupported timeframe: {timeframe}")

    if cache is None:
        settings = load_settings()
        cache = MarketCache(settings.runtime_dir / "market_cache", TIMEFRAME_COMBOS)

    for symbol in tickers:
        result: dict[str, object] = {"symbol": symbol, "triggered": False}
        try:
            bars = cache.get_bars(symbol, timeframe)
        except ApiError as exc:
            result["error"] = str(exc)
            yield result
            continue

        df = _bars_to_df(bars)
        if df.empty:
            result["error"] = "no_bars"
            yield result
            continue

        detection = _detect_low_volume_pullback(df, params)
        result.update(detection)
        yield result


def _detect_low_volume_pullback(
    df: pd.DataFrame, params: LowVolumePullbackParams
) -> dict[str, object]:
    close = df["Close"]
    open_ = df["Open"]
    high = df["High"]
    low = df["Low"]
    volume = df["Volume"]

    max_window = max(
        params.fast_ma,
        params.slow_ma,
        params.long_ma,
        params.vol_avg_window,
    )
    if len(df) < max_window + params.lookback_bars:
        return {"triggered": False, "error": "insufficient_bars"}

    fast_ma = close.rolling(params.fast_ma, min_periods=params.fast_ma).mean()
    slow_ma = close.rolling(params.slow_ma, min_periods=params.slow_ma).mean()
    long_ma = close.rolling(params.long_ma, min_periods=params.long_ma).mean()

    def _trend_ok(idx: int) -> bool:
        if pd.isna(fast_ma.iloc[idx]) or pd.isna(slow_ma.iloc[idx]) or pd.isna(long_ma.iloc[idx]):
            return False
        if close.iloc[idx] <= fast_ma.iloc[idx] or close.iloc[idx] <= slow_ma.iloc[idx]:
            return False
        if fast_ma.iloc[idx] <= slow_ma.iloc[idx]:
            return False
        slope_idx = idx - params.long_ma_slope_window
        if slope_idx < 0 or pd.isna(long_ma.iloc[slope_idx]):
            return False
        return long_ma.iloc[idx] > long_ma.iloc[slope_idx] * (1 + params.long_ma_slope_min_pct)

    latest_idx = len(df) - 1
    lookback_start = max(0, latest_idx - params.lookback_bars + 1)

    hits: list[dict[str, object]] = []

    for idx in range(latest_idx, lookback_start - 1, -1):
        if idx < params.vol_avg_window:
            continue
        if not _trend_ok(idx):
            continue
        o = open_.iloc[idx]
        c = close.iloc[idx]
        h = high.iloc[idx]
        l = low.iloc[idx]
        body_pct = abs(c - o) / max(o, params.eps)
        if c >= o or body_pct < params.min_body_pct:
            continue
        if params.min_range_pct is not None:
            range_pct = (h - l) / max(o, params.eps)
            if range_pct < params.min_range_pct:
                continue

        vol_slice = volume.iloc[idx - params.vol_avg_window : idx]
        vol_avg = vol_slice.mean()
        if pd.isna(vol_avg) or vol_avg <= 0:
            continue
        vol_ratio = volume.iloc[idx] / vol_avg if vol_avg else float("inf")
        if vol_ratio > params.vol_ratio_max:
            continue

        ts = int(df.index[idx].timestamp())
        hits.append(
            {
                "bar_index": idx,
                "as_of": ts,
                "vol_ratio": float(vol_ratio),
                "body_pct": float(body_pct),
            }
        )

    if not hits:
        return {"triggered": False, "hits": []}

    # hits are gathered from most recent to older; keep summary fields for compatibility
    latest_hit = hits[0]
    return {
        "triggered": True,
        "bar_index": latest_hit["bar_index"],
        "as_of": latest_hit["as_of"],
        "vol_ratio": latest_hit["vol_ratio"],
        "body_pct": latest_hit["body_pct"],
        "hits": hits,
    }


if __name__ == "__main__":
    # Simple CLI for ad-hoc screening.
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Screen tickers for low-volume pullback.")
    parser.add_argument(
        "--list",
        type=str,
        default="backend/app/config/nikkei225.yml",
        help="YAML file with tickers list (tickers: [{symbol, name}]).",
    )
    parser.add_argument("--timeframe", type=str, default="6M_1d")
    parser.add_argument("--only-triggered", action="store_true")
    args = parser.parse_args()

    tickers_meta = load_tickers(Path(args.list))
    symbols = [item["symbol"] for item in tickers_meta]
    name_map = {item["symbol"]: item.get("name", "") for item in tickers_meta}

    results = list(screen_low_volume_pullback(symbols, timeframe=args.timeframe))
    if args.only_triggered:
        results = [r for r in results if r.get("triggered")]

    for entry in results:
        sym = entry.get("symbol", "")
        entry["name"] = name_map.get(sym, "")
    print(json.dumps(results, ensure_ascii=False, indent=2))
