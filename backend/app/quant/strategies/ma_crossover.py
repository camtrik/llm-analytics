from __future__ import annotations

from backtesting import Strategy
from backtesting.lib import crossover
from backtesting.test import SMA


class MaCrossoverStrategy(Strategy):
    fast: int = 10
    slow: int = 30

    def init(self) -> None:
        close = self.data.Close
        self.fast_ma = self.I(SMA, close, self.fast)
        self.slow_ma = self.I(SMA, close, self.slow)

    def next(self) -> None:
        if crossover(self.fast_ma, self.slow_ma):
            if not self.position:
                self.buy()
        elif crossover(self.slow_ma, self.fast_ma):
            if self.position:
                self.position.close()
