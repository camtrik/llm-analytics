from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os

import yaml


@dataclass(frozen=True)
class Settings:
    runtime_dir: Path
    max_limit: int
    feed_max_tickers: int
    cors_origins: list[str]
    llm: "LlmSettings"


@dataclass(frozen=True)
class LlmProviderSettings:
    base_url: str
    api_key: str
    model: str


@dataclass(frozen=True)
class LlmSettings:
    default_provider: str
    gpt: LlmProviderSettings
    deepseek: LlmProviderSettings


def _load_llm_provider(
    data: dict[str, object] | None,
    default_base_url: str,
    default_model: str,
) -> LlmProviderSettings:
    data = data or {}
    base_url = str(data.get("base_url") or default_base_url)
    api_key = str(data.get("api_key") or "")
    model = str(data.get("model") or default_model)
    return LlmProviderSettings(base_url=base_url, api_key=api_key, model=model)


def _load_llm_settings(data: dict[str, object] | None) -> LlmSettings:
    data = data or {}
    default_provider = str(data.get("default_provider") or "gpt")
    gpt = _load_llm_provider(
        data.get("gpt") if isinstance(data.get("gpt"), dict) else {},
        default_base_url="https://api.openai.com/v1",
        default_model="gpt-4o-mini",
    )
    deepseek = _load_llm_provider(
        data.get("deepseek") if isinstance(data.get("deepseek"), dict) else {},
        default_base_url="https://api.deepseek.com/v1",
        default_model="deepseek-chat",
    )
    return LlmSettings(default_provider=default_provider, gpt=gpt, deepseek=deepseek)


def load_settings() -> Settings:
    repo_root = Path(__file__).resolve().parents[3]
    default_config = Path(__file__).resolve().parent / "files" / "config.yaml"
    config_path = Path(os.getenv("SETTINGS_PATH", str(default_config)))
    if not config_path.exists():
        raise FileNotFoundError(f"Settings file not found: {config_path}")
    data = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError("Settings file must contain a mapping at the top level.")

    runtime_dir_value = data.get("runtime_dir", "var")
    runtime_dir = Path(str(runtime_dir_value))
    if not runtime_dir.is_absolute():
        runtime_dir = repo_root / runtime_dir

    max_limit = int(data.get("max_limit", 5000))
    feed_max_tickers = int(data.get("feed_max_tickers", 50))

    cors_origins_raw = data.get(
        "cors_origins",
        ["http://localhost:3000", "http://127.0.0.1:3000"],
    )
    if isinstance(cors_origins_raw, str):
        cors_origins = [item.strip() for item in cors_origins_raw.split(",") if item.strip()]
    else:
        cors_origins = [str(item).strip() for item in cors_origins_raw if str(item).strip()]

    llm_settings = _load_llm_settings(
        data.get("llm") if isinstance(data.get("llm"), dict) else {}
    )
    return Settings(
        runtime_dir=runtime_dir,
        max_limit=max_limit,
        feed_max_tickers=feed_max_tickers,
        cors_origins=cors_origins,
        llm=llm_settings,
    )
