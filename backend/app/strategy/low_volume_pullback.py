from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, Iterator

import pandas as pd
import yaml

from app.config.settings import load_settings
from app.config.timeframes import TIMEFRAME_COMBOS
from app.data.market_cache import MarketCache
from app.errors import ApiError
from app.quant.engine import _bars_to_df
from app.strategy.strategy_config import get_low_volume_pullback_config


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


def _default_timeframe_from_config() -> str:
    cfg = get_low_volume_pullback_config()
    tf = cfg.get("timeframe")
    return str(tf).strip() if tf else "6M_1d"


def _default_params_from_config() -> LowVolumePullbackParams:
    defaults = LowVolumePullbackParams()
    cfg = get_low_volume_pullback_config()
    params_cfg = cfg.get("params", {})
    if not isinstance(params_cfg, dict):
        return defaults
    return LowVolumePullbackParams(
        fast_ma=int(params_cfg.get("fastMA", defaults.fast_ma)),
        slow_ma=int(params_cfg.get("slowMA", defaults.slow_ma)),
        long_ma=int(params_cfg.get("longMA", defaults.long_ma)),
        long_ma_slope_window=int(
            params_cfg.get("longMaSlopeWindow", defaults.long_ma_slope_window)
        ),
        long_ma_slope_min_pct=float(
            params_cfg.get("longMaSlopeMinPct", defaults.long_ma_slope_min_pct)
        ),
        vol_avg_window=int(params_cfg.get("volAvgWindow", defaults.vol_avg_window)),
        vol_ratio_max=float(params_cfg.get("volRatioMax", defaults.vol_ratio_max)),
        min_body_pct=float(params_cfg.get("minBodyPct", defaults.min_body_pct)),
        min_range_pct=params_cfg.get("minRangePct", defaults.min_range_pct),
        lookback_bars=int(params_cfg.get("lookbackBars", defaults.lookback_bars)),
        eps=float(params_cfg.get("eps", defaults.eps)),
    )


def screen_low_volume_pullback(
    tickers: Iterable[str],
    timeframe: str | None = None,
    params: LowVolumePullbackParams | None = None,
    cache: MarketCache | None = None,
) -> Iterator[dict[str, object]]:
    cfg_timeframe = timeframe or _default_timeframe_from_config()
    params = params or _default_params_from_config()
    tf_map = {tf.name: tf for tf in TIMEFRAME_COMBOS}
    if cfg_timeframe not in tf_map:
        raise ValueError(f"Unsupported timeframe: {cfg_timeframe}")

    if cache is None:
        settings = load_settings()
        cache = MarketCache(settings.runtime_dir / "market_cache", TIMEFRAME_COMBOS)

    for symbol in tickers:
        result: dict[str, object] = {"symbol": symbol, "triggered": False}
        try:
            bars = cache.get_bars(symbol, cfg_timeframe)
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
    df: pd.DataFrame, params: LowVolumePullbackParams, end_idx: int | None = None
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

    latest_idx = len(df) - 1
    if latest_idx < 0:
        return {"triggered": False, "error": "no_bars"}

    if end_idx is None:
        end_idx = latest_idx
    if end_idx < 0 or end_idx > latest_idx:
        return {"triggered": False, "error": "invalid_asof"}

    required_len = max(
        params.vol_avg_window + 1,
        params.long_ma + params.long_ma_slope_window,
        params.slow_ma,
        params.fast_ma,
        params.lookback_bars,
    )
    if end_idx + 1 < required_len:
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

    lookback_start = max(0, end_idx - params.lookback_bars + 1)

    hits: list[dict[str, object]] = []

    for idx in range(end_idx, lookback_start - 1, -1):
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


def backtest_low_volume_pullback_on_df(
    df: pd.DataFrame,
    params: LowVolumePullbackParams,
    cutoff_dt: datetime,
    horizon_bars: int,
    entry_execution: str,
) -> dict[str, object]:
    if df.empty:
        return {"triggered": False, "error": "no_bars"}
    end_pos = int(df.index.searchsorted(cutoff_dt, side="right") - 1)
    if end_pos < 0:
        return {"triggered": False, "error": "asof_out_of_range"}

    end_ts = int(df.index[end_pos].timestamp())
    detection = _detect_low_volume_pullback(df, params, end_idx=end_pos)
    if not detection.get("triggered"):
        return {
            "triggered": False,
            "error": detection.get("error"),
            "end_ts": end_ts,
            "end_idx": end_pos,
        }

    hits = detection.get("hits") or []
    if not isinstance(hits, list) or not hits:
        return {"triggered": False, "error": "no_hits", "end_ts": end_ts, "end_idx": end_pos}

    first_hit = hits[0]
    signal_idx = int(first_hit.get("bar_index"))
    signal_ts = int(first_hit.get("as_of"))
    vol_ratio = first_hit.get("vol_ratio")
    body_pct = first_hit.get("body_pct")

    close_series = df["Close"]
    open_series = df["Open"]

    if entry_execution == "close":
        entry_price = float(close_series.iloc[signal_idx])
    elif entry_execution == "next_open":
        entry_bar = signal_idx + 1
        if entry_bar >= len(df):
            return {
                "triggered": True,
                "error": "no_entry_bar",
                "end_ts": end_ts,
                "end_idx": end_pos,
                "signal_idx": signal_idx,
                "signal_ts": signal_ts,
                "entry_price": float("nan"),
                "vol_ratio": vol_ratio,
                "body_pct": body_pct,
                "forward": [],
            }
        entry_price = float(open_series.iloc[entry_bar])
    else:
        return {"triggered": False, "error": "invalid_entry_execution", "end_ts": end_ts, "end_idx": end_pos}

    forward: list[dict[str, object]] = []
    horizon = int(horizon_bars)
    for day in range(1, horizon + 1):
        idx = signal_idx + day
        if idx >= len(df):
            break
        close_val = float(close_series.iloc[idx])
        ts = int(df.index[idx].timestamp())
        ret = close_val / entry_price - 1 if entry_price else 0.0
        forward.append({"day": day, "ts": ts, "close": close_val, "return": float(ret)})

    return {
        "triggered": True,
        "end_ts": end_ts,
        "end_idx": end_pos,
        "signal_idx": signal_idx,
        "signal_ts": signal_ts,
        "entry_price": float(entry_price),
        "vol_ratio": float(vol_ratio) if vol_ratio is not None else None,
        "body_pct": float(body_pct) if body_pct is not None else None,
        "forward": forward,
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
