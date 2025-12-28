from __future__ import annotations

from typing import TypedDict

from pydantic import BaseModel, Field


# API DTOs (Pydantic): used for request/response validation at the API boundary.
class OptionsResponse(BaseModel):
    tickers: list[str]
    timeframes: list[str]
    tickerInfo: dict[str, str]


class BarPayload(BaseModel):
    time: str | None = None
    t: int
    o: float
    h: float
    l: float
    c: float
    v: float = Field(0, description="Volume")


class BarsResponse(BaseModel):
    ticker: str
    timeframe: str
    bars: list[BarPayload]


class BarsBatchRequest(BaseModel):
    tickers: list[str]
    timeframe: str
    limit: int | None = None


class BarsBatchResponse(BaseModel):
    timeframe: str
    series: dict[str, list[BarPayload]]


class RefreshRequest(BaseModel):
    tickers: list[str]


class RefreshFailure(BaseModel):
    ticker: str
    reason: str


class RefreshResponse(BaseModel):
    requested: list[str]
    succeeded: list[str]
    failed: list[RefreshFailure]


# Internal cache payloads (TypedDict): used by file cache/manifest logic.
class Bar(TypedDict):
    time: str
    t: int
    o: float
    h: float
    l: float
    c: float
    v: float


class BarSummary(TypedDict):
    minTs: int | None
    maxTs: int | None
    barCount: int


class CacheMeta(TypedDict):
    ticker: str
    timeframe: str
    period: str
    interval: str
    source: str
    generatedAt: str
    minTs: int | None
    maxTs: int | None
    minTime: str | None
    maxTime: str | None


class CachePayload(TypedDict):
    meta: CacheMeta
    bars: list[Bar]


ManifestEntry = dict[str, BarSummary | str]


class ManifestPayload(TypedDict):
    generatedAt: str | None
    entries: dict[str, ManifestEntry]
