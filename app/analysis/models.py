from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.data.models import Bar
from app.portfolio.models import Position


# API DTOs (Pydantic): used for request/response validation at the analysis API boundary.
class FeedBar(BaseModel):
    time: str
    o: float
    h: float
    l: float
    c: float
    v: float = Field(0, description="Volume")


class FeedRequest(BaseModel):
    date: datetime | None = None
    tradableTickers: list[str]
    includePositions: bool = True


class TimeframeMeta(BaseModel):
    minTs: int | None = None
    maxTs: int | None = None
    barCount: int = 0


class FeedMeta(BaseModel):
    source: str = "yfinance"
    generatedAt: datetime
    version: str = "v0"
    timeframes: dict[str, TimeframeMeta] = Field(default_factory=dict)


class FeedResponse(BaseModel):
    date: datetime
    positions: list[Position]
    tradableTickers: list[str]
    ohlcv: dict[str, dict[str, list[FeedBar]]]
    meta: FeedMeta


# Internal helper types (not exposed as API DTOs).
OhlcvByTimeframe = dict[str, dict[str, list[Bar]]]
