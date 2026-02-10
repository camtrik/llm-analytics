from __future__ import annotations

from fastapi import APIRouter

from app.strategy.schema import (
    LowVolumePullbackBacktestRequest,
    LowVolumePullbackBacktestResponse,
    LowVolumePullbackBacktestRangeRequest,
    LowVolumePullbackBacktestRangeResponse,
    LowVolumePullbackRequest,
    LowVolumePullbackResponse,
)
from app.strategy.service import (
    low_volume_pullback,
    low_volume_pullback_backtest,
    low_volume_pullback_backtest_range,
)

router = APIRouter()


@router.post("/strategy/low_volume_pullback", response_model=LowVolumePullbackResponse)
def run_low_volume_pullback(payload: LowVolumePullbackRequest) -> LowVolumePullbackResponse:
    return low_volume_pullback(payload)


@router.post(
    "/strategy/low_volume_pullback/backtest",
    response_model=LowVolumePullbackBacktestResponse,
)
def run_low_volume_pullback_backtest(
    payload: LowVolumePullbackBacktestRequest,
) -> LowVolumePullbackBacktestResponse:
    return low_volume_pullback_backtest(payload)


@router.post(
    "/strategy/low_volume_pullback/backtest/range",
    response_model=LowVolumePullbackBacktestRangeResponse,
)
def run_low_volume_pullback_backtest_range(
    payload: LowVolumePullbackBacktestRangeRequest,
) -> LowVolumePullbackBacktestRangeResponse:
    return low_volume_pullback_backtest_range(payload)
