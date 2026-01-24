from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from app.config.settings import load_settings
from app.config.timeframes import TIMEFRAME_COMBOS
from app.data.market_cache import MarketCache
from app.errors import ApiError
from app.quant.engine import _bars_to_df
from app.strategy.low_volume_pullback import (
    LowVolumePullbackParams,
    backtest_low_volume_pullback_on_df,
    backtest_low_volume_pullback_range_on_df,
    load_tickers,
    screen_low_volume_pullback,
)
from app.strategy.schema import (
    LowVolumePullbackBacktestForwardPoint,
    LowVolumePullbackBacktestRequest,
    LowVolumePullbackBacktestResponse,
    LowVolumePullbackBacktestResult,
    LowVolumePullbackBacktestSignal,
    LowVolumePullbackBacktestSummary,
    LowVolumeBucketRate,
    LowVolumePullbackBacktestRangeRequest,
    LowVolumePullbackBacktestRangeResponse,
    LowVolumePullbackBacktestRangeSummary,
    LowVolumeHit,
    LowVolumePullbackParamsModel,
    LowVolumePullbackParamsPatchModel,
    LowVolumePullbackRequest,
    LowVolumePullbackResponse,
    LowVolumePullbackResult,
)
from app.strategy.strategy_config import get_low_volume_pullback_config, resolve_universe_file

_settings = load_settings()
_cache = MarketCache(_settings.runtime_dir / "market_cache", TIMEFRAME_COMBOS)
_timeframe_map = {tf.name: tf for tf in TIMEFRAME_COMBOS}


def _fallback_universe_file() -> Path:
    return Path(__file__).resolve().parents[1] / "config" / "nikkei225.yml"


def _universe_file_from_config() -> Path:
    cfg = get_low_volume_pullback_config()
    universe_cfg = cfg.get("universe", {})
    file_value = universe_cfg.get("file") if isinstance(universe_cfg, dict) else None
    resolved = resolve_universe_file(str(file_value)) if file_value else None
    return resolved or _fallback_universe_file()


def _default_timeframe_from_config() -> str:
    cfg = get_low_volume_pullback_config()
    tf = cfg.get("timeframe")
    return str(tf).strip() if tf else "6M_1d"


def _resolve_params_from_config(
    overrides: LowVolumePullbackParamsPatchModel | None,
) -> LowVolumePullbackParamsModel:
    cfg = get_low_volume_pullback_config()
    params_cfg = cfg.get("params", {})
    base = (
        LowVolumePullbackParamsModel(**params_cfg)
        if isinstance(params_cfg, dict) and params_cfg
        else LowVolumePullbackParamsModel()
    )
    if not overrides:
        return base
    merged = {**base.model_dump(), **overrides.model_dump(exclude_none=True)}
    return LowVolumePullbackParamsModel(**merged)


