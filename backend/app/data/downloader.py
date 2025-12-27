from __future__ import annotations

import pandas as pd
import yfinance as yf

from app.core.data_config import ALL_TICKERS, TIMEFRAME_COMBOS


OUTPUT_COLUMNS = [
    "Timeframe",
    "Period",
    "Interval",
    "Ticker",
    "Datetime",
    "Open",
    "High",
    "Low",
    "Close",
    "Adj Close",
    "Volume",
]


def _normalize_download(df: pd.DataFrame, tickers: list[str]) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=["Datetime", "Ticker"])

    if isinstance(df.columns, pd.MultiIndex):
        df = df.stack(level=0)
        df.index.names = ["Datetime", "Ticker"]
        df = df.reset_index()
    else:
        df = df.reset_index()
        if "Ticker" not in df.columns:
            df["Ticker"] = tickers[0] if len(tickers) == 1 else "UNKNOWN"

    if "Date" in df.columns and "Datetime" not in df.columns:
        df = df.rename(columns={"Date": "Datetime"})

    return df


def _reorder_columns(df: pd.DataFrame) -> pd.DataFrame:
    ordered = [col for col in OUTPUT_COLUMNS if col in df.columns]
    remaining = [col for col in df.columns if col not in ordered]
    return df[ordered + remaining]


def download_all(
    tickers: list[str] | None = None, timeframes=None
) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    tickers = tickers or ALL_TICKERS
    timeframes = timeframes or TIMEFRAME_COMBOS
    for timeframe in timeframes:
        df = yf.download(
            tickers=tickers,
            period=timeframe.period,
            interval=timeframe.interval,
            group_by="ticker",
            auto_adjust=False,
            actions=False,
            progress=False,
            threads=True,
        )
        df = _normalize_download(df, ALL_TICKERS)
        if df.empty:
            continue
        df["Timeframe"] = timeframe.name
        df["Period"] = timeframe.period
        df["Interval"] = timeframe.interval
        frames.append(df)

    if not frames:
        return pd.DataFrame(columns=OUTPUT_COLUMNS)

    combined = pd.concat(frames, ignore_index=True)
    return _reorder_columns(combined)
