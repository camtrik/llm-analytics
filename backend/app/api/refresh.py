from __future__ import annotations

from fastapi import APIRouter

from app.data.models import RefreshRequest, RefreshResponse
from app.data.repository import get_repository


router = APIRouter()


@router.post("/refresh", response_model=RefreshResponse)
def refresh_data(payload: RefreshRequest) -> RefreshResponse:
    repository = get_repository()
    tickers = payload.tickers or None
    return repository.refresh_data(tickers=tickers)
