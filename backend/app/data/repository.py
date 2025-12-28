from __future__ import annotations

from typing import Iterable

import pandas as pd

from app.core.config import load_settings
from app.core.data_config import ALL_TICKERS, TIMEFRAME_COMBOS, TICKER_LABELS
from app.core.errors import ApiError
from app.data.market_cache import MarketDataCache


class BarsRepository:
    def __init__(
        self,
        cache: MarketDataCache,
        max_limit: int,
        tickers: list[str],
        timeframes: list[object],
        ticker_labels: dict[str, str],
    ) -> None:
        self._cache = cache
        self._max_limit = max_limit
        self._tickers = tickers
        self._timeframes = timeframes
        self._ticker_labels = ticker_labels

    def _ensure_timestamp(self, df: pd.DataFrame) -> pd.DataFrame:
        if "ts" in df.columns:
            return df
        if "_ts" in df.columns:
            df = df.rename(columns={"_ts": "ts"})
            return df
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
        df["ts"] = ts
        df["ts"] = df["ts"].where(dt.notna())
        return df

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

    def _get_live_df(
        self, refresh: bool = False, tickers: list[str] | None = None
    ) -> pd.DataFrame:
        try:
            df = self._cache.get_df(refresh=refresh, tickers=tickers)
        except RuntimeError as exc:
            raise ApiError(
                status_code=409,
                error="data_not_ready",
                message="Market data cache is empty. Call /api/refresh first.",
            ) from exc
        except Exception as exc:
            raise ApiError(
                status_code=500,
                error="data_error",
                message="Failed to download data from yfinance.",
            ) from exc
        return self._ensure_timestamp(df)

    def _dataset_stats(self, df: pd.DataFrame) -> dict[str, int | None]:
        ts_series = df["ts"].dropna()
        min_ts = int(ts_series.min()) if not ts_series.empty else None
        max_ts = int(ts_series.max()) if not ts_series.empty else None
        return {
            "rowCount": int(len(df)),
            "minDatetime": min_ts,
            "maxDatetime": max_ts,
        }

    def list_options(self) -> dict[str, object]:
        df = self._cache.snapshot()
        tickers = sorted(self._tickers)
        timeframes = sorted([tf.name for tf in self._timeframes])

        if df is not None and not df.empty:
            df = self._ensure_timestamp(df)
            stats = self._dataset_stats(df)
            row_count = stats["rowCount"]
            min_ts = stats["minDatetime"]
            max_ts = stats["maxDatetime"]
        else:
            min_ts = None
            max_ts = None
            row_count = 0

        return {
            "tickers": tickers,
            "timeframes": timeframes,
            "tickerInfo": dict(self._ticker_labels),
            "dataset": {
                "source": "yfinance",
                "rowCount": row_count,
                "minDatetime": min_ts,
                "maxDatetime": max_ts,
            },
        }

    def refresh_data(self, tickers: list[str] | None = None) -> dict[str, int | None]:
        df = self._get_live_df(refresh=True, tickers=tickers)
        return self._dataset_stats(df)

    def get_bars(self, ticker: str, timeframe: str, limit: int | None) -> dict[str, object]:
        self._validate_limit(limit)
        df = self._get_live_df(refresh=False)

        if timeframe not in set(df["Timeframe"].dropna().unique().tolist()):
            raise ApiError(
                status_code=404,
                error="not_found",
                message="timeframe not found",
                details={"timeframe": timeframe},
            )

        filtered = df[
            (df["Ticker"] == ticker)
            & (df["Timeframe"] == timeframe)
            & df["ts"].notna()
        ]
        if filtered.empty:
            raise ApiError(
                status_code=404,
                error="not_found",
                message="ticker not found for timeframe",
                details={"ticker": ticker, "timeframe": timeframe},
            )

        filtered = filtered.sort_values("ts").drop_duplicates(subset="ts", keep="last")
        if limit is not None:
            filtered = filtered.tail(limit)

        bars = self._rows_to_bars(filtered.itertuples(index=False))
        return {"ticker": ticker, "timeframe": timeframe, "bars": bars}

    def get_bars_batch(
        self, tickers: Iterable[str], timeframe: str, limit: int | None
    ) -> dict[str, object]:
        self._validate_limit(limit)
        df = self._get_live_df(refresh=False)

        if timeframe not in set(df["Timeframe"].dropna().unique().tolist()):
            raise ApiError(
                status_code=404,
                error="not_found",
                message="timeframe not found",
                details={"timeframe": timeframe},
            )

        series: dict[str, list[dict[str, object]]] = {}
        for ticker in tickers:
            filtered = df[
                (df["Ticker"] == ticker)
                & (df["Timeframe"] == timeframe)
                & df["ts"].notna()
            ]
            if filtered.empty:
                series[ticker] = []
                continue

            filtered = filtered.sort_values("ts").drop_duplicates(subset="ts", keep="last")
            if limit is not None:
                filtered = filtered.tail(limit)
            series[ticker] = self._rows_to_bars(filtered.itertuples(index=False))

        return {"timeframe": timeframe, "series": series}

    def _rows_to_bars(self, rows) -> list[dict[str, object]]:
        bars: list[dict[str, object]] = []
        for row in rows:
            ts = getattr(row, "ts", None)
            if pd.isna(ts):
                continue
            bars.append(
                {
                    "t": int(ts),
                    "o": float(row.Open),
                    "h": float(row.High),
                    "l": float(row.Low),
                    "c": float(row.Close),
                    "v": float(row.Volume) if not pd.isna(row.Volume) else 0.0,
                }
            )
        return bars


_settings = load_settings()
_cache = MarketDataCache()
_repository = BarsRepository(
    _cache, _settings.max_limit, ALL_TICKERS, TIMEFRAME_COMBOS, TICKER_LABELS
)


def get_repository() -> BarsRepository:
    return _repository
