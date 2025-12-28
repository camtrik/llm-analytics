from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class Position(BaseModel):
    ticker: str
    qty: float = Field(..., description="Position size")
    avg_cost: float | None = Field(None, description="Average cost per unit")
    currency: str | None = None
    market: str | None = None
    name: str | None = None


class Portfolio(BaseModel):
    positions: list[Position] = Field(default_factory=list)
    source: str | None = None
    importedAt: datetime | None = None


class ImportResult(BaseModel):
    positions: list[Position]
    importedAt: datetime
    skipped: int = 0