def _default_tickers() -> list[dict[str, str]]:
    path = _universe_file_from_config()
    if not path.exists():
        return []
    return load_tickers(path)


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
    cfg = get_low_volume_pullback_config()
    timeframe = (payload.timeframe or _default_timeframe_from_config()).strip()
    if timeframe not in _timeframe_map:
        raise ApiError(
            status_code=404,
            error="not_found",
            message="Timeframe not supported.",
            details={"timeframe": timeframe},
        )

    screener_cfg = cfg.get("screener", {}) if isinstance(cfg.get("screener"), dict) else {}
    only_triggered_default = bool(screener_cfg.get("onlyTriggered", False))
    auto_refresh = bool(screener_cfg.get("autoRefreshIfMissing", True))
    recent_bars_default = int(screener_cfg.get("recentBars", 3))
    only_triggered = (
        payload.onlyTriggered
        if payload.onlyTriggered is not None
        else only_triggered_default
    )
    recent_bars = int(payload.recentBars if payload.recentBars is not None else recent_bars_default)
    if recent_bars < 1:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="recentBars must be >= 1",
            details={"recentBars": recent_bars},
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

    resolved_params_model = _resolve_params_from_config(payload.params)
    params: LowVolumePullbackParams = resolved_params_model.to_params()
    seen = set()
    unique_symbols = []
    for sym in symbols:
        s = str(sym).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        unique_symbols.append(s)

    if auto_refresh:
        _ensure_cache_ready(unique_symbols, timeframe)
    else:
        _cache.get_bars_batch(unique_symbols, timeframe)

    raw_results = list(
        screen_low_volume_pullback(
            tickers=unique_symbols,
            timeframe=timeframe,
            recent_bars=recent_bars,
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

    if only_triggered:
        results = [item for item in results if item.triggered]

    return LowVolumePullbackResponse(
        timeframe=timeframe,
        params=resolved_params_model,
        results=results,
    )


def _resolve_cutoff_dt(payload: LowVolumePullbackBacktestRequest) -> datetime:
    if payload.asOfTs is not None:
        return datetime.fromtimestamp(int(payload.asOfTs), tz=timezone.utc)
    if payload.asOfDate:
        try:
            as_of_date = datetime.fromisoformat(payload.asOfDate).date()
        except ValueError as exc:
            raise ApiError(
                status_code=400,
                error="invalid_request",
                message="Invalid asOfDate format. Expected YYYY-MM-DD.",
                details={"asOfDate": payload.asOfDate},
            ) from exc
        return datetime(
            as_of_date.year,
            as_of_date.month,
            as_of_date.day,
            23,
            59,
            59,
            tzinfo=timezone.utc,
        )
    raise ApiError(
        status_code=400,
        error="invalid_request",
        message="Provide exactly one of asOfDate or asOfTs.",
    )


def _resolve_range_window(payload: LowVolumePullbackBacktestRangeRequest) -> tuple[datetime, datetime]:
    try:
        start_date = datetime.fromisoformat(payload.startDate).date()
        end_date = datetime.fromisoformat(payload.endDate).date()
    except ValueError as exc:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="Invalid startDate/endDate format. Expected YYYY-MM-DD.",
            details={"startDate": payload.startDate, "endDate": payload.endDate},
        ) from exc
    if start_date > end_date:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="startDate must be <= endDate.",
            details={"startDate": payload.startDate, "endDate": payload.endDate},
        )
    start_dt = datetime(
        start_date.year,
        start_date.month,
        start_date.day,
        0,
        0,
        0,
        tzinfo=timezone.utc,
    )
    end_dt = datetime(
        end_date.year,
        end_date.month,
        end_date.day,
        23,
        59,
        59,
        tzinfo=timezone.utc,
    )
    return start_dt, end_dt


