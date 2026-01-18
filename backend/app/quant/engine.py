from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

import pandas as pd

from app.config.data_config import ALL_TICKERS
from app.config.timeframes import TIMEFRAME_COMBOS, Timeframe
from app.data.market_cache import MarketCache
from app.data.models import Bar
from app.errors import ApiError
from app.quant.schema import (
    Action,
    Assumptions,
    BacktestRequest,
    BacktestResponse,
    EquityPoint,
    Metrics,
    ResultItem,
    Signal,
    StrategySpec,
)


@dataclass(frozen=True)
class StrategyResult:
    signal: Action
    as_of: datetime
    metrics: Metrics
    equity_curve: list[EquityPoint] | None


def run_backtest(
    cache: MarketCache, request: BacktestRequest, timeframe_map: dict[str, Timeframe]
) -> BacktestResponse:
    if request.mode != "independent":
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="Only independent mode is supported in MVP.",
            details={"mode": request.mode},
        )
    timeframe = timeframe_map.get(request.timeframe)
    if not timeframe:
        raise ApiError(
            status_code=404,
            error="not_found",
            message="Timeframe not supported.",
            details={"timeframe": request.timeframe},
        )
    unknown = [ticker for ticker in request.tickers if ticker not in ALL_TICKERS]
    if unknown:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="Unknown ticker in request.",
            details={"unknown": unknown},
        )

    results: dict[str, ResultItem] = {}
    for ticker in request.tickers:
        bars = cache.get_bars(ticker, timeframe.name)
        strategy_result = _run_strategy_on_bars(
            bars=bars,
            strategy=request.strategy,
            fees_bps=request.costs.feesBps,
            initial_cash=request.initialCash,
            include_equity_curve=request.output.includeEquityCurve,
        )
        results[ticker] = ResultItem(
            signal=Signal(action=strategy_result.signal, asOf=strategy_result.as_of),
            metrics=strategy_result.metrics,
            equityCurve=strategy_result.equity_curve if request.output.includeEquityCurve else None,
        )

    assumptions = Assumptions(
        feesBps=request.costs.feesBps,
        slippageBps=request.costs.slippageBps,
        longOnly=True,
        mode=request.mode,
        initialCash=request.initialCash,
    )
    return BacktestResponse(
        timeframe=timeframe.name,
        strategy=request.strategy,
        assumptions=assumptions,
        results=results,
    )


def _run_strategy_on_bars(
    bars: Iterable[Bar],
    strategy: StrategySpec,
    fees_bps: float,
    initial_cash: float,
    include_equity_curve: bool,
) -> StrategyResult:
    df = _bars_to_df(bars)
    if df.empty:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="No bars available for backtest.",
        )
    name = strategy.name
    params = strategy.params or {}
    if name == "ma_crossover":
        fast = int(params.get("fast", 10))
        slow = int(params.get("slow", 30))
        return _ma_crossover(df, fast=fast, slow=slow, fees_bps=fees_bps, initial_cash=initial_cash, include_equity=include_equity_curve)
    if name == "rsi_reversal":
        length = int(params.get("length", 14))
        lower = float(params.get("lower", 30))
        upper = float(params.get("upper", 70))
        return _rsi_reversal(df, length=length, lower=lower, upper=upper, fees_bps=fees_bps, initial_cash=initial_cash, include_equity=include_equity_curve)
    raise ApiError(
        status_code=400,
        error="invalid_request",
        message="Unsupported strategy.",
        details={"name": name},
    )


def _bars_to_df(bars: Iterable[Bar]) -> pd.DataFrame:
    records = []
    for bar in bars:
        ts = _extract_ts(bar)
        if ts is None:
            continue
        records.append(
            {
                "ts": ts,
                "time": datetime.fromtimestamp(ts, tz=timezone.utc),
                "Open": float(bar.get("o", 0.0)),
                "High": float(bar.get("h", 0.0)),
                "Low": float(bar.get("l", 0.0)),
                "Close": float(bar.get("c", 0.0)),
                "Volume": float(bar.get("v", 0.0)) if bar.get("v") is not None else 0.0,
            }
        )
    if not records:
        return pd.DataFrame()
    df = pd.DataFrame(records).sort_values("ts")
    df = df.set_index("time")
    return df


def _extract_ts(bar: Bar) -> int | None:
    ts = bar.get("t")
    if isinstance(ts, (int, float)):
        return int(ts)
    time_value = bar.get("time")
    if isinstance(time_value, str):
        try:
            dt = datetime.fromisoformat(time_value.replace("Z", "+00:00"))
            return int(dt.timestamp())
        except ValueError:
            return None
    return None


