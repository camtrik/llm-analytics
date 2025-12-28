from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


@dataclass
class ApiError(Exception):
    status_code: int
    error: str
    message: str
    details: dict[str, Any] | None = None


def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    payload = {"error": exc.error, "message": exc.message, "details": exc.details}
    return JSONResponse(status_code=exc.status_code, content=payload)
