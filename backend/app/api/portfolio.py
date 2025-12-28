from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, File, UploadFile

from app.core.errors import ApiError
from app.portfolio.models import ImportResult, Portfolio
from app.portfolio.sbi_csv import parse_sbi_positions
from app.portfolio.store import get_portfolio_store


router = APIRouter()


@router.post("/portfolio/import/sbi", response_model=ImportResult)
async def import_sbi(file: UploadFile = File(...)) -> ImportResult:
    if not file:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="CSV file is required.",
        )
    payload = await file.read()
    positions, skipped = parse_sbi_positions(payload)
    imported_at = datetime.now(timezone.utc)
    portfolio = Portfolio(
        positions=positions,
        source="sbi_csv",
        importedAt=imported_at,
    )
    get_portfolio_store().save(portfolio)
    return ImportResult(positions=positions, importedAt=imported_at, skipped=skipped)


@router.get("/portfolio", response_model=Portfolio)
def get_portfolio() -> Portfolio:
    return get_portfolio_store().load()
