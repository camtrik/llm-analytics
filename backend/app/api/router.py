from __future__ import annotations

from fastapi import APIRouter

from app.api import bars, options


router = APIRouter(prefix="/api")
router.include_router(options.router, tags=["options"])
router.include_router(bars.router, tags=["bars"])
