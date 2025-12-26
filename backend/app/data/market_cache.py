from __future__ import annotations

import time
import pandas as pd

from app.data.downloader import download_all


class MarketDataCache:
    def __init__(self) -> None:
        self._df: pd.DataFrame | None = None
        self._loaded_at: float | None = None

    def refresh(self) -> pd.DataFrame:
        self._df = download_all()
        self._loaded_at = time.time()
        return self._df

    def get_df(self, refresh: bool = False) -> pd.DataFrame:
        if refresh or self._df is None:
            return self.refresh()
        return self._df

    def snapshot(self) -> pd.DataFrame | None:
        return self._df

    @property
    def loaded_at(self) -> float | None:
        return self._loaded_at
