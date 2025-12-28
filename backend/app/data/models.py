from __future__ import annotations

from pydantic import BaseModel, Field


class OptionsResponse(BaseModel):
    tickers: list[str]
    timeframes: list[str]
    tickerInfo: dict[str, str]


class Bar(BaseModel):
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
    bars: list[Bar]


class BarsBatchRequest(BaseModel):
    tickers: list[str]
    timeframe: str
    limit: int | None = None


class BarsBatchResponse(BaseModel):
    timeframe: str
    series: dict[str, list[Bar]]


class RefreshRequest(BaseModel):
    tickers: list[str]


class RefreshFailure(BaseModel):
    ticker: str
    reason: str


class RefreshResponse(BaseModel):
    requested: list[str]
    succeeded: list[str]
    failed: list[RefreshFailure]
