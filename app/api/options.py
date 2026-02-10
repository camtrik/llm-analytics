from __future__ import annotations

from fastapi import APIRouter

from app.data.models import UniverseResponse
from app.data.repository import get_repository


router = APIRouter()


@router.get("/universe", response_model=UniverseResponse)
def get_universe() -> UniverseResponse:
    repository = get_repository()
    return repository.list_universe()
