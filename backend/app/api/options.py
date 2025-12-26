from __future__ import annotations

from fastapi import APIRouter

from app.data.models import OptionsResponse
from app.data.repository import get_repository


router = APIRouter()


@router.get("/options", response_model=OptionsResponse)
def get_options() -> OptionsResponse:
    repository = get_repository()
    return repository.list_options()
