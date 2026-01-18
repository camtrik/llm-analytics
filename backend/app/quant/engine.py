from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

import pandas as pd
from backtesting import Backtest

from app.config.data_config import ALL_TICKERS
from app.config.timeframes import Timeframe
from app.data.market_cache import MarketCache
from app.data.models import Bar
from app.errors import ApiError
from app.quant.schema import (
    Action,
    Assumptions,
    BacktestRequest,
    BacktestResponse,
    EquityPoint,
    LatestIndicators,
    Metrics,
    Recommendation,
    RecommendationAction,
    ResultItem,
    Signal,
    StrategySpec,
)
from app.quant.strategies.ma_crossover import MaCrossoverStrategy
from app.quant.strategies.rsi_reversal import RsiReversalStrategy, compute_rsi_series


@dataclass(frozen=True)
class StrategyResult:
    signal: Action
    as_of: datetime
    latest_indicators: LatestIndicators | None
    metrics: Metrics
    equity_curve: list[EquityPoint] | None


def run_backtest(
    cache: MarketCache,
    request: BacktestRequest,
    timeframe_map: dict[str, Timeframe],
    holdings: dict[str, float],
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
        has_position = bool(holdings.get(ticker, 0) > 0)
        recommendation = _build_recommendation(strategy_result.signal, has_position)
        results[ticker] = ResultItem(
            signal=Signal(action=strategy_result.signal, asOf=strategy_result.as_of),
            recommendation=recommendation,
            latestIndicators=strategy_result.latest_indicators,
            metrics=strategy_result.metrics,
            equityCurve=strategy_result.equity_curve if request.output.includeEquityCurve else None,
        )

    assumptions = Assumptions(
        feesBps=request.costs.feesBps,
        slippageBps=request.costs.slippageBps,
        longOnly=True,
        mode=request.mode,
        initialCash=request.initialCash,
        executionPrice="close",
        slippageApplied=False,
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
    fee_rate = fees_bps / 10_000.0

    if name == "ma_crossover":
        fast = int(params.get("fast", 10))
        slow = int(params.get("slow", 30))
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
        bt = Backtest(
            df,
            MaCrossoverStrategy,
            cash=initial_cash,
            commission=fee_rate,
            exclusive_orders=True,
        )
        stats = bt.run(fast=fast, slow=slow)
        return _build_result_from_stats(
            df=df,
            stats=stats,
            signal=_ma_signal(df, fast, slow),
            latest_indicators=_ma_latest(df, fast, slow),
            include_equity_curve=include_equity_curve,
            initial_cash=initial_cash,
        )
    if name == "rsi_reversal":
        length = int(params.get("length", 14))
        lower = float(params.get("lower", 30))
        upper = float(params.get("upper", 70))
        if length < 2:
            raise ApiError(
                status_code=400,
                error="invalid_request",
                message="length must be >= 2",
                details={"length": length},
            )
        if len(df) < length + 2:
            raise ApiError(
                status_code=400,
                error="invalid_request",
                message="Not enough bars for RSI.",
                details={"required": length + 2, "actual": len(df)},
            )
        bt = Backtest(
            df,
            RsiReversalStrategy,
            cash=initial_cash,
            commission=fee_rate,
            exclusive_orders=True,
        )
        stats = bt.run(length=length, lower=lower, upper=upper)
        return _build_result_from_stats(
            df=df,
            stats=stats,
            signal=_rsi_signal(df, length, lower, upper),
            latest_indicators=_rsi_latest(df, length, lower, upper),
            include_equity_curve=include_equity_curve,
            initial_cash=initial_cash,
        )
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
    df = pd.DataFrame(records).sort_values("time")
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


def _build_result_from_stats(
    df: pd.DataFrame,
    stats: pd.Series,
    signal: Action,
    latest_indicators: LatestIndicators | None,
    include_equity_curve: bool,
    initial_cash: float,
) -> StrategyResult:
    # backtesting==0.6.5 uses percent-based metrics with explicit [%] suffix.
    total_return = _safe_float(stats, "Return [%]") / 100.0
    max_dd = abs(_safe_float(stats, "Max. Drawdown [%]")) / 100.0
    trade_count = int(stats.get("# Trades", 0) or 0)
    trades_df = stats.get("_trades")
    win_rate = _compute_win_rate(trades_df)
    avg_hold = _compute_avg_hold_bars(trades_df)
    if win_rate is None:
        win_rate_val = stats.get("Win Rate [%]", None)
        win_rate = float(win_rate_val) / 100.0 if win_rate_val is not None else None
    if avg_hold is None:
        avg_hold = stats.get("Average Trade Duration", None)
        if avg_hold is not None:
            try:
                avg_hold = float(avg_hold)
            except (TypeError, ValueError):
                avg_hold = None

    equity_curve: list[EquityPoint] | None = None
    if include_equity_curve:
        curve_df = stats.get("_equity_curve")
        if isinstance(curve_df, pd.DataFrame) and "Equity" in curve_df.columns:
            equity_curve = [
                EquityPoint(t=int(idx.timestamp()), equity=float(row["Equity"]))
                for idx, row in curve_df.iterrows()
            ]

    metrics = Metrics(
        totalReturn=total_return,
        maxDrawdown=max_dd,
        tradeCount=trade_count,
        winRate=win_rate,
        avgHoldBars=avg_hold,
    )
    return StrategyResult(
        signal=signal,
        as_of=df.index[-1],
        latest_indicators=latest_indicators,
        metrics=metrics,
        equity_curve=equity_curve,
    )


def _safe_float(stats: pd.Series, key: str) -> float:
    try:
        val = stats.get(key, 0.0)
        return float(val) if val is not None else 0.0
    except Exception:
        return 0.0


def _ma_signal(df: pd.DataFrame, fast: int, slow: int) -> Action:
    fast_ma = df["Close"].rolling(fast, min_periods=fast).mean()
    slow_ma = df["Close"].rolling(slow, min_periods=slow).mean()
    if fast_ma.iloc[-1] > slow_ma.iloc[-1]:
        return "BUY"
    if fast_ma.iloc[-1] < slow_ma.iloc[-1]:
        return "SELL"
    return "HOLD"


def _rsi_signal(df: pd.DataFrame, length: int, lower: float, upper: float) -> Action:
    rsi = compute_rsi_series(df["Close"], length)
    latest = rsi.iloc[-1]
    if pd.isna(latest):
        return "HOLD"
    if latest < lower:
        return "BUY"
    if latest > upper:
        return "SELL"
    return "HOLD"


def _ma_latest(df: pd.DataFrame, fast: int, slow: int) -> LatestIndicators:
    fast_ma = df["Close"].rolling(fast, min_periods=fast).mean()
    slow_ma = df["Close"].rolling(slow, min_periods=slow).mean()
    fast_val = float(fast_ma.iloc[-1]) if not pd.isna(fast_ma.iloc[-1]) else None
    slow_val = float(slow_ma.iloc[-1]) if not pd.isna(slow_ma.iloc[-1]) else None
    distance = None
    if fast_val is not None and slow_val:
        distance = (fast_val - slow_val) / slow_val if slow_val != 0 else None
    return LatestIndicators(
        fastMA=fast_val,
        slowMA=slow_val,
        maDistance=distance,
    )


def _rsi_latest(df: pd.DataFrame, length: int, lower: float, upper: float) -> LatestIndicators:
    rsi_series = compute_rsi_series(df["Close"], length)
    latest = rsi_series.iloc[-1]
    if pd.isna(latest):
        return LatestIndicators(rsi=None, rsiZone=None)
    zone = "neutral"
    if latest < lower:
        zone = "oversold"
    elif latest > upper:
        zone = "overbought"
    return LatestIndicators(rsi=float(latest), rsiZone=zone)  # type: ignore[arg-type]


def _compute_win_rate(trades_df: pd.DataFrame | None) -> float | None:
    if trades_df is None or trades_df.empty:
        return None
    col = None
    for candidate in ("ReturnPct", "Return [%]", "PnL"):
        if candidate in trades_df.columns:
            col = candidate
            break
    if col is None:
        return None
    returns = trades_df[col]
    try:
        wins = returns > 0
        return float(wins.mean())
    except Exception:
        return None


def _compute_avg_hold_bars(trades_df: pd.DataFrame | None) -> float | None:
    if trades_df is None or trades_df.empty:
        return None
    for start_col, end_col in (("EntryBar", "ExitBar"), ("Entry Index", "Exit Index")):
        if start_col in trades_df.columns and end_col in trades_df.columns:
            try:
                spans = trades_df[end_col] - trades_df[start_col]
                return float(spans.mean())
            except Exception:
                continue
    return None


def _build_recommendation(signal: Action, has_position: bool) -> Recommendation:
    if has_position:
        if signal == "BUY":
            action: RecommendationAction = "INCREASE"
            reasons = ["trend_up"] if signal == "BUY" else []
        elif signal == "SELL":
            action = "REDUCE"
            reasons = ["trend_down"]
        else:
            action = "HOLD"
            reasons = []
    else:
        if signal == "BUY":
            action = "BUY"
            reasons = ["entry_allowed"]
        else:
            action = "HOLD"
            reasons = []
    return Recommendation(
        position=1 if has_position or action in {"BUY", "INCREASE"} else 0,
        action=action,
        reasonCodes=reasons,
    )
