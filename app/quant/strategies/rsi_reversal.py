from __future__ import annotations

import numpy as np
import pandas as pd
from backtesting import Strategy


def compute_rsi_series(series: pd.Series, length: int) -> pd.Series:
    """Compute RSI with the same formula for strategy and signal."""
    values = series.to_numpy()
    delta = np.diff(values, prepend=values[0])
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    avg_gain = np.empty_like(gain)
    avg_loss = np.empty_like(loss)
    alpha = 1 / length
    avg_gain[0] = gain[0]
    avg_loss[0] = loss[0]
    for i in range(1, len(values)):
        avg_gain[i] = alpha * gain[i] + (1 - alpha) * avg_gain[i - 1]
        avg_loss[i] = alpha * loss[i] + (1 - alpha) * avg_loss[i - 1]
    rs = np.divide(avg_gain, avg_loss, out=np.zeros_like(avg_gain), where=avg_loss != 0)
    rsi = 100 - (100 / (1 + rs))
    return pd.Series(rsi, index=series.index)


class RsiReversalStrategy(Strategy):
    length: int = 14
    lower: float = 30
    upper: float = 70

    def init(self) -> None:
        close = self.data.Close
        self.rsi = self.I(lambda s, l: compute_rsi_series(pd.Series(s), l), close, self.length)

    def next(self) -> None:
        latest_rsi = self.rsi[-1]
        if not self.position and latest_rsi < self.lower:
            self.buy()
        elif self.position and latest_rsi > self.upper:
            self.position.close()
