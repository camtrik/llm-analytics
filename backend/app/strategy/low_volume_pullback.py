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
        eps=float(params_cfg.get("eps", defaults.eps)),
    )


def screen_low_volume_pullback(
    tickers: Iterable[str],
    timeframe: str | None = None,
    recent_bars: int = 3,
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

        hits = detect_low_volume_pullback_hits(df, params, end_idx=len(df) - 1, recent_bars=recent_bars)
        if hits.get("error"):
            result["error"] = hits.get("error")
            result["hits"] = []
            yield result
            continue
        result.update(hits)
        yield result


def _required_bars_for_low_volume_pullback(params: LowVolumePullbackParams) -> int:
    return max(
        params.vol_avg_window + 1,
        params.long_ma + params.long_ma_slope_window,
        params.slow_ma,
        params.fast_ma,
    )


def _compute_low_volume_pullback_series(
    df: pd.DataFrame,
    params: LowVolumePullbackParams,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    close = df["Close"].astype(float)
    open_ = df["Open"].astype(float)
    high = df["High"].astype(float)
    low = df["Low"].astype(float)
    volume = df["Volume"].astype(float)

    fast_ma = close.rolling(params.fast_ma, min_periods=params.fast_ma).mean()
    slow_ma = close.rolling(params.slow_ma, min_periods=params.slow_ma).mean()
    long_ma = close.rolling(params.long_ma, min_periods=params.long_ma).mean()

    open_denom = open_.where(open_ > params.eps, params.eps)
    body_pct = (close - open_).abs() / open_denom
    bearish_ok = (close < open_) & (body_pct >= params.min_body_pct)
    if params.min_range_pct is not None:
        range_pct = (high - low) / open_denom
        bearish_ok &= range_pct >= float(params.min_range_pct)

    slope_ref = long_ma.shift(params.long_ma_slope_window)
    trend_ok = (close > fast_ma) & (close > slow_ma) & (fast_ma > slow_ma)
    trend_ok &= long_ma > (slope_ref * (1 + params.long_ma_slope_min_pct))
    trend_ok = trend_ok.fillna(False)

    vol_avg = (
        volume.shift(1)
        .rolling(params.vol_avg_window, min_periods=params.vol_avg_window)
        .mean()
    )
    vol_ok = vol_avg.notna() & (vol_avg > 0) & volume.notna() & (volume > 0)
    vol_ratio = (volume / vol_avg).where(vol_ok)
    volume_ok = vol_ok & vol_ratio.notna() & (vol_ratio <= params.vol_ratio_max)
    volume_ok = volume_ok.fillna(False)

    hit = (trend_ok & bearish_ok & volume_ok).fillna(False)
    return hit, vol_ratio, body_pct


def detect_low_volume_pullback_hits(
    df: pd.DataFrame,
    params: LowVolumePullbackParams,
    end_idx: int,
    recent_bars: int,
) -> dict[str, object]:
    """Collect hits within the last `recent_bars` ending at `end_idx` (inclusive)."""
    latest_idx = len(df) - 1
    if latest_idx < 0:
        return {"triggered": False, "error": "no_bars", "hits": []}
    if end_idx < 0 or end_idx > latest_idx:
        return {"triggered": False, "error": "invalid_asof", "hits": []}

    required_len = _required_bars_for_low_volume_pullback(params)
    if end_idx + 1 < required_len:
        return {"triggered": False, "error": "insufficient_bars", "hits": []}

    hit, vol_ratio, body_pct = _compute_low_volume_pullback_series(df, params)

    window = max(1, int(recent_bars))
    start_idx = max(required_len - 1, end_idx - window + 1)

    hits: list[dict[str, object]] = []
    for idx in range(end_idx, start_idx - 1, -1):
        if not bool(hit.iloc[idx]):
            continue
        ts = int(df.index[idx].timestamp())
        vr = vol_ratio.iloc[idx]
        bp = body_pct.iloc[idx]
        hits.append(
            {
                "bar_index": idx,
                "as_of": ts,
                "vol_ratio": float(vr) if pd.notna(vr) else None,
                "body_pct": float(bp) if pd.notna(bp) else None,
            }
        )

    if not hits:
        return {"triggered": False, "hits": []}

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
    recent_bars: int,
    horizon_bars: int,
    entry_execution: str,
) -> dict[str, object]:
    if df.empty:
        return {"triggered": False, "error": "no_bars"}
    end_pos = int(df.index.searchsorted(cutoff_dt, side="right") - 1)
    if end_pos < 0:
        return {"triggered": False, "error": "asof_out_of_range"}

    end_ts = int(df.index[end_pos].timestamp())

    detection = detect_low_volume_pullback_hits(
        df,
        params,
        end_idx=end_pos,
        recent_bars=recent_bars,
    )
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


def backtest_low_volume_pullback_range_on_df(
    df: pd.DataFrame,
    params: LowVolumePullbackParams,
    start_dt: datetime,
    end_dt: datetime,
    horizon_bars: int,
    entry_execution: str,
    bucket_threshold_pct: float,
) -> dict[str, object]:
    """Compute range backtest stats on a single ticker DataFrame.

    Why this precomputes the per-bar `hit` series:
    - Range backtest evaluates many asOf indices (days × tickers). Recomputing rolling
      indicators per asOf (even via helpers like `detect_low_volume_pullback_hits`) would
      redo MA/VOL_AVG/BODY_PCT calculations repeatedly and be much slower.
    - Range backtest only needs `hit[idx]` booleans + forward return buckets, so we compute
      indicator series once and then iterate indices.

    Returns counts only (service layer converts counts to rates).
    """
    horizon = int(horizon_bars)
    if horizon < 1:
        return {"error": "invalid_horizon"}
    if df.empty:
        return {
            "evaluated_bars": 0,
            "triggered_events": 0,
            "sample_count_by_day": {day: 0 for day in range(1, horizon + 1)},
            "win_count_by_day": {day: 0 for day in range(1, horizon + 1)},
            "bucket_count_by_day": {
                day: {"down_gt_5": 0, "down_0_5": 0, "up_0_5": 0, "up_gt_5": 0}
                for day in range(1, horizon + 1)
            },
        }

    latest_idx = len(df) - 1
    start_pos = int(df.index.searchsorted(start_dt, side="left"))
    end_pos = int(df.index.searchsorted(end_dt, side="right") - 1)
    if end_pos < 0 or start_pos > latest_idx or end_pos < start_pos:
        return {
            "evaluated_bars": 0,
            "triggered_events": 0,
            "sample_count_by_day": {day: 0 for day in range(1, horizon + 1)},
            "win_count_by_day": {day: 0 for day in range(1, horizon + 1)},
            "bucket_count_by_day": {
                day: {"down_gt_5": 0, "down_0_5": 0, "up_0_5": 0, "up_gt_5": 0}
                for day in range(1, horizon + 1)
            },
        }

    close = df["Close"].astype(float)
    open_ = df["Open"].astype(float)

    required_len = _required_bars_for_low_volume_pullback(params)

    eval_start = max(start_pos, required_len - 1)
    if eval_start > end_pos:
        return {
            "evaluated_bars": 0,
            "triggered_events": 0,
            "sample_count_by_day": {day: 0 for day in range(1, horizon + 1)},
            "win_count_by_day": {day: 0 for day in range(1, horizon + 1)},
            "bucket_count_by_day": {
                day: {"down_gt_5": 0, "down_0_5": 0, "up_0_5": 0, "up_gt_5": 0}
                for day in range(1, horizon + 1)
            },
        }

    hit, _, _ = _compute_low_volume_pullback_series(df, params)

    sample_count_by_day: dict[int, int] = {day: 0 for day in range(1, horizon + 1)}
    win_count_by_day: dict[int, int] = {day: 0 for day in range(1, horizon + 1)}
    bucket_count_by_day: dict[int, dict[str, int]] = {
        day: {"down_gt_5": 0, "down_0_5": 0, "up_0_5": 0, "up_gt_5": 0}
        for day in range(1, horizon + 1)
    }

    evaluated_bars = 0
    triggered_events = 0
    threshold = float(bucket_threshold_pct)
    tol = max(float(params.eps), 1e-12)

    for asof_idx in range(eval_start, end_pos + 1):
        evaluated_bars += 1

        if not bool(hit.iloc[asof_idx]):
            continue

        triggered_events += 1

        if entry_execution == "close":
            entry_price = float(close.iloc[asof_idx])
        elif entry_execution == "next_open":
            entry_bar = asof_idx + 1
            if entry_bar >= len(df):
                continue
            entry_price = float(open_.iloc[entry_bar])
        else:
            return {"error": "invalid_entry_execution"}

        if not pd.notna(entry_price) or entry_price <= 0:
            continue

        for day in range(1, horizon + 1):
            fwd_idx = asof_idx + day
            if fwd_idx >= len(df):
                break
            close_val = float(close.iloc[fwd_idx])
            if not pd.notna(close_val):
                break
            ret = close_val / entry_price - 1

            sample_count_by_day[day] += 1
            if ret > 0:
                win_count_by_day[day] += 1

            if ret <= (-threshold + tol):
                bucket = "down_gt_5"
            elif ret < -tol:
                bucket = "down_0_5"
            elif ret <= threshold + tol:
                bucket = "up_0_5"
            else:
                bucket = "up_gt_5"
            bucket_count_by_day[day][bucket] += 1

    return {
        "evaluated_bars": evaluated_bars,
        "triggered_events": triggered_events,
        "sample_count_by_day": sample_count_by_day,
        "win_count_by_day": win_count_by_day,
        "bucket_count_by_day": bucket_count_by_day,
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
