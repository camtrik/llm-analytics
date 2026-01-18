from __future__ import annotations

from fastapi import APIRouter

from app.api import analysis, bars, options, portfolio, quant, refresh


router = APIRouter(prefix="/api")
router.include_router(options.router, tags=["options"])
router.include_router(bars.router, tags=["bars"])
router.include_router(refresh.router, tags=["refresh"])
router.include_router(portfolio.router, tags=["portfolio"])
router.include_router(analysis.router, tags=["analysis"])
router.include_router(quant.router, tags=["quant"])
