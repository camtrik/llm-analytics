from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

from app.core.errors import ApiError
from app.core.timeframes import TIMEFRAME_TTL_SECONDS, Timeframe
from app.data.downloader import download_timeframe
from app.data.models import Bar, BarSummary, CachePayload, ManifestPayload


@dataclass
class RefreshFailure:
    ticker: str
    reason: str


@dataclass(frozen=True)
class TickerTimeframe:
    ticker: str
    timeframe: str

    def as_dict(self) -> dict[str, str]:
        return {"ticker": self.ticker, "timeframe": self.timeframe}


class MarketCache:
    def __init__(self, base_dir: Path, timeframes: Iterable[Timeframe]) -> None:
        self._base_dir = base_dir
        self._timeframes = {tf.name: tf for tf in timeframes}
        self._manifest_path = base_dir / "manifest.json"

    def refresh(self, tickers: list[str]) -> tuple[list[str], list[RefreshFailure]]:
        manifest = self._load_manifest()
        succeeded: list[str] = []
        failed: list[RefreshFailure] = []
        timeframes = list(self._timeframes.keys())

        for ticker in tickers:
            try:
                missing, stale = self._validate_manifest(manifest, [ticker], timeframes)
                if not missing and not stale:
                    succeeded.append(ticker)
                    continue

                bars_by_timeframe: dict[str, list[Bar]] = {}
                meta_by_timeframe: dict[str, BarSummary] = {}
                for timeframe in self._timeframes.values():
                    df = download_timeframe([ticker], timeframe)
                    bars_map = _df_to_bars(df)
                    bars = bars_map.get(ticker, [])
                    bars_by_timeframe[timeframe.name] = bars
                    meta_by_timeframe[timeframe.name] = _summarize_bars(bars)

                empty_timeframes = [
                    name for name, summary in meta_by_timeframe.items() if not summary["barCount"]
                ]
                if empty_timeframes:
                    raise ValueError(
                        "No bars returned for timeframes: "
                        + ", ".join(sorted(empty_timeframes))
                    )

                for timeframe_name, bars in bars_by_timeframe.items():
                    timeframe = self._timeframes[timeframe_name]
                    payload = _build_cache_payload(ticker, timeframe, bars)
                    self._write_json(self._file_path(timeframe_name, ticker), payload)

                entry = manifest.setdefault("entries", {}).get(ticker, {})
                entry["fetchedAt"] = datetime.now(timezone.utc).isoformat()
                for timeframe_name, summary in meta_by_timeframe.items():
                    entry[timeframe_name] = summary
                manifest["entries"][ticker] = entry
                manifest["generatedAt"] = datetime.now(timezone.utc).isoformat()
                self._write_json(self._manifest_path, manifest)
                succeeded.append(ticker)
            except Exception as exc:
                failed.append(RefreshFailure(ticker=ticker, reason=str(exc)))
                continue

        return succeeded, failed

    def get_bars(self, ticker: str, timeframe: str) -> list[Bar]:
        bars_map = self.get_bars_batch([ticker], timeframe)
        return bars_map.get(ticker, [])

    def get_bars_batch(
        self, tickers: list[str], timeframe: str
    ) -> dict[str, list[Bar]]:
        manifest = self._load_manifest()
        missing, stale = self._validate_manifest(manifest, tickers, [timeframe])
        if missing or stale:
            raise ApiError(
                status_code=409,
                error="cache_not_ready",
                message="Market cache is not ready. Call /api/refresh first.",
                details={
                    "missing": [issue.as_dict() for issue in missing],
                    "stale": [issue.as_dict() for issue in stale],
                },
            )

        results: dict[str, list[Bar]] = {}
        for ticker in tickers:
            path = self._file_path(timeframe, ticker)
            payload = self._read_json(path)
            if not payload or not isinstance(payload.get("bars"), list):
                raise ApiError(
                    status_code=409,
                    error="cache_not_ready",
                    message="Market cache is incomplete. Call /api/refresh first.",
                    details={"ticker": ticker, "timeframe": timeframe},
                )
            results[ticker] = _normalize_bars(payload.get("bars", []))
        return results

    def get_manifest(self) -> ManifestPayload:
        return self._load_manifest()

    def _file_path(self, timeframe: str, ticker: str) -> Path:
        return self._base_dir / timeframe / f"{ticker}.json"

    def _load_manifest(self) -> ManifestPayload:
        manifest = self._read_json(self._manifest_path)
        if not isinstance(manifest, dict):
            return {"generatedAt": None, "entries": {}}
        if "entries" not in manifest or not isinstance(manifest["entries"], dict):
            manifest["entries"] = {}
        return manifest

    def _validate_manifest(
        self, manifest: ManifestPayload, tickers: list[str], timeframes: list[str]
    ) -> tuple[list[TickerTimeframe], list[TickerTimeframe]]:
        missing: list[TickerTimeframe] = []
        stale: list[TickerTimeframe] = []
        entries = manifest.get("entries", {})
        now = int(datetime.now(timezone.utc).timestamp())

        for ticker in tickers:
            entry = entries.get(ticker)
            if not isinstance(entry, dict):
                for timeframe in timeframes:
                    missing.append(TickerTimeframe(ticker=ticker, timeframe=timeframe))
                continue

            fetched_at = entry.get("fetchedAt")
            fetched_ts: int | None = None
            if isinstance(fetched_at, str):
                try:
                    dt = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
                    fetched_ts = int(dt.timestamp())
                except ValueError:
                    fetched_ts = None

            for timeframe in timeframes:
                tf_entry = entry.get(timeframe)
                if not isinstance(tf_entry, dict):
                    missing.append(TickerTimeframe(ticker=ticker, timeframe=timeframe))
                    continue
                ttl_seconds = TIMEFRAME_TTL_SECONDS.get(timeframe, 0)
                if fetched_ts is None:
                    stale.append(TickerTimeframe(ticker=ticker, timeframe=timeframe))
                    continue
                if ttl_seconds and now - fetched_ts > ttl_seconds:
                    stale.append(TickerTimeframe(ticker=ticker, timeframe=timeframe))
                    continue
                path = self._file_path(timeframe, ticker)
                if not path.exists():
                    missing.append(TickerTimeframe(ticker=ticker, timeframe=timeframe))

        return missing, stale

    def _read_json(self, path: Path) -> dict[str, Any] | None:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def _write_json(self, path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(path)


def _df_to_bars(df: pd.DataFrame) -> dict[str, list[Bar]]:
    if df.empty:
        return {}
    df = _ensure_timestamp(df)
    results: dict[str, list[Bar]] = {}
    for ticker, group in df.groupby("Ticker"):
        group = group.sort_values("ts").drop_duplicates(subset="ts", keep="last")
        bars: list[Bar] = []
        for row in group.itertuples(index=False):
            ts = getattr(row, "ts", None)
            if pd.isna(ts):
                continue
            ts_int = int(ts)
            iso_time = datetime.fromtimestamp(ts_int, tz=timezone.utc).isoformat()
            bars.append(
                {
                    "time": iso_time,
                    "t": ts_int,
                    "o": float(row.Open),
                    "h": float(row.High),
                    "l": float(row.Low),
                    "c": float(row.Close),
                    "v": float(row.Volume) if not pd.isna(row.Volume) else 0.0,
                }
            )
        results[str(ticker)] = bars
    return results


def _ensure_timestamp(df: pd.DataFrame) -> pd.DataFrame:
    if "Datetime" not in df.columns:
        raise ApiError(
            status_code=500,
            error="data_error",
            message="Datetime column missing in dataset.",
            details={"columns": list(df.columns)},
        )
    raw = df["Datetime"].astype(str)
    normalized = raw.str.replace(r"\+00:00$", "", regex=True)
    dt = pd.to_datetime(normalized, utc=True, errors="coerce")
    ts = dt.astype("int64") // 1_000_000_000
    df = df.copy()
    df["ts"] = ts
    df["ts"] = df["ts"].where(dt.notna())
    return df


def _summarize_bars(bars: list[Bar]) -> BarSummary:
    timestamps = []
    for bar in bars:
        ts = _extract_ts(bar)
        if ts is not None:
            timestamps.append(ts)
    if not timestamps:
        return {"minTs": None, "maxTs": None, "barCount": 0}
    return {"minTs": min(timestamps), "maxTs": max(timestamps), "barCount": len(timestamps)}


def _build_cache_payload(
    ticker: str, timeframe: Timeframe, bars: Iterable[Bar]
) -> CachePayload:
    timestamps = []
    for bar in bars:
        ts = _extract_ts(bar)
        if ts is not None:
            timestamps.append(ts)
    min_ts = min(timestamps) if timestamps else None
    max_ts = max(timestamps) if timestamps else None
    min_time = (
        datetime.fromtimestamp(min_ts, tz=timezone.utc).isoformat()
        if min_ts is not None
        else None
    )
    max_time = (
        datetime.fromtimestamp(max_ts, tz=timezone.utc).isoformat()
        if max_ts is not None
        else None
    )
    return {
        "meta": {
            "ticker": ticker,
            "timeframe": timeframe.name,
            "period": timeframe.period,
            "interval": timeframe.interval,
            "source": "yfinance",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "minTs": min_ts,
            "maxTs": max_ts,
            "minTime": min_time,
            "maxTime": max_time,
        },
        "bars": list(bars),
    }


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


def _normalize_bars(bars: list[Bar]) -> list[Bar]:
    normalized: list[Bar] = []
    for bar in bars:
        if not isinstance(bar, dict):
            continue
        t_value = bar.get("t")
        time_value = bar.get("time")
        t_int: int | None = int(t_value) if isinstance(t_value, (int, float)) else None
        if not isinstance(time_value, str) and t_int is not None:
            time_value = datetime.fromtimestamp(t_int, tz=timezone.utc).isoformat()
        if isinstance(time_value, str) and t_int is None:
            try:
                dt = datetime.fromisoformat(time_value.replace("Z", "+00:00"))
                t_int = int(dt.timestamp())
            except ValueError:
                continue
        if t_int is None and not isinstance(time_value, str):
            continue
        normalized.append(
            {
                "time": time_value,
                "t": t_int,
                "o": bar.get("o"),
                "h": bar.get("h"),
                "l": bar.get("l"),
                "c": bar.get("c"),
                "v": bar.get("v", 0.0),
            }
        )
    normalized.sort(key=lambda item: item.get("t") or 0)
    return normalized
