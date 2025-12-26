from __future__ import annotations

from pathlib import Path
import time

import pandas as pd


class DataFrameCache:
    def __init__(self, path: Path, ttl_seconds: int) -> None:
        self._path = Path(path)
        self._ttl_seconds = ttl_seconds
        self._df: pd.DataFrame | None = None
        self._loaded_at = 0.0
        self._mtime: float | None = None

    def get_df(self) -> pd.DataFrame:
        if not self._path.exists():
            raise FileNotFoundError(f"CSV not found: {self._path}")

        mtime = self._path.stat().st_mtime
        now = time.time()
        if (
            self._df is None
            or self._mtime != mtime
            or now - self._loaded_at > self._ttl_seconds
        ):
            self._df = pd.read_csv(self._path)
            self._loaded_at = now
            self._mtime = mtime
        return self._df

    @property
    def path(self) -> Path:
        return self._path
