from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi.encoders import jsonable_encoder

from app.analysis.models import FeedResponse
from app.analysis.schema import (
    ChatMessage,
    AnalysisConstraints,
    AnalysisTurn,
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
                    prompt_language TEXT NOT NULL DEFAULT 'en',
                    prompt_version TEXT NOT NULL,
                    feed_json TEXT NOT NULL,
                    constraints_json TEXT,
                    result_json TEXT,
                    raw_text TEXT,
                    turns_json TEXT,
                    messages_json TEXT,
                    status TEXT NOT NULL,
                    error TEXT
                );
                """
            )
            # Add missing columns for backward compatibility
            existing = {
                row[1]: row[0]
                for row in conn.execute("PRAGMA table_info(analysis_runs);").fetchall()
            }
            if "messages_json" not in existing:
                conn.execute("ALTER TABLE analysis_runs ADD COLUMN messages_json TEXT;")
            if "turns_json" not in existing:
                conn.execute("ALTER TABLE analysis_runs ADD COLUMN turns_json TEXT;")
            if "prompt_language" not in existing:
                conn.execute("ALTER TABLE analysis_runs ADD COLUMN prompt_language TEXT DEFAULT 'en';")
            conn.commit()

    def create_run(
        self,
        provider: ProviderName,
        model: str,
        prompt_language: str,
        prompt_version: str,
        feed: FeedResponse,
        constraints: AnalysisConstraints | None,
        messages: list[ChatMessage] | None = None,
        turns: list[AnalysisTurn] | None = None,
    ) -> int:
        created_at = datetime.now(timezone.utc).isoformat()
        feed_json = _json_dumps(_model_dump(feed))
        constraints_json = _json_dumps(_model_dump(constraints)) if constraints else None
        messages_json = _json_dumps(_model_dump(messages)) if messages else None
        turns_json = _json_dumps(_model_dump(turns)) if turns else None
        with self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO analysis_runs (
                    created_at, provider, model, prompt_language, prompt_version, feed_json,
                    constraints_json, messages_json, turns_json, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    created_at,
                    provider,
                    model,
                    prompt_language,
                    prompt_version,
                    feed_json,
                    constraints_json,
                    messages_json,
                    turns_json,
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
        messages: list[ChatMessage] | None,
        turns: list[AnalysisTurn] | None,
    ) -> None:
        result_json = _json_dumps(_model_dump(result))
        messages_json = _json_dumps(_model_dump(messages)) if messages else None
        turns_json = _json_dumps(_model_dump(turns)) if turns else None
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE analysis_runs
                SET result_json = ?, raw_text = ?, messages_json = ?, turns_json = ?, status = ?
                WHERE id = ?;
                """,
                (result_json, raw_text, messages_json, turns_json, "succeeded", run_id),
            )
            conn.commit()

    def fail_run(
        self,
        run_id: int,
        error: str,
        messages: list[ChatMessage] | None = None,
        turns: list[AnalysisTurn] | None = None,
    ) -> None:
        messages_json = _json_dumps(_model_dump(messages)) if messages else None
        turns_json = _json_dumps(_model_dump(turns)) if turns else None
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE analysis_runs
                SET status = ?, error = ?, messages_json = COALESCE(messages_json, ?),
                    turns_json = COALESCE(turns_json, ?)
                WHERE id = ?;
                """,
                ("failed", error, messages_json, turns_json, run_id),
            )
            conn.commit()

    def get_run(self, run_id: int) -> AnalysisRecord:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, created_at, provider, model, prompt_version,
                       prompt_language,
                       feed_json, constraints_json, result_json, raw_text,
                       messages_json, turns_json,
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
        messages = self._decode_messages(row["messages_json"])
        turns = self._decode_turns(row["turns_json"])
        return AnalysisRecord(
            id=int(row["id"]),
            createdAt=_parse_datetime(row["created_at"]),
            provider=row["provider"],
            model=row["model"],
            promptVersion=row["prompt_version"],
            promptLanguage=row["prompt_language"] or "en",
            feed=feed,
            constraints=constraints,
            result=result,
            raw=row["raw_text"],
            messages=messages,
            turns=turns,
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

    def _decode_messages(self, payload: str | None) -> list[ChatMessage] | None:
        if not payload:
            return None
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            return None
        if not isinstance(data, list):
            return None
        messages: list[ChatMessage] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            role = item.get("role")
            content = item.get("content")
            if isinstance(role, str) and isinstance(content, str):
                messages.append(ChatMessage(role=role, content=content))  # type: ignore[arg-type]
        return messages or None

    def _decode_turns(self, payload: str | None) -> list[AnalysisTurn] | None:
        if not payload:
            return None
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            return None
        if not isinstance(data, list):
            return None
        turns: list[AnalysisTurn] = []
        for item in data:
            try:
                if hasattr(AnalysisTurn, "model_validate"):
                    turns.append(AnalysisTurn.model_validate(item))
                else:
                    turns.append(AnalysisTurn.parse_obj(item))
            except Exception:
                continue
        return turns or None


_settings = load_settings()
_store = AnalysisStore(_settings.runtime_dir / "analysis" / "analysis.db")


def get_analysis_store() -> AnalysisStore:
    return _store
