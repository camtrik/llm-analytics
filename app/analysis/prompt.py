from __future__ import annotations

import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi.encoders import jsonable_encoder

from app.analysis.models import FeedResponse
from app.analysis.schema import AnalysisConstraints, ProviderName
from app.errors import ApiError


_PROMPT_DIR = Path(__file__).with_name("prompts")
_ALLOWED_LANG = {"en", "zh"}


@lru_cache(maxsize=16)
def _load_prompt_template(version: str, language: str) -> str:
    safe_version = (version or "v1").strip()
    safe_lang = (language or "en").strip().lower()
    if safe_lang not in _ALLOWED_LANG:
        safe_lang = "en"
    path = _PROMPT_DIR / f"{safe_version}.{safe_lang}.txt"
    if not path.exists():
        fallback = _PROMPT_DIR / f"{safe_version}.en.txt"
        if safe_lang != "en" and fallback.exists():
            path = fallback
        else:
            raise ApiError(
                status_code=500,
                error="config_error",
                message="Prompt file not found.",
                details={"version": safe_version, "language": safe_lang},
            )
    text = path.read_text(encoding="utf-8").strip()
    print(text)
    if not text:
        raise ApiError(
            status_code=500,
            error="config_error",
            message="Prompt file is empty.",
            details={"path": str(path)},
        )
    return text


def _dump_model(model: Any) -> Any:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    if hasattr(model, "dict"):
        return model.dict()
    return model


def _format_json(data: Any) -> str:
    encoded = jsonable_encoder(data)
    return json.dumps(encoded, ensure_ascii=False, indent=2)


def build_messages(
    feed: FeedResponse,
    constraints: AnalysisConstraints,
    provider: ProviderName,
    model: str,
    prompt_version: str,
    prompt_language: str = "en",
    previous_errors: list[str] | None = None,
    last_output: str | None = None,
) -> list[dict[str, str]]:
    max_orders = constraints.maxOrders or 3
    template = _load_prompt_template(prompt_version, prompt_language)
    try:
        system_prompt = template.format(
            provider=provider,
            model=model,
            prompt_version=prompt_version,
            max_orders=max_orders,
        )
    except Exception as exc:  # noqa: BLE001
        raise ApiError(
            status_code=500,
            error="config_error",
            message="Failed to format prompt template.",
            details={"error": str(exc)},
        ) from exc

    payload = {
        "feed": _dump_model(feed),
        "constraints": _dump_model(constraints),
    }
    user_parts = [
        "Feed and constraints (JSON):",
        _format_json(payload),
    ]
    if previous_errors:
        error_text = "; ".join(previous_errors[-3:])
        user_parts.append(
            f"Previous response failed schema validation: {error_text}. Respond with corrected JSON only."
        )
    if last_output:
        user_parts.append("Your last invalid output:")
        user_parts.append(last_output)
    user_message = "\n".join(user_parts)

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]
