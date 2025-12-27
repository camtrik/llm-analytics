from dataclasses import dataclass


@dataclass(frozen=True)
class Timeframe:
    name: str
    period: str
    interval: str


TIMEFRAME_COMBOS = [
    Timeframe(name="1D_15m", period="1d", interval="15m"),
    Timeframe(name="5D_15m", period="5d", interval="15m"),
    Timeframe(name="10D_30m", period="10d", interval="30m"),
    Timeframe(name="1M_1d", period="1mo", interval="1d"),
    Timeframe(name="6M_1d", period="6mo", interval="1d"),
    Timeframe(name="5Y_1wk", period="5y", interval="1wk"),
]
