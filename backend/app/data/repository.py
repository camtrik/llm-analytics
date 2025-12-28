from __future__ import annotations

from typing import Iterable

from app.config.settings import load_settings
from app.config.data_config import ALL_TICKERS, TIMEFRAME_COMBOS, TICKER_LABELS
from app.errors import ApiError
from app.config.timeframes import Timeframe
from app.data.market_cache import MarketCache
from app.data.models import (
    BarsBatchResponse,
    BarsResponse,
    OptionsResponse,
    RefreshFailure as RefreshFailureModel,
    RefreshResponse,
)


class BarsRepository:
    def __init__(
        self,
        cache: MarketCache,
        max_limit: int,
        tickers: list[str],
        timeframes: list[Timeframe],
        ticker_labels: dict[str, str],
    ) -> None:
        self._cache = cache
        self._max_limit = max_limit
        self._tickers = tickers
        self._timeframes = timeframes
        self._ticker_labels = ticker_labels

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

    def list_options(self) -> OptionsResponse:
        tickers = sorted(self._tickers)
        timeframes = sorted([tf.name for tf in self._timeframes])

        return OptionsResponse(
            tickers=tickers,
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
    _cache, _settings.max_limit, ALL_TICKERS, TIMEFRAME_COMBOS, TICKER_LABELS
)


def get_repository() -> BarsRepository:
    return _repository
