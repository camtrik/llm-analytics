from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import router as api_router
from app.config.indicators import get_default_ma_config, load_default_indicators_config
from app.config.settings import load_settings
from app.config.strategy import get_low_volume_pullback_config, load_strategy_config
from app.errors import ApiError, api_error_handler


settings = load_settings()

app = FastAPI(title="LLM Analytics Display Data API")
app.add_exception_handler(ApiError, api_error_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router)


@app.on_event("startup")
def preload_configs() -> None:
    # Fail fast on boot if required runtime configs are missing/invalid.
    load_strategy_config()
    get_low_volume_pullback_config()
    load_default_indicators_config()
    get_default_ma_config()


@app.get("/")
def root() -> dict[str, str]:
    return {"status": "ok"}