def low_volume_pullback_backtest(
    payload: LowVolumePullbackBacktestRequest,
) -> LowVolumePullbackBacktestResponse:
    cfg = get_low_volume_pullback_config()
    timeframe = (payload.timeframe or _default_timeframe_from_config()).strip()
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

    seen = set()
    unique_symbols: list[str] = []
    for sym in symbols:
        s = str(sym).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        unique_symbols.append(s)

    cutoff_dt = _resolve_cutoff_dt(payload)
    backtest_cfg = cfg.get("backtest", {}) if isinstance(cfg.get("backtest"), dict) else {}
    only_triggered_default = bool(backtest_cfg.get("onlyTriggered", True))
    auto_refresh = bool(backtest_cfg.get("autoRefreshIfMissing", False))
    recent_bars_default = int(backtest_cfg.get("recentBars", 3))
    horizon_default = int(backtest_cfg.get("horizonBars", 5))
    entry_execution_default = str(backtest_cfg.get("entryExecution", "close"))

    horizon = int(payload.horizonBars if payload.horizonBars is not None else horizon_default)
    entry_execution = payload.entryExecution or entry_execution_default  # type: ignore[assignment]
    if entry_execution not in {"close", "next_open"}:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="entryExecution must be close or next_open.",
            details={"entryExecution": entry_execution},
        )
    only_triggered = (
        payload.onlyTriggered
        if payload.onlyTriggered is not None
        else only_triggered_default
    )
    recent_bars = int(payload.recentBars if payload.recentBars is not None else recent_bars_default)
    if recent_bars < 1:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="recentBars must be >= 1",
            details={"recentBars": recent_bars},
        )

    resolved_params_model = _resolve_params_from_config(payload.params)
    params = resolved_params_model.to_params()

    if auto_refresh:
        _ensure_cache_ready(unique_symbols, timeframe)
    bars_by_symbol = _cache.get_bars_batch(unique_symbols, timeframe)

    results: list[LowVolumePullbackBacktestResult] = []
    returns_by_day: dict[int, list[float]] = {day: [] for day in range(1, horizon + 1)}
    evaluated_count = 0
    triggered_count = 0
    resolved_asof_ts: int | None = None

    for symbol in unique_symbols:
        bars = bars_by_symbol.get(symbol, [])
        df = _bars_to_df(bars)
        if df.empty:
            if not only_triggered:
                results.append(
                    LowVolumePullbackBacktestResult(
                        symbol=symbol,
                        name=name_map.get(symbol),
                        triggered=False,
                        error="no_bars",
                    )
                )
            continue

        bt = backtest_low_volume_pullback_on_df(
            df=df,
            params=params,
            cutoff_dt=cutoff_dt,
            recent_bars=recent_bars,
            horizon_bars=horizon,
            entry_execution=entry_execution,
        )
        evaluated_count += 1

        end_ts = bt.get("end_ts")
        if resolved_asof_ts is None and isinstance(end_ts, (int, float)):
            resolved_asof_ts = int(end_ts)

        if not bt.get("triggered"):
            if not only_triggered:
                results.append(
                    LowVolumePullbackBacktestResult(
                        symbol=symbol,
                        name=name_map.get(symbol),
                        triggered=False,
                        error=bt.get("error"),
                    )
                )
            continue

        triggered_count += 1
        signal = LowVolumePullbackBacktestSignal(
            barIndex=int(bt.get("signal_idx")),
            asOfTs=int(bt.get("signal_ts")),
            entryPrice=float(bt.get("entry_price")),
            volRatio=bt.get("vol_ratio"),
            bodyPct=bt.get("body_pct"),
        )
        forward: list[LowVolumePullbackBacktestForwardPoint] = []
        for item in bt.get("forward", []) or []:
            if not isinstance(item, dict):
                continue
            day = item.get("day")
            ts = item.get("ts")
            close = item.get("close")
            ret = item.get("return")
            if day is None or ts is None or close is None or ret is None:
                continue
            day_int = int(day)
            forward.append(
                LowVolumePullbackBacktestForwardPoint(
                    day=day_int,
                    ts=int(ts),
                    close=float(close),
                    return_=float(ret),
                )
            )
            if day_int in returns_by_day:
                returns_by_day[day_int].append(float(ret))

        results.append(
            LowVolumePullbackBacktestResult(
                symbol=symbol,
                name=name_map.get(symbol),
                triggered=True,
                signal=signal,
                forward=forward,
                error=bt.get("error"),
            )
        )

    if resolved_asof_ts is None:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="asOf is earlier than available bars.",
        )

    avg_by_day: dict[int, float] = {}
    win_by_day: dict[int, float] = {}
    for day, vals in returns_by_day.items():
        if not vals:
            continue
        avg_by_day[day] = float(sum(vals) / len(vals))
        win_by_day[day] = float(sum(1 for v in vals if v > 0) / len(vals))

    summary = LowVolumePullbackBacktestSummary(
        universeSize=len(unique_symbols),
        evaluatedCount=evaluated_count,
        triggeredCount=triggered_count,
        avgReturnByDay=avg_by_day,
        winRateByDay=win_by_day,
    )
    return LowVolumePullbackBacktestResponse(
        timeframe=timeframe,
        asOfTs=resolved_asof_ts,
        horizonBars=horizon,
        entryExecution=entry_execution,  # type: ignore[arg-type]
        params=resolved_params_model,
        summary=summary,
        results=results,
    )


