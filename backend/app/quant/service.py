from __future__ import annotations

from app.config.settings import load_settings
from app.config.timeframes import TIMEFRAME_COMBOS
from app.data.market_cache import MarketCache
from app.errors import ApiError
from app.portfolio.store import get_portfolio_store
from app.quant.engine import run_backtest
from app.quant.schema import BacktestRequest, BacktestResponse

_settings = load_settings()
_cache = MarketCache(_settings.runtime_dir / "market_cache", TIMEFRAME_COMBOS)
_timeframe_map = {tf.name: tf for tf in TIMEFRAME_COMBOS}


def backtest(payload: BacktestRequest) -> BacktestResponse:
    try:
        portfolio = get_portfolio_store().load()
        holdings = {pos.ticker: pos.qty for pos in (portfolio.positions or []) if pos.qty > 0}
        return run_backtest(
            cache=_cache,
            request=payload,
            timeframe_map=_timeframe_map,
            holdings=holdings,
        )
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ApiError(
            status_code=500,
            error="backtest_error",
            message="Failed to run backtest.",
            details={"error": str(exc)},
        ) from exc
