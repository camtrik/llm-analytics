from __future__ import annotations

from fastapi import APIRouter

from app.api import bars, options, refresh


router = APIRouter(prefix="/api")
router.include_router(options.router, tags=["options"])
router.include_router(bars.router, tags=["bars"])
router.include_router(refresh.router, tags=["refresh"])
