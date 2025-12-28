from __future__ import annotations

import json
from pathlib import Path

from fastapi.encoders import jsonable_encoder

from app.core.config import load_settings
from app.portfolio.models import Portfolio


class PortfolioStore:
    def __init__(self, path: Path) -> None:
        self._path = path

    def load(self) -> Portfolio:
        if not self._path.exists():
            return Portfolio(positions=[], source=None, importedAt=None)
        data = json.loads(self._path.read_text(encoding="utf-8"))
        if hasattr(Portfolio, "model_validate"):
            return Portfolio.model_validate(data)
        return Portfolio.parse_obj(data)

    def save(self, portfolio: Portfolio) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = jsonable_encoder(portfolio)
        tmp_path = self._path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(payload, ensure_ascii=True, indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(self._path)


def _default_store_path() -> Path:
    settings = load_settings()
    return settings.runtime_dir / "portfolio" / "portfolio.json"

# portfolio persistency, could get portfolio from endpoint api/portfolio
_store = PortfolioStore(_default_store_path())

def get_portfolio_store() -> PortfolioStore:
    return _store
