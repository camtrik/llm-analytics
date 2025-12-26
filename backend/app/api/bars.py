from __future__ import annotations

from fastapi import APIRouter, Query

from app.data.models import BarsBatchRequest, BarsBatchResponse, BarsResponse
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


@router.post("/bars/batch", response_model=BarsBatchResponse)
def get_bars_batch(payload: BarsBatchRequest) -> BarsBatchResponse:
    repository = get_repository()
    return repository.get_bars_batch(
        tickers=payload.tickers,
        timeframe=payload.timeframe,
        limit=payload.limit,
    )
