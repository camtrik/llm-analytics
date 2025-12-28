from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any


class JsonFileCache:
    def __init__(self, base_dir: Path) -> None:
        self._base_dir = base_dir

    def _path_for(self, timeframe: str, ticker: str) -> Path:
        return self._base_dir / timeframe / f"{ticker}.json"

    def load(self, timeframe: str, ticker: str, ttl_seconds: int) -> dict[str, Any] | None:
        path = self._path_for(timeframe, ticker)
        if not path.exists():
            return None
        if ttl_seconds > 0:
            age = time.time() - path.stat().st_mtime
            if age > ttl_seconds:
                return None
        return json.loads(path.read_text(encoding="utf-8"))

    def save(self, timeframe: str, ticker: str, payload: dict[str, Any]) -> None:
        path = self._path_for(timeframe, ticker)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(payload, ensure_ascii=True, indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(path)