def low_volume_pullback_backtest_range(
    payload: LowVolumePullbackBacktestRangeRequest,
) -> LowVolumePullbackBacktestRangeResponse:
    cfg = get_low_volume_pullback_config()
    timeframe = (payload.timeframe or _default_timeframe_from_config()).strip()
    if timeframe not in _timeframe_map:
        raise ApiError(
            status_code=404,
            error="not_found",
            message="Timeframe not supported.",
            details={"timeframe": timeframe},
        )

    defaults = _default_tickers()
    default_symbols = [item["symbol"] for item in defaults if "symbol" in item]
    symbols = list(default_symbols)
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

    seen = set()
    unique_symbols: list[str] = []
    for sym in symbols:
        s = str(sym).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        unique_symbols.append(s)

    start_dt, end_dt = _resolve_range_window(payload)

    range_cfg = cfg.get("rangeBacktest", {}) if isinstance(cfg.get("rangeBacktest"), dict) else {}
    auto_refresh = bool(range_cfg.get("autoRefreshIfMissing", False))
    horizon_default = int(range_cfg.get("horizonBars", 5))
    entry_execution_default = str(range_cfg.get("entryExecution", "close"))
    bucket_threshold = float(range_cfg.get("bucketThresholdPct", 0.05))

    horizon = int(payload.horizonBars if payload.horizonBars is not None else horizon_default)
    entry_execution = payload.entryExecution or entry_execution_default  # type: ignore[assignment]
    if entry_execution not in {"close", "next_open"}:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="entryExecution must be close or next_open.",
            details={"entryExecution": entry_execution},
        )

    resolved_params_model = _resolve_params_from_config(payload.params)
    params = resolved_params_model.to_params()

    if auto_refresh:
        _ensure_cache_ready(unique_symbols, timeframe)
    bars_by_symbol = _cache.get_bars_batch(unique_symbols, timeframe)

    evaluated_bars_total = 0
    triggered_events_total = 0
    sample_count_by_day: dict[int, int] = {day: 0 for day in range(1, horizon + 1)}
    win_count_by_day: dict[int, int] = {day: 0 for day in range(1, horizon + 1)}
    bucket_count_by_day: dict[int, dict[str, int]] = {
        day: {"down_gt_5": 0, "down_0_5": 0, "up_0_5": 0, "up_gt_5": 0}
        for day in range(1, horizon + 1)
    }

    for symbol in unique_symbols:
        bars = bars_by_symbol.get(symbol, [])
        df = _bars_to_df(bars)
        if df.empty:
            continue
        bt = backtest_low_volume_pullback_range_on_df(
            df=df,
            params=params,
            start_dt=start_dt,
            end_dt=end_dt,
            horizon_bars=horizon,
            entry_execution=entry_execution,
            bucket_threshold_pct=bucket_threshold,
        )
        if bt.get("error"):
            continue
        evaluated_bars_total += int(bt.get("evaluated_bars", 0) or 0)
        triggered_events_total += int(bt.get("triggered_events", 0) or 0)

        per_day_samples = bt.get("sample_count_by_day") or {}
        per_day_wins = bt.get("win_count_by_day") or {}
        per_day_buckets = bt.get("bucket_count_by_day") or {}
        if not isinstance(per_day_samples, dict) or not isinstance(per_day_wins, dict) or not isinstance(per_day_buckets, dict):
            continue

        for day in range(1, horizon + 1):
            denom = int(per_day_samples.get(day, 0) or 0)
            wins = int(per_day_wins.get(day, 0) or 0)
            buckets = per_day_buckets.get(day, {}) if isinstance(per_day_buckets.get(day, {}), dict) else {}
            sample_count_by_day[day] += denom
            win_count_by_day[day] += wins
            bucket_count_by_day[day]["down_gt_5"] += int(buckets.get("down_gt_5", 0) or 0)
            bucket_count_by_day[day]["down_0_5"] += int(buckets.get("down_0_5", 0) or 0)
            bucket_count_by_day[day]["up_0_5"] += int(buckets.get("up_0_5", 0) or 0)
            bucket_count_by_day[day]["up_gt_5"] += int(buckets.get("up_gt_5", 0) or 0)

    if evaluated_bars_total <= 0:
        raise ApiError(
            status_code=400,
            error="invalid_request",
            message="No bars found in the requested date range (or insufficient bars for indicators).",
            details={
                "timeframe": timeframe,
                "startDate": payload.startDate,
                "endDate": payload.endDate,
            },
        )

    win_rate_by_day: dict[int, float] = {}
    bucket_rate_by_day: dict[int, LowVolumeBucketRate] = {}
    for day in range(1, horizon + 1):
        denom = sample_count_by_day.get(day, 0) or 0
        if denom <= 0:
            continue
        win_rate_by_day[day] = float((win_count_by_day.get(day, 0) or 0) / denom)
        counts = bucket_count_by_day[day]
        bucket_rate_by_day[day] = LowVolumeBucketRate(
            down_gt_5=float((counts.get("down_gt_5", 0) or 0) / denom),
            down_0_5=float((counts.get("down_0_5", 0) or 0) / denom),
            up_0_5=float((counts.get("up_0_5", 0) or 0) / denom),
            up_gt_5=float((counts.get("up_gt_5", 0) or 0) / denom),
        )

    summary = LowVolumePullbackBacktestRangeSummary(
        universeSize=len(unique_symbols),
        evaluatedBars=evaluated_bars_total,
        triggeredEvents=triggered_events_total,
        sampleCountByDay=sample_count_by_day,
        winRateByDay=win_rate_by_day,
        bucketRateByDay=bucket_rate_by_day,
    )

    return LowVolumePullbackBacktestRangeResponse(
        timeframe=timeframe,
        startTs=int(start_dt.timestamp()),
        endTs=int(end_dt.timestamp()),
        horizonBars=horizon,
        entryExecution=entry_execution,  # type: ignore[arg-type]
        params=resolved_params_model,
        summary=summary,
    )
