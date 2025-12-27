from __future__ import annotations

from pydantic import BaseModel, Field


class OptionsDataset(BaseModel):
    source: str
    rowCount: int
    minDatetime: int | None
    maxDatetime: int | None


class OptionsResponse(BaseModel):
    tickers: list[str]
    timeframes: list[str]
    tickerInfo: dict[str, str]
    dataset: OptionsDataset


class Bar(BaseModel):
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
    tickers: list[str] | None = None


class RefreshResponse(BaseModel):
    rowCount: int
    minDatetime: int | None
    maxDatetime: int | None
