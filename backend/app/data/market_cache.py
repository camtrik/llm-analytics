from __future__ import annotations

import time
import pandas as pd

from app.data.downloader import download_all


class MarketDataCache:
    def __init__(self) -> None:
        self._df: pd.DataFrame | None = None
        self._loaded_at: float | None = None

    def refresh(self, tickers: list[str] | None = None) -> pd.DataFrame:
        self._df = download_all(tickers=tickers)
        self._loaded_at = time.time()
        return self._df

    def get_df(
        self, refresh: bool = False, tickers: list[str] | None = None
    ) -> pd.DataFrame:
        if refresh:
            return self.refresh(tickers=tickers)
        if self._df is None:
            raise RuntimeError("market data cache is empty")
        return self._df

    def snapshot(self) -> pd.DataFrame | None:
        return self._df

    @property
    def loaded_at(self) -> float | None:
        return self._loaded_at
