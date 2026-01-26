from __future__ import annotations

from typing import Iterable

from app.config.settings import load_settings
from app.config.data_config import (
    ALL_TICKERS,
    TIMEFRAME_COMBOS,
    TICKER_LABELS,
    WATCHLIST_LABELS,
    WATCHLIST_TICKERS,
)
from app.errors import ApiError
from app.config.timeframes import Timeframe
from app.data.market_cache import MarketCache
from collections import deque

from app.data.models import (
    BarsBatchResponse,
    BarsIndicatorsResponse,
    BarsResponse,
    ChartBarPayload,
    ChartMaConfig,
    UniverseResponse,
    RefreshFailure as RefreshFailureModel,
    RefreshResponse,
)
from app.strategy.schema import LowVolumePullbackParamsModel


class BarsRepository:
    def __init__(
        self,
        cache: MarketCache,
        max_limit: int,
        tickers: list[str],
        timeframes: list[Timeframe],
        ticker_labels: dict[str, str],
        watchlist_tickers: list[str],
        watchlist_labels: dict[str, str],
    ) -> None:
        self._cache = cache
        self._max_limit = max_limit
        self._tickers = tickers
        self._timeframes = timeframes
        self._ticker_labels = ticker_labels
        self._watchlist = watchlist_tickers
        self._watchlist_labels = watchlist_labels

    def _validate_limit(self, limit: int | None) -> None:
        if limit is None:
            return
        if limit <= 0:
            raise ApiError(
                status_code=400,
                error="invalid_request",
                message="limit must be greater than 0.",
                details={"limit": limit},
            )
        if limit > self._max_limit:
            raise ApiError(
                status_code=400,
                error="invalid_request",
                message="limit exceeds maximum.",
                details={"limit": limit, "maxLimit": self._max_limit},
            )

    def list_universe(self) -> UniverseResponse:
        tickers = sorted(self._tickers)
        timeframes = sorted([tf.name for tf in self._timeframes])

        return UniverseResponse(
            tickers=tickers,
            watchlist=self._watchlist,
            timeframes=timeframes,
            tickerInfo=dict(self._ticker_labels),
        )

    def refresh_data(self, tickers: list[str]) -> RefreshResponse:
        requested = list(tickers)
        succeeded, failed = self._cache.refresh(requested)
        return RefreshResponse(
            requested=requested,
            succeeded=succeeded,
            failed=[
                RefreshFailureModel(ticker=failure.ticker, reason=failure.reason)
                for failure in failed
            ],
        )

    def get_bars(self, ticker: str, timeframe: str, limit: int | None) -> BarsResponse:
        self._validate_limit(limit)
        if timeframe not in {tf.name for tf in self._timeframes}:
            raise ApiError(
                status_code=404,
                error="not_found",
                message="timeframe not found",
                details={"timeframe": timeframe},
            )
        if ticker not in self._tickers:
            raise ApiError(
                status_code=404,
                error="not_found",
                message="ticker not found",
                details={"ticker": ticker},
            )

        bars = self._cache.get_bars(ticker, timeframe)
        if limit is not None:
            bars = bars[-limit:]
        return BarsResponse(ticker=ticker, timeframe=timeframe, bars=bars)

    def get_bars_with_indicators(
        self,
        ticker: str,
        timeframe: str,
        limit: int | None,
        ma_fast: int | None,
        ma_slow: int | None,
        ma_long: int | None,
    ) -> BarsIndicatorsResponse:
        self._validate_limit(limit)
        if timeframe not in {tf.name for tf in self._timeframes}:
            raise ApiError(
                status_code=404,
                error="not_found",
                message="timeframe not found",
                details={"timeframe": timeframe},
            )
        if ticker not in self._tickers:
            raise ApiError(
                status_code=404,
                error="not_found",
                message="ticker not found",
                details={"ticker": ticker},
            )

        defaults = LowVolumePullbackParamsModel()
        fast = defaults.fastMA if ma_fast is None else ma_fast
        slow = defaults.slowMA if ma_slow is None else ma_slow
        long = defaults.longMA if ma_long is None else ma_long
        _validate_ma_window("maFast", fast)
        _validate_ma_window("maSlow", slow)
        _validate_ma_window("maLong", long)

        bars = self._cache.get_bars(ticker, timeframe)
        if not bars:
            return BarsIndicatorsResponse(
                ticker=ticker,
                timeframe=timeframe,
                ma=ChartMaConfig(fast=fast, slow=slow, long=long),
                bars=[],
            )

        closes = [bar.get("c") for bar in bars]
        ma_fast_series = _compute_sma_series(closes, fast)
        ma_slow_series = _compute_sma_series(closes, slow)
        ma_long_series = _compute_sma_series(closes, long)

        start = max(0, len(bars) - limit) if limit is not None else 0
        result_bars: list[ChartBarPayload] = []
        for idx in range(start, len(bars)):
            bar = bars[idx]
            result_bars.append(
                ChartBarPayload(
                    time=bar.get("time"),
                    t=int(bar.get("t") or 0),
                    o=float(bar.get("o") or 0.0),
                    h=float(bar.get("h") or 0.0),
                    l=float(bar.get("l") or 0.0),
                    c=float(bar.get("c") or 0.0),
                    v=float(bar.get("v") or 0.0),
                    maFast=ma_fast_series[idx],
                    maSlow=ma_slow_series[idx],
                    maLong=ma_long_series[idx],
                )
            )

        return BarsIndicatorsResponse(
            ticker=ticker,
            timeframe=timeframe,
            ma=ChartMaConfig(fast=fast, slow=slow, long=long),
            bars=result_bars,
        )

    def get_bars_batch(
        self, tickers: Iterable[str], timeframe: str, limit: int | None
    ) -> BarsBatchResponse:
        self._validate_limit(limit)
        if timeframe not in {tf.name for tf in self._timeframes}:
            raise ApiError(
                status_code=404,
                error="not_found",
                message="timeframe not found",
                details={"timeframe": timeframe},
            )
        tickers_list = list(tickers)
        unknown = [ticker for ticker in tickers_list if ticker not in self._tickers]
        if unknown:
            raise ApiError(
                status_code=400,
                error="invalid_request",
                message="Unknown ticker in request.",
                details={"unknown": unknown},
            )

        series = self._cache.get_bars_batch(tickers_list, timeframe)
        if limit is not None:
            series = {ticker: bars[-limit:] for ticker, bars in series.items()}
        return BarsBatchResponse(timeframe=timeframe, series=series)


_settings = load_settings()
_cache = MarketCache(_settings.runtime_dir / "market_cache", TIMEFRAME_COMBOS)
_repository = BarsRepository(
    _cache,
    _settings.max_limit,
    ALL_TICKERS,
    TIMEFRAME_COMBOS,
    TICKER_LABELS,
    WATCHLIST_TICKERS,
    WATCHLIST_LABELS,
)


def get_repository() -> BarsRepository:
    return _repository


def _validate_ma_window(name: str, value: int) -> None:
    if value < 1:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message=f"{name} must be >= 1.",
            details={name: value},
        )


def _compute_sma_series(values: list[float | None], window: int) -> list[float | None]:
    if window <= 0:
        return [None for _ in values]
    output: list[float | None] = [None] * len(values)
    running = 0.0
    queue: deque[float] = deque()
    for idx, value in enumerate(values):
        if not isinstance(value, (int, float)):
            running = 0.0
            queue.clear()
            output[idx] = None
            continue
        val = float(value)
        running += val
        queue.append(val)
        if len(queue) > window:
            running -= queue.popleft()
        if len(queue) == window:
            output[idx] = running / window
    return output
