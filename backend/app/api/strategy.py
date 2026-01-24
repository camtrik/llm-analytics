from __future__ import annotations

from fastapi import APIRouter

from app.strategy.schema import LowVolumePullbackRequest, LowVolumePullbackResponse
from app.strategy.service import low_volume_pullback

router = APIRouter()


@router.post("/strategy/low_volume_pullback", response_model=LowVolumePullbackResponse)
def run_low_volume_pullback(payload: LowVolumePullbackRequest) -> LowVolumePullbackResponse:
    return low_volume_pullback(payload)
