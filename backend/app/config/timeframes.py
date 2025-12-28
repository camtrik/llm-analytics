from dataclasses import dataclass


def _interval_to_seconds(interval: str) -> int:
    value = interval.strip().lower()
    if value.endswith("wk"):
        count = int(value[:-2])
        return count * 7 * 24 * 60 * 60
    unit = value[-1]
    count = int(value[:-1])
    if unit == "m":
        return count * 60
    if unit == "h":
        return count * 60 * 60
    if unit == "d":
        return count * 24 * 60 * 60
    raise ValueError(f"Unsupported interval: {interval}")


@dataclass(frozen=True)
class Timeframe:
    name: str
    period: str
    interval: str


TIMEFRAME_COMBOS = [
    Timeframe(name="1D_15m", period="1d", interval="15m"),
    Timeframe(name="5D_30m", period="5d", interval="30m"),
    Timeframe(name="10D_1h", period="10d", interval="1h"),
    Timeframe(name="1M_1d", period="1mo", interval="1d"),
    Timeframe(name="6M_1d", period="6mo", interval="1d"),
    Timeframe(name="5Y_1wk", period="5y", interval="1wk"),
]

# OHLCV feed to LLMs
FEED_TIMEFRAMES = ["10D_1h", "6M_1d"]

TIMEFRAME_TTL_SECONDS = {
    tf.name: max(_interval_to_seconds(tf.interval), 60 * 60)
    for tf in TIMEFRAME_COMBOS
}
