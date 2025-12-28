from __future__ import annotations

from fastapi import APIRouter

from app.analysis.feed import build_feed
from app.analysis.models import FeedRequest, FeedResponse


router = APIRouter()


@router.post("/analysis/feed", response_model=FeedResponse)
def feed(payload: FeedRequest) -> FeedResponse:
    return build_feed(
        date=payload.date,
        tradable_tickers=payload.tradableTickers,
        include_positions=payload.includePositions,
    )
