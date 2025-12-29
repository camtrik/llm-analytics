from __future__ import annotations

import json
from typing import Any

from app.analysis.feed import build_feed
from app.analysis.models import FeedResponse
from app.analysis.prompt import build_messages
from app.analysis.providers import LlmProvider, provider_clients, providers_response
from app.analysis.schema import (
    AnalysisConstraints,
    AnalysisHistoryResponse,
    AnalysisRecord,
    AnalysisRunRequest,
    AnalysisRunResponse,
    AnalysisResult,
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

        run_id = self._store.create_run(
            provider=payload.provider,
            model=model,
            prompt_version=payload.promptVersion,
            feed=feed,
            constraints=constraints,
        )

        try:
            result, raw_text = self._invoke_model(
                client=client,
                feed=feed,
                constraints=constraints,
                model=model,
                provider=payload.provider,
                prompt_version=payload.promptVersion,
            )
            self._store.complete_run(run_id, result, raw_text)
            return AnalysisRunResponse(id=run_id, result=result, raw=raw_text)
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
    ) -> tuple[AnalysisResult, str]:
        errors: list[str] = []
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
                return result, raw_text
            except Exception as exc:  # noqa: BLE001
                errors.append(str(exc))
                messages = build_messages(
                    feed=feed,
                    constraints=constraints,
                    provider=provider,
                    model=model,
                    prompt_version=prompt_version,
                    previous_errors=errors,
                    last_output=raw_text,
                )

        raise ApiError(
            status_code=502,
            error="analysis_invalid_output",
            message="LLM output failed validation.",
            details={"errors": errors[-3:]},
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
