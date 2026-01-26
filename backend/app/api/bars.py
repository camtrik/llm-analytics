from __future__ import annotations

from fastapi import APIRouter, Query

from app.data.models import BarsBatchRequest, BarsBatchResponse, BarsIndicatorsResponse, BarsResponse
from app.data.repository import get_repository


router = APIRouter()


@router.get("/bars", response_model=BarsResponse)
def get_bars(
    ticker: str = Query(...),
    timeframe: str = Query(...),
    limit: int | None = Query(None),
) -> BarsResponse:
    repository = get_repository()
    return repository.get_bars(ticker=ticker, timeframe=timeframe, limit=limit)


@router.get("/bars/indicators", response_model=BarsIndicatorsResponse)
def get_bars_indicators(
    ticker: str = Query(...),
    timeframe: str = Query(...),
    limit: int | None = Query(None),
    maFast: int | None = Query(None),
    maSlow: int | None = Query(None),
    maLong: int | None = Query(None),
) -> BarsIndicatorsResponse:
    repository = get_repository()
    return repository.get_bars_with_indicators(
        ticker=ticker,
        timeframe=timeframe,
        limit=limit,
        ma_fast=maFast,
        ma_slow=maSlow,
        ma_long=maLong,
    )


@router.post("/bars/batch", response_model=BarsBatchResponse)
def get_bars_batch(payload: BarsBatchRequest) -> BarsBatchResponse:
    repository = get_repository()
    return repository.get_bars_batch(
        tickers=payload.tickers,
        timeframe=payload.timeframe,
        limit=payload.limit,
    )
