from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


Action = Literal["BUY", "SELL", "HOLD"]
StrategyName = Literal["ma_crossover", "rsi_reversal"]
Mode = Literal["independent", "portfolio"]


class StrategySpec(BaseModel):
    name: StrategyName = "ma_crossover"
    params: dict[str, float | int] = Field(default_factory=dict)


class Costs(BaseModel):
    feesBps: float = 0.0
    slippageBps: float = 0.0


class OutputSpec(BaseModel):
    includeEquityCurve: bool = False


class BacktestRequest(BaseModel):
    timeframe: str = "6M_1d"
    tickers: list[str]
    strategy: StrategySpec = Field(default_factory=StrategySpec)
    costs: Costs = Field(default_factory=Costs)
    mode: Mode = "independent"
    initialCash: float = 100_000.0
    output: OutputSpec = Field(default_factory=OutputSpec)

    @model_validator(mode="after")
    def _validate_tickers(self) -> "BacktestRequest":
        if not self.tickers:
            raise ValueError("tickers is required.")
        return self


class Signal(BaseModel):
    action: Action
    asOf: datetime


class Metrics(BaseModel):
    totalReturn: float
    maxDrawdown: float
    tradeCount: int
    winRate: float | None = None
    avgHoldBars: float | None = None


class EquityPoint(BaseModel):
    t: int
    equity: float


class ResultItem(BaseModel):
    signal: Signal
    metrics: Metrics
    equityCurve: list[EquityPoint] | None = None


class Assumptions(BaseModel):
    feesBps: float
    slippageBps: float
    longOnly: bool = True
    mode: Mode
    initialCash: float


class BacktestResponse(BaseModel):
    timeframe: str
    strategy: StrategySpec
    assumptions: Assumptions
    results: dict[str, ResultItem]