def _ma_crossover(
    df: pd.DataFrame,
    fast: int,
    slow: int,
    fees_bps: float,
    initial_cash: float,
    include_equity: bool,
) -> StrategyResult:
    if slow <= fast:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="slow must be greater than fast.",
            details={"fast": fast, "slow": slow},
        )
    if len(df) < slow + 2:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="Not enough bars for MA crossover.",
            details={"required": slow + 2, "actual": len(df)},
        )
    close = df["Close"]
    fast_ma = close.rolling(fast, min_periods=fast).mean()
    slow_ma = close.rolling(slow, min_periods=slow).mean()

    position = 0  # 0 cash, 1 long
    cash = initial_cash
    shares = 0.0
    equity_curve: list[EquityPoint] = []
    trades: list[tuple[float, float, int]] = []  # (entry_price, exit_price, bars_held)
    last_entry_idx: int | None = None
    fee_rate = fees_bps / 10_000.0

    for idx, price in enumerate(close):
        # record equity at start of bar
        equity_curve.append(
            EquityPoint(
                t=int(df.index[idx].timestamp()),
                equity=float(cash + shares * price),
            )
        )
        # skip until both MAs available
        if pd.isna(fast_ma.iloc[idx]) or pd.isna(slow_ma.iloc[idx]):
            continue

        if position == 0 and fast_ma.iloc[idx] > slow_ma.iloc[idx]:
            # enter long with full cash
            amount = cash
            if amount <= 0:
                continue
            fee = amount * fee_rate
            cash -= amount
            shares = (amount - fee) / price if price > 0 else 0.0
            position = 1
            last_entry_idx = idx
        elif position == 1 and fast_ma.iloc[idx] < slow_ma.iloc[idx]:
            # exit to cash
            proceeds = shares * price
            fee = proceeds * fee_rate
            cash = proceeds - fee
            position = 0
            if last_entry_idx is not None:
                entry_price = close.iloc[last_entry_idx]
                trades.append((float(entry_price), float(price), idx - last_entry_idx))
            shares = 0.0
            last_entry_idx = None

    # finalize equity at last bar close
    final_equity = cash + shares * close.iloc[-1]
    equity_curve.append(
        EquityPoint(
            t=int(df.index[-1].timestamp()),
            equity=float(final_equity),
        )
    )

    action: Action = "HOLD"
    if fast_ma.iloc[-1] > slow_ma.iloc[-1]:
        action = "BUY"
    elif fast_ma.iloc[-1] < slow_ma.iloc[-1]:
        action = "SELL"

    metrics = _compute_metrics(equity_curve, trades, initial_cash)
    return StrategyResult(
        signal=action,
        as_of=df.index[-1],
        metrics=metrics,
        equity_curve=equity_curve if include_equity else None,
    )


def _rsi_reversal(
    df: pd.DataFrame,
    length: int,
    lower: float,
    upper: float,
    fees_bps: float,
    initial_cash: float,
    include_equity: bool,
) -> StrategyResult:
    if length < 2:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="length must be >= 2",
            details={"length": length},
        )
    close = df["Close"]
    if len(close) < length + 2:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="Not enough bars for RSI.",
            details={"required": length + 2, "actual": len(close)},
        )

    rsi = _compute_rsi(close, length)
    position = 0
    cash = initial_cash
    shares = 0.0
    equity_curve: list[EquityPoint] = []
    trades: list[tuple[float, float, int]] = []
    last_entry_idx: int | None = None
    fee_rate = fees_bps / 10_000.0

    for idx, price in enumerate(close):
        equity_curve.append(
            EquityPoint(
                t=int(df.index[idx].timestamp()),
                equity=float(cash + shares * price),
            )
        )
        if pd.isna(rsi.iloc[idx]):
            continue
        if position == 0 and rsi.iloc[idx] < lower:
            amount = cash
            if amount <= 0:
                continue
            fee = amount * fee_rate
            cash -= amount
            shares = (amount - fee) / price if price > 0 else 0.0
            position = 1
            last_entry_idx = idx
        elif position == 1 and rsi.iloc[idx] > upper:
            proceeds = shares * price
            fee = proceeds * fee_rate
            cash = proceeds - fee
            position = 0
            if last_entry_idx is not None:
                entry_price = close.iloc[last_entry_idx]
                trades.append((float(entry_price), float(price), idx - last_entry_idx))
            shares = 0.0
            last_entry_idx = None

    final_equity = cash + shares * close.iloc[-1]
    equity_curve.append(
        EquityPoint(
            t=int(df.index[-1].timestamp()),
            equity=float(final_equity),
        )
    )

    action: Action = "HOLD"
    if rsi.iloc[-1] < lower:
        action = "BUY"
    elif rsi.iloc[-1] > upper:
        action = "SELL"

    metrics = _compute_metrics(equity_curve, trades, initial_cash)
    return StrategyResult(
        signal=action,
        as_of=df.index[-1],
        metrics=metrics,
        equity_curve=equity_curve if include_equity else None,
    )


def _compute_rsi(series: pd.Series, length: int) -> pd.Series:
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.ewm(alpha=1 / length, min_periods=length, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / length, min_periods=length, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, pd.NA)
    rsi = 100 - (100 / (1 + rs))
    return rsi


def _compute_metrics(
    equity: list[EquityPoint],
    trades: list[tuple[float, float, int]],
    initial_cash: float,
) -> Metrics:
    equities = [pt.equity for pt in equity]
    if not equities:
        return Metrics(
            totalReturn=0.0,
            maxDrawdown=0.0,
            tradeCount=len(trades),
            winRate=None,
            avgHoldBars=None,
        )
    peak = equities[0]
    max_dd = 0.0
    for value in equities:
        peak = max(peak, value)
        if peak > 0:
            max_dd = max(max_dd, (peak - value) / peak)
    total_return = (equities[-1] / initial_cash) - 1 if initial_cash else 0.0

    win_rate = None
    avg_hold = None
    if trades:
        wins = sum(1 for entry, exit, _ in trades if exit > entry)
        win_rate = wins / len(trades)
        avg_hold = sum(hold for _, _, hold in trades) / len(trades)
    return Metrics(
        totalReturn=total_return,
        maxDrawdown=max_dd,
        tradeCount=len(trades),
        winRate=win_rate,
        avgHoldBars=avg_hold,
    )
