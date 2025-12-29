from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi.encoders import jsonable_encoder

from app.analysis.models import FeedResponse
from app.analysis.schema import (
    AnalysisConstraints,
    AnalysisHistoryItem,
    AnalysisHistoryResponse,
    AnalysisRecord,
    AnalysisResult,
    ProviderName,
    validate_analysis_result,
)
from app.config.settings import load_settings
from app.errors import ApiError


def _model_dump(model: Any) -> Any:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    if hasattr(model, "dict"):
        return model.dict()
    return model


def _json_dumps(payload: Any) -> str:
    encoded = jsonable_encoder(payload)
    return json.dumps(encoded, ensure_ascii=False)


def _parse_datetime(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)


class AnalysisStore:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_tables()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_tables(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS analysis_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    prompt_version TEXT NOT NULL,
                    feed_json TEXT NOT NULL,
                    constraints_json TEXT,
                    result_json TEXT,
                    raw_text TEXT,
                    status TEXT NOT NULL,
                    error TEXT
                );
                """
            )
            conn.commit()

    def create_run(
        self,
        provider: ProviderName,
        model: str,
        prompt_version: str,
        feed: FeedResponse,
        constraints: AnalysisConstraints | None,
    ) -> int:
        created_at = datetime.now(timezone.utc).isoformat()
        feed_json = _json_dumps(_model_dump(feed))
        constraints_json = _json_dumps(_model_dump(constraints)) if constraints else None
        with self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO analysis_runs (
                    created_at, provider, model, prompt_version, feed_json,
                    constraints_json, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    created_at,
                    provider,
                    model,
                    prompt_version,
                    feed_json,
                    constraints_json,
                    "running",
                ),
            )
            conn.commit()
            return int(cursor.lastrowid)

    def complete_run(
        self,
        run_id: int,
        result: AnalysisResult,
        raw_text: str | None,
    ) -> None:
        result_json = _json_dumps(_model_dump(result))
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE analysis_runs
                SET result_json = ?, raw_text = ?, status = ?
                WHERE id = ?;
                """,
                (result_json, raw_text, "succeeded", run_id),
            )
            conn.commit()

    def fail_run(self, run_id: int, error: str) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE analysis_runs
                SET status = ?, error = ?
                WHERE id = ?;
                """,
                ("failed", error, run_id),
            )
            conn.commit()

    def get_run(self, run_id: int) -> AnalysisRecord:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, created_at, provider, model, prompt_version,
                       feed_json, constraints_json, result_json, raw_text,
                       status, error
                FROM analysis_runs
                WHERE id = ?;
                """,
                (run_id,),
            ).fetchone()
        if not row:
            raise ApiError(status_code=404, error="not_found", message="Analysis run not found.")

        feed = self._decode_feed(row["feed_json"])
        constraints = self._decode_constraints(row["constraints_json"])
        result = self._decode_result(row["result_json"])
        return AnalysisRecord(
            id=int(row["id"]),
            createdAt=_parse_datetime(row["created_at"]),
            provider=row["provider"],
            model=row["model"],
            promptVersion=row["prompt_version"],
            feed=feed,
            constraints=constraints,
            result=result,
            raw=row["raw_text"],
            status=row["status"],
            error=row["error"],
        )

    def history(
        self, provider: str | None = None, ticker: str | None = None, limit: int = 20
    ) -> AnalysisHistoryResponse:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, created_at, provider, model, prompt_version,
                       feed_json, result_json, status, error
                FROM analysis_runs
                ORDER BY id DESC;
                """
            ).fetchall()

        items: list[AnalysisHistoryItem] = []
        for row in rows:
            feed_json = json.loads(row["feed_json"])
            tickers = feed_json.get("tradableTickers") or []
            if ticker and ticker not in tickers:
                continue
            if provider and row["provider"] != provider:
                continue
            summary = None
            if row["result_json"]:
                try:
                    summary = json.loads(row["result_json"]).get("summary")
                except json.JSONDecodeError:
                    summary = None
            items.append(
                AnalysisHistoryItem(
                    id=int(row["id"]),
                    createdAt=_parse_datetime(row["created_at"]),
                    provider=row["provider"],
                    model=row["model"],
                    promptVersion=row["prompt_version"],
                    tickers=tickers,
                    summary=summary,
                    status=row["status"],
                    error=row["error"],
                )
            )
            if len(items) >= limit:
                break
        return AnalysisHistoryResponse(items=items)

    def _decode_feed(self, payload: str) -> FeedResponse:
        data = json.loads(payload)
        if hasattr(FeedResponse, "model_validate"):
            return FeedResponse.model_validate(data)
        return FeedResponse.parse_obj(data)

    def _decode_constraints(self, payload: str | None) -> AnalysisConstraints | None:
        if not payload:
            return None
        data = json.loads(payload)
        if hasattr(AnalysisConstraints, "model_validate"):
            return AnalysisConstraints.model_validate(data)
        return AnalysisConstraints.parse_obj(data)

    def _decode_result(self, payload: str | None) -> AnalysisResult | None:
        if not payload:
            return None
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            return None
        return validate_analysis_result(data)


_settings = load_settings()
_store = AnalysisStore(_settings.runtime_dir / "analysis" / "analysis.db")


def get_analysis_store() -> AnalysisStore:
    return _store
