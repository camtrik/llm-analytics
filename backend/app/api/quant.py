from __future__ import annotations

from fastapi import APIRouter

from app.quant.schema import BacktestRequest, BacktestResponse
from app.quant.service import backtest


router = APIRouter()


@router.post("/quant/backtest", response_model=BacktestResponse)
def run_backtest(payload: BacktestRequest) -> BacktestResponse:
    return backtest(payload)
