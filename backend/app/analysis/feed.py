from __future__ import annotations

from datetime import datetime, timezone

from app.analysis.models import FeedMeta, FeedResponse, OhlcvByTimeframe, TimeframeMeta
from app.config.settings import load_settings
from app.config.data_config import ALL_TICKERS
from app.core.errors import ApiError
from app.config.timeframes import FEED_TIMEFRAMES, TIMEFRAME_COMBOS, Timeframe
from app.data.market_cache import MarketCache
from app.data.models import Bar
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
    cache = MarketCache(settings.runtime_dir / "market_cache", TIMEFRAME_COMBOS)
    ohlcv: OhlcvByTimeframe = {}
    timeframe_meta: dict[str, TimeframeMeta] = {}

    for timeframe_name in FEED_TIMEFRAMES:
        timeframe = timeframe_map.get(timeframe_name)
        if not timeframe:
            raise ApiError(
                status_code=500,
                error="config_error",
                message="Timeframe not configured.",
                details={"timeframe": timeframe_name},
            )
        bars_map = _load_timeframe_bars(cache, timeframe, tickers)
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
    cache: MarketCache,
    timeframe: Timeframe,
    tickers: list[str],
) -> dict[str, list[dict[str, object]]]:
    return cache.get_bars_batch(tickers, timeframe.name)


def _summarize_timeframe(bars_map: dict[str, list[Bar]]) -> TimeframeMeta:
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


def _extract_ts(bar: Bar) -> int | None:
    ts = bar.get("t")
    if isinstance(ts, (int, float)):
        return int(ts)
    time_value = bar.get("time")
    if isinstance(time_value, str):
        try:
            dt = datetime.fromisoformat(time_value.replace("Z", "+00:00"))
            return int(dt.timestamp())
        except ValueError:
            return None
    return None
