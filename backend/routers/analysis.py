"""
routers/analysis.py — AI Geological Analysis endpoint.

Endpoints:
  POST /api/analyze/{earthquake_id} — triggers Gemini analysis for a specific event

Status codes:
  200 — successful analysis (may be cached)
  404 — earthquake ID not found
  429 — Gemini rate limited
  503 — USGS or Gemini service unavailable
"""

import logging
from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException, Query

from config import DEFAULT_FEED, VALID_FEEDS
from models.schemas import AnalysisResponse
from services import gemini_service, usgs_service
from services.geology_service import get_tectonic_context

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analyze", tags=["Analysis"])


@router.post(
    "/{earthquake_id}",
    response_model=AnalysisResponse,
    summary="Generate AI geological analysis",
    description=(
        "Triggers a Gemini Flash AI analysis for the specified earthquake event. "
        "Returns a cached result if the event has been analysed previously (TTL: 1 hour). "
        "Geological context is grounded in Peter Bird's PB2002 tectonic plate boundary dataset "
        "where available, otherwise uses AI-inferred context (marked in the response). "
        "Returns a structured fallback response on timeout or rate limiting — never a raw 500 error."
    ),
)
async def analyze_earthquake(
    earthquake_id: str,
    feed: Annotated[
        str,
        Query(
            description=(
                f"USGS feed to look up the earthquake in. One of: {', '.join(VALID_FEEDS)}. "
                "Defaults to significant_week."
            )
        ),
    ] = DEFAULT_FEED,
) -> AnalysisResponse:
    """
    Fetch the earthquake, compute tectonic context, and run Gemini analysis.

    The analysis pipeline is:
    1. Look up the earthquake in the specified USGS feed
    2. Compute tectonic context via geology_service (PB2002 or AI-inferred)
    3. Call gemini_service.analyze_earthquake (cached by earthquake ID)
    4. Return the AnalysisResponse with cache status and confidence indicators
    """
    if feed not in VALID_FEEDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid feed '{feed}'. Valid options: {VALID_FEEDS}",
        )

    # Step 1: Resolve the earthquake from the USGS feed
    try:
        earthquake = await usgs_service.get_earthquake_by_id(
            earthquake_id=earthquake_id,
            feed=feed,
        )
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        logger.error(
            "USGS unreachable during analysis request for '%s': %s",
            earthquake_id,
            exc,
        )
        raise HTTPException(
            status_code=503,
            detail="USGS earthquake feed is currently unreachable.",
        ) from exc

    if earthquake is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Earthquake '{earthquake_id}' not found in the '{feed}' feed. "
                "The event may be outside the current feed's time window."
            ),
        )

    # Step 2: Get tectonic context (data-backed from PB2002 or AI-inferred fallback)
    geo_context = get_tectonic_context(
        lat=earthquake.latitude,
        lng=earthquake.longitude,
        depth_km=earthquake.depth_km,
    )
    logger.debug(
        "Tectonic context for event '%s': confidence=%s, boundary=%s",
        earthquake_id,
        geo_context.confidence,
        geo_context.plate_boundary,
    )

    # Step 3: Run (or retrieve cached) Gemini analysis
    # gemini_service.analyze_earthquake never raises — returns structured fallback on error
    analysis = await gemini_service.analyze_earthquake(earthquake, geo_context)

    # Step 4: Map service-level signals to HTTP status codes
    if analysis.generated_at is None and "rate-limited" in analysis.tags:
        raise HTTPException(
            status_code=429,
            detail="Gemini API rate limit reached. Please retry in a moment.",
        )

    return analysis
