from __future__ import annotations

from pydantic import BaseModel, Field

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
    lookbackBars: int = 3
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
            lookback_bars=self.lookbackBars,
            eps=self.eps,
        )


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
    timeframe: str = "6M_1d"
    tickers: list[str] | None = None
    params: LowVolumePullbackParamsModel = Field(default_factory=LowVolumePullbackParamsModel)
    onlyTriggered: bool = False


class LowVolumePullbackResponse(BaseModel):
    timeframe: str
    params: LowVolumePullbackParamsModel
    results: list[LowVolumePullbackResult]
