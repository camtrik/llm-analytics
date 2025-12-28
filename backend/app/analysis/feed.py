from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable

import pandas as pd

from app.analysis.models import FeedMeta, FeedResponse, TimeframeMeta
from app.core.config import load_settings
from app.core.data_config import ALL_TICKERS
from app.core.errors import ApiError
from app.core.timeframes import FEED_TIMEFRAMES_TTL, TIMEFRAME_COMBOS, Timeframe
from app.data.downloader import download_timeframe
from app.data.file_cache import JsonFileCache
from app.portfolio.store import get_portfolio_store


def build_feed(
    date: datetime | None,
    tradable_tickers: list[str],
    include_positions: bool,
) -> FeedResponse:
    settings = load_settings()
    if not tradable_tickers:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="tradableTickers is required.",
        )
    tickers = _resolve_tickers(tradable_tickers, settings.feed_max_tickers)
    timeframe_map = {tf.name: tf for tf in TIMEFRAME_COMBOS}
    cache = JsonFileCache(settings.runtime_dir / "market_cache")
    ohlcv: dict[str, dict[str, list[dict[str, object]]]] = {}
    timeframe_meta: dict[str, TimeframeMeta] = {}

    for timeframe_name, default_ttl in FEED_TIMEFRAMES_TTL.items():
        timeframe = timeframe_map.get(timeframe_name)
        if not timeframe:
            raise ApiError(
                status_code=500,
                error="config_error",
                message="Timeframe not configured.",
                details={"timeframe": timeframe_name},
            )
        ttl_seconds = max(settings.cache_ttl_seconds, default_ttl)
        bars_map = _load_timeframe_bars(cache, timeframe, tickers, ttl_seconds)
        ohlcv[timeframe_name] = bars_map
        timeframe_meta[timeframe_name] = _summarize_timeframe(bars_map)

    positions = []
    if include_positions:
        portfolio = get_portfolio_store().load()
        positions = portfolio.positions

    payload_date = date or datetime.now(timezone.utc)
    meta = FeedMeta(
        generatedAt=datetime.now(timezone.utc),
        timeframes=timeframe_meta,
    )
    return FeedResponse(
        date=payload_date,
        positions=positions,
        tradableTickers=tickers,
        ohlcv=ohlcv,
        meta=meta,
    )


def _resolve_tickers(
    requested: list[str], max_tickers: int
) -> list[str]:
    tickers = requested
    unknown = [ticker for ticker in tickers if ticker not in ALL_TICKERS]
    if unknown:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="Unknown ticker in tradableTickers.",
            details={"unknown": unknown},
        )
    if len(tickers) > max_tickers:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="Too many tickers requested.",
            details={"count": len(tickers), "max": max_tickers},
        )
    return list(tickers)


def _load_timeframe_bars(
    cache: JsonFileCache,
    timeframe: Timeframe,
    tickers: list[str],
    ttl_seconds: int,
) -> dict[str, list[dict[str, object]]]:
    results: dict[str, list[dict[str, object]]] = {}
    missing: list[str] = []
    for ticker in tickers:
        cached = cache.load(timeframe.name, ticker, ttl_seconds)
        if cached and isinstance(cached.get("bars"), list):
            results[ticker] = cached["bars"]
        else:
            missing.append(ticker)

    if missing:
        df = download_timeframe(missing, timeframe)
        bars_by_ticker = _df_to_bars(df)
        for ticker in missing:
            bars = bars_by_ticker.get(ticker, [])
            cache.save(
                timeframe.name,
                ticker,
                _build_cache_payload(ticker, timeframe, bars),
            )
            results[ticker] = bars

    return results


def _df_to_bars(df: pd.DataFrame) -> dict[str, list[dict[str, object]]]:
    if df.empty:
        return {}
    df = _ensure_timestamp(df)
    results: dict[str, list[dict[str, object]]] = {}
    for ticker, group in df.groupby("Ticker"):
        group = group.sort_values("ts").drop_duplicates(subset="ts", keep="last")
        bars: list[dict[str, object]] = []
        for row in group.itertuples(index=False):
            ts = getattr(row, "ts", None)
            if pd.isna(ts):
                continue
            iso_time = datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
            bars.append(
                {
                    "time": iso_time,
                    "o": float(row.Open),
                    "h": float(row.High),
                    "l": float(row.Low),
                    "c": float(row.Close),
                    "v": float(row.Volume) if not pd.isna(row.Volume) else 0.0,
                }
            )
        results[str(ticker)] = bars
    return results


def _ensure_timestamp(df: pd.DataFrame) -> pd.DataFrame:
    if "Datetime" not in df.columns:
        raise ApiError(
            status_code=500,
            error="data_error",
            message="Datetime column missing in dataset.",
            details={"columns": list(df.columns)},
        )
    raw = df["Datetime"].astype(str)
    normalized = raw.str.replace(r"\+00:00$", "", regex=True)
    dt = pd.to_datetime(normalized, utc=True, errors="coerce")
    ts = dt.astype("int64") // 1_000_000_000
    df = df.copy()
    df["ts"] = ts
    df["ts"] = df["ts"].where(dt.notna())
    return df


def _summarize_timeframe(
    bars_map: dict[str, list[dict[str, object]]]
) -> TimeframeMeta:
    timestamps: list[int] = []
    for bars in bars_map.values():
        for bar in bars:
            ts = _extract_ts(bar)
            if ts is not None:
                timestamps.append(ts)
    if not timestamps:
        return TimeframeMeta(minTs=None, maxTs=None, barCount=0)
    return TimeframeMeta(
        minTs=min(timestamps),
        maxTs=max(timestamps),
        barCount=len(timestamps),
    )


def _build_cache_payload(
    ticker: str, timeframe: Timeframe, bars: Iterable[dict[str, object]]
) -> dict[str, object]:
    timestamps = []
    for bar in bars:
        ts = _extract_ts(bar)
        if ts is not None:
            timestamps.append(ts)
    min_ts = min(timestamps) if timestamps else None
    max_ts = max(timestamps) if timestamps else None
    min_time = (
        datetime.fromtimestamp(min_ts, tz=timezone.utc).isoformat()
        if min_ts is not None
        else None
    )
    max_time = (
        datetime.fromtimestamp(max_ts, tz=timezone.utc).isoformat()
        if max_ts is not None
        else None
    )
    return {
        "meta": {
            "ticker": ticker,
            "timeframe": timeframe.name,
            "period": timeframe.period,
            "interval": timeframe.interval,
            "source": "yfinance",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "minTs": min_ts,
            "maxTs": max_ts,
            "minTime": min_time,
            "maxTime": max_time,
        },
        "bars": list(bars),
    }


def _extract_ts(bar: dict[str, object]) -> int | None:
    ts = bar.get("t")
    if isinstance(ts, int):
        return ts
    time_value = bar.get("time")
    if isinstance(time_value, str):
        try:
            dt = datetime.fromisoformat(time_value.replace("Z", "+00:00"))
            return int(dt.timestamp())
        except ValueError:
            return None
    return None
