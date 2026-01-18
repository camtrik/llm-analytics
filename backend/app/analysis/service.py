from __future__ import annotations

import json
from typing import Any

from datetime import datetime, timezone

from app.analysis.feed import build_feed
from app.analysis.models import FeedResponse
from app.analysis.prompt import build_messages
from app.analysis.providers import LlmProvider, provider_clients, providers_response
from app.analysis.schema import (
    AnalysisContinueRequest,
    AnalysisContinueResponse,
    AnalysisConstraints,
    AnalysisContinueResponse,
    AnalysisHistoryResponse,
    AnalysisContinueRequest,
    AnalysisRecord,
    AnalysisRunRequest,
    AnalysisRunResponse,
    AnalysisResult,
    ChatMessage,
    ProvidersResponse,
    validate_analysis_result,
)
from app.analysis.storage import get_analysis_store
from app.errors import ApiError


class AnalysisService:
    def __init__(self) -> None:
        self._providers = provider_clients()
        self._store = get_analysis_store()
        self._max_validation_attempts = 2

    def list_providers(self) -> ProvidersResponse:
        return providers_response()

    def run(self, payload: AnalysisRunRequest) -> AnalysisRunResponse:
        client = self._providers.get(payload.provider)
        if not client:
            raise ApiError(
                status_code=400,
                error="invalid_request",
                message="Unknown provider.",
                details={"provider": payload.provider},
            )
        feed = self._resolve_feed(payload)
        constraints = payload.constraints
        model = payload.model
        if not model:
            raise ApiError(
                status_code=400,
                error="invalid_request",
                message="Model is required for analysis.",
            )

        created_at = datetime.now(timezone.utc)
        run_id = self._store.create_run(
            provider=payload.provider,
            model=model,
            prompt_version=payload.promptVersion,
            feed=feed,
            constraints=constraints,
            messages=None,
            turns=None,
        )

        try:
            result, raw_text, messages_used = self._invoke_model(
                client=client,
                feed=feed,
                constraints=constraints,
                model=model,
                provider=payload.provider,
                prompt_version=payload.promptVersion,
                messages_override=None,
            )
            turns = [
                self._build_turn(
                    index=0,
                    created_at=created_at,
                    result=result,
                    raw=raw_text,
                    messages=messages_used,
                )
            ]
            self._store.complete_run(run_id, result, raw_text, messages_used, turns)
            return AnalysisRunResponse(
                id=run_id,
                result=result,
                raw=raw_text,
                messages=messages_used,
                feed=feed,
                constraints=constraints,
                turns=turns,
            )
        except ApiError as exc:
            self._store.fail_run(run_id, exc.message)
            raise
        except Exception as exc:  # noqa: BLE001
            self._store.fail_run(run_id, str(exc))
            raise ApiError(
                status_code=502,
                error="analysis_failed",
                message="Analysis failed.",
                details={"error": str(exc)},
            )

    def history(self, provider: str | None, ticker: str | None, limit: int) -> AnalysisHistoryResponse:
        limit = max(1, min(limit, 50))
        return self._store.history(provider=provider, ticker=ticker, limit=limit)

    def get_run(self, run_id: int) -> AnalysisRecord:
        return self._store.get_run(run_id)

    def continue_run(self, payload: AnalysisContinueRequest) -> AnalysisContinueResponse:
        record = self._store.get_run(payload.runId)
        client = self._providers.get(record.provider) if record.provider else None
        if not client:
            raise ApiError(
                status_code=400,
                error="invalid_request",
                message="Unknown provider for run.",
                details={"provider": record.provider},
            )
        if not record.messages:
            raise ApiError(
                status_code=400,
                error="invalid_request",
                message="Cannot continue: no messages stored for this run.",
            )
        messages = [
            msg.dict() if hasattr(msg, "dict") else {"role": msg.role, "content": msg.content}
            for msg in (record.messages or [])
        ]  # type: ignore[attr-defined]
        messages.append({"role": "user", "content": payload.userMessage})
        created_at = datetime.now(timezone.utc)
        turns = list(record.turns or [])
        try:
            result, raw_text, messages_used = self._invoke_model(
                client=client,
                feed=record.feed,
                constraints=record.constraints or AnalysisConstraints(),
                model=record.model,
                provider=record.provider,
                prompt_version=record.promptVersion,
                messages_override=messages,
            )
            new_turn = self._build_turn(
                index=len(turns),
                created_at=created_at,
                result=result,
                raw=raw_text,
                messages=messages_used,
            )
            turns.append(new_turn)
            self._store.complete_run(record.id, result, raw_text, messages_used, turns)
            return AnalysisContinueResponse(
                id=record.id,
                result=result,
                raw=raw_text,
                messages=messages_used,
                turns=turns,
            )
        except ApiError as exc:
            self._store.fail_run(record.id, exc.message, messages=messages, turns=turns)
            raise
        except Exception as exc:  # noqa: BLE001
            self._store.fail_run(record.id, str(exc), messages=messages, turns=turns)
            raise ApiError(
                status_code=502,
                error="analysis_failed",
                message="Analysis failed.",
                details={"error": str(exc)},
            )

    def _resolve_feed(self, payload: AnalysisRunRequest) -> FeedResponse:
        if payload.feed:
            return payload.feed
        feed_ref = payload.feedRef
        if not feed_ref:
            raise ApiError(
                status_code=400,
                error="invalid_request",
                message="feedRef is required when feed is not provided.",
            )
        if not feed_ref.tradableTickers:
            raise ApiError(
                status_code=400,
                error="invalid_request",
                message="tradableTickers is required.",
            )
        return build_feed(
            date=feed_ref.date,
            tradable_tickers=feed_ref.tradableTickers,
            include_positions=feed_ref.includePositions,
        )

    def _invoke_model(
        self,
        client: LlmProvider,
        feed: FeedResponse,
        constraints: AnalysisConstraints,
        model: str,
        provider: str,
        prompt_version: str,
        messages_override: list[dict[str, str]] | None,
    ) -> tuple[AnalysisResult, str, list[ChatMessage]]:
        errors: list[str] = []
        if messages_override:
            messages = list(messages_override)
        else:
            messages = build_messages(
                feed=feed,
                constraints=constraints,
                provider=provider,
                model=model,
                prompt_version=prompt_version,
            )
        raw_text: str | None = None

        for _ in range(self._max_validation_attempts):
            raw_text = client.complete(messages=messages, model=model, response_format="json_object")
            try:
                parsed = self._coerce_json(raw_text)
                result = validate_analysis_result(parsed)
                chat_messages = [
                    ChatMessage(role=msg.get("role", "user"), content=str(msg.get("content", "")))
                    for msg in messages
                    if isinstance(msg, dict) and msg.get("role") in {"system", "user", "assistant"}
                ]
                chat_messages.append(ChatMessage(role="assistant", content=str(raw_text)))
                return result, raw_text, chat_messages
            except Exception as exc:  # noqa: BLE001
                errors.append(str(exc))
                error_msg = "; ".join(errors[-3:])
                messages = list(messages)
                messages.append(
                    {
                        "role": "user",
                        "content": f"Previous response failed schema validation: {error_msg}. Last output: {raw_text}",
                    }
                )

        raise ApiError(
            status_code=502,
            error="analysis_invalid_output",
            message="LLM output failed validation.",
            details={"errors": errors[-3:]},
        )

    def _build_turn(
        self,
        index: int,
        created_at: datetime,
        result: AnalysisResult,
        raw: str | None,
        messages: list[ChatMessage] | None,
    ) -> "AnalysisTurn":
        from app.analysis.schema import AnalysisTurn

        return AnalysisTurn(
            index=index,
            createdAt=created_at,
            result=result,
            raw=raw,
            messages=messages,
        )

    def _coerce_json(self, payload: str) -> dict[str, Any]:
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            start = payload.find("{")
            end = payload.rfind("}")
            if start != -1 and end != -1 and end > start:
                snippet = payload[start : end + 1]
                return json.loads(snippet)
            raise


_service = AnalysisService()


def get_analysis_service() -> AnalysisService:
    return _service
