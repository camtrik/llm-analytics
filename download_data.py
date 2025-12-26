import argparse
from pathlib import Path

import pandas as pd
import yfinance as yf

from backend.app.core.tickers import ALL_TICKERS
from backend.app.core.timeframes import TIMEFRAME_COMBOS

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


def normalize_download(df: pd.DataFrame, tickers: list[str]) -> pd.DataFrame:
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


def download_timeframe(tickers: list[str], timeframe) -> pd.DataFrame:
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

    df = normalize_download(df, tickers)
    if df.empty:
        return df

    df["Timeframe"] = timeframe.name
    df["Period"] = timeframe.period
    df["Interval"] = timeframe.interval
    return df


def reorder_columns(df: pd.DataFrame) -> pd.DataFrame:
    ordered = [col for col in OUTPUT_COLUMNS if col in df.columns]
    remaining = [col for col in df.columns if col not in ordered]
    return df[ordered + remaining]


def main() -> int:
    parser = argparse.ArgumentParser(description="Download OHLCV data for ALL_TICKERS.")
    parser.add_argument(
        "--output",
        default="data/stock_data.csv",
        help="Output CSV path for combined data.",
    )
    args = parser.parse_args()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    frames: list[pd.DataFrame] = []
    for timeframe in TIMEFRAME_COMBOS:
        print(f"Downloading {timeframe.name} ({timeframe.period}, {timeframe.interval})...")
        frame = download_timeframe(ALL_TICKERS, timeframe)
        if frame.empty:
            print(f"  No data for {timeframe.name}, skipping.")
            continue
        frames.append(frame)

    if not frames:
        print("No data downloaded.")
        return 1

    combined = pd.concat(frames, ignore_index=True)
    combined = reorder_columns(combined)
    combined.to_csv(output_path, index=False)
    print(f"Saved {len(combined)} rows to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
