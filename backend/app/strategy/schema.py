from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.strategy.low_volume_pullback import LowVolumePullbackParams


class LowVolumePullbackParamsModel(BaseModel):
    fastMA: int = 5
    slowMA: int = 10
    longMA: int = 60
    longMaSlopeWindow: int = 3
    longMaSlopeMinPct: float = 0.0
    volAvgWindow: int = 5
    volRatioMax: float = 0.5
    minBodyPct: float = 0.002
    minRangePct: float | None = None
    eps: float = 1e-12

    def to_params(self) -> LowVolumePullbackParams:
        return LowVolumePullbackParams(
            fast_ma=self.fastMA,
            slow_ma=self.slowMA,
            long_ma=self.longMA,
            long_ma_slope_window=self.longMaSlopeWindow,
            long_ma_slope_min_pct=self.longMaSlopeMinPct,
            vol_avg_window=self.volAvgWindow,
            vol_ratio_max=self.volRatioMax,
            min_body_pct=self.minBodyPct,
            min_range_pct=self.minRangePct,
            eps=self.eps,
        )


class LowVolumePullbackParamsPatchModel(BaseModel):
    fastMA: int | None = None
    slowMA: int | None = None
    longMA: int | None = None
    longMaSlopeWindow: int | None = None
    longMaSlopeMinPct: float | None = None
    volAvgWindow: int | None = None
    volRatioMax: float | None = None
    minBodyPct: float | None = None
    minRangePct: float | None = None
    eps: float | None = None


class LowVolumePullbackResult(BaseModel):
    symbol: str
    name: str | None = None
    triggered: bool
    asOf: int | None = None
    barIndex: int | None = None
    volRatio: float | None = None
    bodyPct: float | None = None
    error: str | None = None
    hits: list["LowVolumeHit"] = Field(default_factory=list)


class LowVolumeHit(BaseModel):
    asOf: int
    barIndex: int
    volRatio: float
    bodyPct: float


class LowVolumePullbackRequest(BaseModel):
    timeframe: str | None = None
    tickers: list[str] | None = None
    recentBars: int | None = None
    params: LowVolumePullbackParamsPatchModel | None = None
    onlyTriggered: bool | None = None


class LowVolumePullbackResponse(BaseModel):
    timeframe: str
    params: LowVolumePullbackParamsModel
    results: list[LowVolumePullbackResult]


EntryExecution = Literal["close", "next_open"]


class LowVolumePullbackBacktestRequest(BaseModel):
    timeframe: str | None = None
    asOfDate: str | None = None
    asOfTs: int | None = None
    tickers: list[str] | None = None
    onlyTriggered: bool | None = None
    recentBars: int | None = None
    horizonBars: int | None = None
    entryExecution: EntryExecution | None = None
    params: LowVolumePullbackParamsPatchModel | None = None

    @model_validator(mode="after")
    def _validate_asof(self) -> "LowVolumePullbackBacktestRequest":
        has_date = bool(self.asOfDate)
        has_ts = self.asOfTs is not None
        if has_date == has_ts:
            raise ValueError("Provide exactly one of asOfDate or asOfTs.")
        if self.horizonBars is not None:
            if self.horizonBars < 1:
                raise ValueError("horizonBars must be >= 1")
            if self.horizonBars > 20:
                raise ValueError("horizonBars must be <= 20")
        if self.recentBars is not None and self.recentBars < 1:
            raise ValueError("recentBars must be >= 1")
        return self


class LowVolumePullbackBacktestSignal(BaseModel):
    barIndex: int
    asOfTs: int
    entryPrice: float
    volRatio: float | None = None
    bodyPct: float | None = None


class LowVolumePullbackBacktestForwardPoint(BaseModel):
    day: int
    ts: int
    close: float
    return_: float = Field(alias="return")

    model_config = {"populate_by_name": True}


class LowVolumePullbackBacktestResult(BaseModel):
    symbol: str
    name: str | None = None
    triggered: bool
    signal: LowVolumePullbackBacktestSignal | None = None
    forward: list[LowVolumePullbackBacktestForwardPoint] = Field(default_factory=list)
    error: str | None = None


class LowVolumePullbackBacktestSummary(BaseModel):
    universeSize: int
    evaluatedCount: int
    triggeredCount: int
    avgReturnByDay: dict[int, float] = Field(default_factory=dict)
    winRateByDay: dict[int, float] = Field(default_factory=dict)


class LowVolumePullbackBacktestResponse(BaseModel):
    timeframe: str
    asOfTs: int
    horizonBars: int
    entryExecution: EntryExecution
    params: LowVolumePullbackParamsModel
    summary: LowVolumePullbackBacktestSummary
    results: list[LowVolumePullbackBacktestResult]


class LowVolumeBucketRate(BaseModel):
    down_gt_5: float = 0.0
    down_0_5: float = 0.0
    up_0_5: float = 0.0
    up_gt_5: float = 0.0


class LowVolumePullbackBacktestRangeRequest(BaseModel):
    timeframe: str | None = None
    startDate: str
    endDate: str
    tickers: list[str] | None = None
    horizonBars: int | None = None
    entryExecution: EntryExecution | None = None
    params: LowVolumePullbackParamsPatchModel | None = None

    @model_validator(mode="after")
    def _validate_range(self) -> "LowVolumePullbackBacktestRangeRequest":
        try:
            start = datetime.fromisoformat(self.startDate).date()
            end = datetime.fromisoformat(self.endDate).date()
        except ValueError as exc:
            raise ValueError("Invalid startDate/endDate format. Expected YYYY-MM-DD.") from exc
        if start > end:
            raise ValueError("startDate must be <= endDate.")
        if self.horizonBars is not None:
            if self.horizonBars < 1:
                raise ValueError("horizonBars must be >= 1")
            if self.horizonBars > 20:
                raise ValueError("horizonBars must be <= 20")
        return self


class LowVolumePullbackBacktestRangeSummary(BaseModel):
    universeSize: int
    evaluatedBars: int
    triggeredEvents: int
    sampleCountByDay: dict[int, int] = Field(default_factory=dict)
    winRateByDay: dict[int, float] = Field(default_factory=dict)
    bucketRateByDay: dict[int, LowVolumeBucketRate] = Field(default_factory=dict)


class LowVolumePullbackBacktestRangeResponse(BaseModel):
    timeframe: str
    startTs: int
    endTs: int
    horizonBars: int
    entryExecution: EntryExecution
    params: LowVolumePullbackParamsModel
    summary: LowVolumePullbackBacktestRangeSummary
