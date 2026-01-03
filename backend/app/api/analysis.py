from __future__ import annotations

from fastapi import APIRouter, Query

from app.analysis.feed import build_feed
from app.analysis.models import FeedRequest, FeedResponse
from app.analysis.schema import (
    AnalysisHistoryResponse,
    AnalysisRecord,
    AnalysisRunRequest,
    AnalysisRunResponse,
    AnalysisContinueRequest,
    AnalysisContinueResponse,
    ProvidersResponse,
)
from app.analysis.service import get_analysis_service


router = APIRouter()
service = get_analysis_service()


@router.get("/analysis/providers", response_model=ProvidersResponse)
def list_providers() -> ProvidersResponse:
    return service.list_providers()


@router.post("/analysis/feed", response_model=FeedResponse)
def feed(payload: FeedRequest) -> FeedResponse:
    return build_feed(
        date=payload.date,
        tradable_tickers=payload.tradableTickers,
        include_positions=payload.includePositions,
    )


@router.post("/analysis/run", response_model=AnalysisRunResponse)
def run_analysis(payload: AnalysisRunRequest) -> AnalysisRunResponse:
    return service.run(payload)


@router.get("/analysis/history", response_model=AnalysisHistoryResponse)
def analysis_history(
    provider: str | None = Query(None),
    ticker: str | None = Query(None),
    limit: int = Query(20, ge=1, le=50),
) -> AnalysisHistoryResponse:
    return service.history(provider=provider, ticker=ticker, limit=limit)


@router.get("/analysis/{run_id}", response_model=AnalysisRecord)
def analysis_result(run_id: int) -> AnalysisRecord:
    return service.get_run(run_id)


@router.post("/analysis/continue", response_model=AnalysisContinueResponse)
def analysis_continue(payload: AnalysisContinueRequest) -> AnalysisContinueResponse:
    return service.continue_run(payload)
