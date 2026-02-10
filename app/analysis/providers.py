from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.analysis.schema import ProviderInfo, ProviderName, ProvidersResponse
from app.config.settings import load_settings
from app.errors import ApiError


@dataclass(frozen=True)
class ProviderConfig:
    name: ProviderName
    base_url: str
    api_key: str
    default_model: str
    timeout_seconds: float = 30.0
    max_retries: int = 2

    def available(self) -> bool:
        return bool(self.base_url and self.api_key and self.default_model)


class LlmProvider:
    def __init__(self, config: ProviderConfig) -> None:
        self.config = config

    def complete(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        response_format: str | None = "json_object",
        temperature: float = 0,
    ) -> str:
        if not self.config.available():
            raise ApiError(
                status_code=500,
                error="llm_not_configured",
                message=f"Provider {self.config.name} is not configured.",
            )

        url = self._completion_url()
        payload: dict[str, Any] = {
            "model": model or self.config.default_model,
            "messages": [_normalize_message(msg) for msg in messages],
            "temperature": temperature,
        }
        if response_format:
            payload["response_format"] = {"type": response_format}

        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }

        last_error: Exception | None = None
        for attempt in range(self.config.max_retries + 1):
            try:
                response = httpx.post(
                    url,
                    json=payload,
                    headers=headers,
                    timeout=self.config.timeout_seconds,
                )
                if _should_retry(response.status_code):
                    raise ApiError(
                        status_code=502,
                        error="llm_unavailable",
                        message=f"LLM returned {response.status_code}",
                    )
                response.raise_for_status()
                data = response.json()
                content = _extract_content(data)
                if not isinstance(content, str):
                    return json.dumps(content, ensure_ascii=False)
                return content
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                if attempt >= self.config.max_retries:
                    break
                time.sleep(1.5 * (attempt + 1))
        raise ApiError(
            status_code=502,
            error="llm_error",
            message="Failed to call LLM provider.",
            details={"provider": self.config.name, "error": str(last_error) if last_error else None},
        )

    def _completion_url(self) -> str:
        base = self.config.base_url.rstrip("/")
        if base.endswith("/chat/completions"):
            return base
        return f"{base}/chat/completions"


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default)


def _normalize_message(message: dict[str, Any]) -> dict[str, str]:
    content = message.get("content", "")
    if isinstance(content, (dict, list)):
        content = json.dumps(content, ensure_ascii=False)
    else:
        content = str(content)
    return {"role": str(message.get("role", "user")), "content": content}


def _should_retry(status_code: int) -> bool:
    return status_code in {408, 425, 429, 500, 502, 503, 504}


def _extract_content(payload: dict[str, Any]) -> Any:
    choices = payload.get("choices")
    if not choices:
        return payload
    message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
    content = message.get("content")
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and "text" in part:
                parts.append(str(part.get("text", "")))
        return "\n".join(parts)
    return content or payload


def _default_provider_config() -> dict[ProviderName, ProviderConfig]:
    settings = load_settings()
    llm_settings = settings.llm
    timeout_seconds = float(_env("LLM_TIMEOUT_SECONDS", "30"))
    retries = int(_env("LLM_MAX_RETRIES", "2"))

    gpt_config = ProviderConfig(
        name="gpt",
        base_url=_config_or_env(llm_settings.gpt.base_url, "LLM_BASE_URL"),
        api_key=_config_or_env(llm_settings.gpt.api_key, "LLM_API_KEY", "OPENAI_API_KEY"),
        default_model=_config_or_env(llm_settings.gpt.model, "LLM_MODEL", "OPENAI_MODEL", default="gpt-4o-mini"),
        timeout_seconds=timeout_seconds,
        max_retries=retries,
    )
    deepseek_config = ProviderConfig(
        name="deepseek",
        base_url=_config_or_env(
            llm_settings.deepseek.base_url,
            "LLM_DEEPSEEK_BASE_URL",
            "DEEPSEEK_BASE_URL",
        ),
        api_key=_config_or_env(
            llm_settings.deepseek.api_key,
            "LLM_DEEPSEEK_API_KEY",
            "DEEPSEEK_API_KEY",
        ),
        default_model=_config_or_env(
            llm_settings.deepseek.model,
            "LLM_DEEPSEEK_MODEL",
            "DEEPSEEK_MODEL",
            default="deepseek-chat",
        ),
        timeout_seconds=timeout_seconds,
        max_retries=retries,
    )
    return {"gpt": gpt_config, "deepseek": deepseek_config}


def _config_or_env(config_value: str | None, *env_names: str, default: str = "") -> str:
    if config_value:
        return config_value
    for name in env_names:
        env_val = _env(name)
        if env_val:
            return env_val
    return default


_provider_configs = _default_provider_config()
_providers: dict[ProviderName, LlmProvider] = {
    name: LlmProvider(config) for name, config in _provider_configs.items()
}
_default_provider = load_settings().llm.default_provider or "gpt"


def provider_clients() -> dict[ProviderName, LlmProvider]:
    return _providers


def provider_settings() -> dict[ProviderName, ProviderConfig]:
    return _provider_configs


def providers_response() -> ProvidersResponse:
    items: list[ProviderInfo] = []
    for config in _provider_configs.values():
        items.append(
            ProviderInfo(
                name=config.name,
                defaultModel=config.default_model,
                baseUrl=config.base_url,
                available=config.available(),
            )
        )
    return ProvidersResponse(
        providers=items,
        defaultProvider=_default_provider if _default_provider in _provider_configs else "gpt",
    )
