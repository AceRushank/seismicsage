"""
routers/analysis.py — AI Geological Analysis endpoint.

Endpoints:
  POST /api/analyze/{earthquake_id} — triggers Groq/Llama analysis for a specific event

Status codes:
  200 — successful analysis (may be cached)
  404 — earthquake ID not found
  429 — Groq rate limited
  503 — USGS or Groq service unavailable
"""

import logging
from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException, Query

from config import DEFAULT_FEED, VALID_FEEDS
from models.schemas import AnalysisResponse, FaultAnalysisRequest, FaultAnalysisResponse
from services import groq_service, usgs_service
from services.geology_service import get_tectonic_context

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analyze", tags=["Analysis"])

@router.post(
    "/fault",
    response_model=FaultAnalysisResponse,
    summary="Generate AI geological insight for a tectonic fault boundary",
    description=(
        "Calls Groq to generate a location-specific geological insight about "
        "a tectonic plate boundary. Includes context from nearby recent earthquakes."
    ),
)
async def analyze_fault(body: FaultAnalysisRequest) -> FaultAnalysisResponse:
    """
    Generate a Groq geological insight for a tectonic plate boundary location.

    Uses the boundary type, coordinates, and nearby earthquake context to produce
    a concise, location-specific geological narrative.
    """
    nearby_summary = (
        f"{len(body.nearby_earthquake_ids)} recent events nearby"
        if body.nearby_earthquake_ids
        else "no recent events nearby"
    )

    prompt = (
        f"You are a geological analyst. The user clicked on a "
        f"{body.boundary_type} plate boundary near coordinates "
        f"({body.latitude:.2f}, {body.longitude:.2f}).\n\n"
        f"Recent earthquakes within 300km: {nearby_summary}\n\n"
        f"Provide a 2-3 sentence geological insight about this specific boundary location — "
        f"what makes it notable, what historical events have occurred here, and what the "
        f"current seismic activity suggests. Be specific to this location, not generic. "
        f"Output only the insight text — no JSON, no markdown headers."
    )

    insight = await groq_service.generate_fault_insight(prompt)
    return FaultAnalysisResponse(
        insight=insight,
        boundary_type=body.boundary_type,
        latitude=body.latitude,
        longitude=body.longitude,
    )


@router.post(
    "/{earthquake_id}",
    response_model=AnalysisResponse,
    summary="Generate AI geological analysis",
    description=(
        "Triggers a Groq Llama 3.1 8B analysis for the specified earthquake event. "
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
    Fetch the earthquake, compute tectonic context, and run Groq analysis.

    The analysis pipeline is:
    1. Look up the earthquake in the specified USGS feed
    2. Compute tectonic context via geology_service (PB2002 or AI-inferred)
    3. Call groq_service.analyze_earthquake (cached by earthquake ID)
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

    # Step 3: Run (or retrieve cached) Groq analysis
    # groq_service.analyze_earthquake never raises — returns structured fallback on error
    analysis = await groq_service.analyze_earthquake(earthquake, geo_context)

    # Step 4: Map service-level signals to HTTP status codes
    if analysis.generated_at is None and "rate-limited" in analysis.tags:
        raise HTTPException(
            status_code=429,
            detail="Groq API rate limit reached. Please retry in a moment.",
        )

    return analysis
