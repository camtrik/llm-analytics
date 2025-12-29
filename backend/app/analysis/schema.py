from __future__ import annotations

from datetime import datetime
import json
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.analysis.models import FeedRequest, FeedResponse


ProviderName = Literal["gpt", "deepseek"]


class AnalysisConstraints(BaseModel):
    cash: float | None = Field(
        None, description="Available cash. If unknown, prefer weight-based sizing."
    )
    maxOrders: int = Field(
        3,
        ge=1,
        le=20,
        description="Maximum number of actions to emit.",
    )
    allowBuy: bool = True
    allowSell: bool = True
    allowShort: bool = False
    lotSize: int | None = None
    feesBps: float | None = None
    slippageBps: float | None = None
    riskBudget: float | None = None


class FeedRef(FeedRequest):
    pass


class AnalysisRunRequest(BaseModel):
    provider: ProviderName = "gpt"
    model: str | None = None
    feed: FeedResponse | None = None
    feedRef: FeedRef | None = None
    constraints: AnalysisConstraints | None = None
    promptVersion: str = "v1"

    @model_validator(mode="after")
    def _require_feed(self) -> "AnalysisRunRequest":
        if not self.feed and not self.feedRef:
            raise ValueError("feed or feedRef is required.")
        return self


class AnalysisMeta(BaseModel):
    asOf: datetime
    provider: ProviderName
    model: str
    promptVersion: str
    feedMeta: dict[str, Any] = Field(default_factory=dict)


class AnalysisAction(BaseModel):
    ticker: str
    action: Literal["BUY", "SELL", "HOLD", "REDUCE", "INCREASE"]
    timeframe: str
    rationale: str
    risk: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    qty: float | None = None
    targetWeight: float | None = None
    deltaWeight: float | None = None

    @model_validator(mode="after")
    def _require_size(self) -> "AnalysisAction":
        if (
            self.qty is None
            and self.targetWeight is None
            and self.deltaWeight is None
        ):
            raise ValueError("At least one of qty, targetWeight, deltaWeight is required.")
        return self


class AnalysisResult(BaseModel):
    meta: AnalysisMeta
    summary: str
    actions: list[AnalysisAction] = Field(default_factory=list)
    doNotTradeIf: list[str] = Field(default_factory=list)


class AnalysisRunResponse(BaseModel):
    id: int
    result: AnalysisResult
    raw: str | None = None


class ProviderInfo(BaseModel):
    name: ProviderName
    defaultModel: str
    baseUrl: str
    available: bool


class ProvidersResponse(BaseModel):
    providers: list[ProviderInfo]
    defaultProvider: ProviderName


class AnalysisHistoryItem(BaseModel):
    id: int
    createdAt: datetime
    provider: ProviderName
    model: str
    promptVersion: str
    tickers: list[str] = Field(default_factory=list)
    summary: str | None = None
    status: str
    error: str | None = None


class AnalysisHistoryResponse(BaseModel):
    items: list[AnalysisHistoryItem]


class AnalysisRecord(BaseModel):
    id: int
    createdAt: datetime
    provider: ProviderName
    model: str
    promptVersion: str
    feed: FeedResponse
    constraints: AnalysisConstraints | None = None
    result: AnalysisResult | None = None
    raw: str | None = None
    status: str
    error: str | None = None


def _model_dump(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def validate_analysis_result(payload: str | dict[str, Any]) -> AnalysisResult:
    if isinstance(payload, str):
        data = json.loads(payload)
    else:
        data = payload
    if hasattr(AnalysisResult, "model_validate"):
        return AnalysisResult.model_validate(data)
    return AnalysisResult.parse_obj(data)
