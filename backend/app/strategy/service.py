from __future__ import annotations

from pathlib import Path

from app.config.settings import load_settings
from app.config.timeframes import TIMEFRAME_COMBOS
from app.data.market_cache import MarketCache
from app.errors import ApiError
from app.strategy.low_volume_pullback import (
    LowVolumePullbackParams,
    load_tickers,
    screen_low_volume_pullback,
)
from app.strategy.schema import (
    LowVolumeHit,
    LowVolumePullbackParamsModel,
    LowVolumePullbackRequest,
    LowVolumePullbackResponse,
    LowVolumePullbackResult,
)

_settings = load_settings()
_cache = MarketCache(_settings.runtime_dir / "market_cache", TIMEFRAME_COMBOS)
_timeframe_map = {tf.name: tf for tf in TIMEFRAME_COMBOS}
_default_ticker_file = Path(__file__).resolve().parents[1] / "config" / "nikkei225.yml"


def _default_tickers() -> list[dict[str, str]]:
    if not _default_ticker_file.exists():
        return []
    return load_tickers(_default_ticker_file)


def _build_name_map(defaults: list[dict[str, str]]) -> dict[str, str]:
    return {item["symbol"]: item.get("name", "") for item in defaults if "symbol" in item}


def _ensure_cache_ready(symbols: list[str], timeframe: str) -> None:
    try:
        _cache.get_bars_batch(symbols, timeframe)
        return
    except ApiError as exc:
        if exc.error != "cache_not_ready":
            raise
    # 尝试即时刷新所需 ticker
    succeeded, failed = _cache.refresh(symbols)
    if failed:
        raise ApiError(
            status_code=500,
            error="refresh_failed",
            message="Failed to refresh market cache.",
            details={"failed": [f.ticker for f in failed]},
        )
    try:
        _cache.get_bars_batch(symbols, timeframe)
    except ApiError:
        raise ApiError(
            status_code=409,
            error="cache_not_ready",
            message="Market cache is not ready after refresh.",
            details={"timeframe": timeframe},
        )


def low_volume_pullback(payload: LowVolumePullbackRequest) -> LowVolumePullbackResponse:
    timeframe = payload.timeframe
    if timeframe not in _timeframe_map:
        raise ApiError(
            status_code=404,
            error="not_found",
            message="Timeframe not supported.",
            details={"timeframe": timeframe},
        )

    defaults = _default_tickers()
    name_map = _build_name_map(defaults)
    default_symbols = [item["symbol"] for item in defaults if "symbol" in item]
    symbols = list(default_symbols)

    # 若前端传了额外 tickers，则并集加入默认篮子；未传则用全量日经225。
    if payload.tickers:
        for sym in payload.tickers:
            s = str(sym).strip()
            if s and s not in symbols:
                symbols.append(s)

    if not symbols:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="tickers is required (default list empty).",
        )

    params: LowVolumePullbackParams = payload.params.to_params()
    seen = set()
    unique_symbols = []
    for sym in symbols:
        s = str(sym).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        unique_symbols.append(s)

    # 如果缓存缺失/过期，自动刷新再读取
    _ensure_cache_ready(unique_symbols, timeframe)

    raw_results = list(
        screen_low_volume_pullback(
            tickers=unique_symbols,
            timeframe=timeframe,
            params=params,
            cache=_cache,
        )
    )
    results: list[LowVolumePullbackResult] = []
    for entry in raw_results:
        symbol = str(entry.get("symbol", ""))
        result = LowVolumePullbackResult(
            symbol=symbol,
            name=name_map.get(symbol),
            triggered=bool(entry.get("triggered", False)),
            asOf=entry.get("as_of"),
            barIndex=entry.get("bar_index"),
            volRatio=entry.get("vol_ratio"),
            bodyPct=entry.get("body_pct"),
            error=entry.get("error"),
            hits=[
                LowVolumeHit(
                    asOf=int(hit.get("as_of")),
                    barIndex=int(hit.get("bar_index")),
                    volRatio=float(hit.get("vol_ratio")),
                    bodyPct=float(hit.get("body_pct")),
                )
                for hit in entry.get("hits", [])
                if isinstance(hit, dict)
                and hit.get("as_of") is not None
                and hit.get("bar_index") is not None
                and hit.get("vol_ratio") is not None
                and hit.get("body_pct") is not None
            ],
        )
        results.append(result)

    if payload.onlyTriggered:
        results = [item for item in results if item.triggered]

    return LowVolumePullbackResponse(
        timeframe=timeframe,
        params=LowVolumePullbackParamsModel(**payload.params.model_dump()),
        results=results,
    )
