from __future__ import annotations

from fastapi import APIRouter

from app.data.models import RefreshResponse
from app.data.repository import get_repository


router = APIRouter()


@router.post("/refresh", response_model=RefreshResponse)
def refresh_data() -> RefreshResponse:
    repository = get_repository()
    return repository.refresh_data()
