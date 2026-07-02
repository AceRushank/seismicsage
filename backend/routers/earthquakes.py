"""
routers/earthquakes.py — Earthquake data endpoints.

Endpoints:
  GET /api/earthquakes         — filtered, sorted, paginated feed
  GET /api/earthquakes/{id}    — single event by USGS ID
  GET /api/stats               — aggregate stats computed server-side

All routes return proper HTTP status codes:
  200 — success
  400 — invalid query parameters
  404 — earthquake ID not found
  503 — USGS unreachable with no stale cache
"""

import logging
from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException, Query

from config import (
    DEFAULT_FEED,
    DEFAULT_LIMIT,
    DEFAULT_MIN_MAGNITUDE,
    DEFAULT_SORT_BY,
    MAX_LIMIT,
    VALID_FEEDS,
    VALID_SORT_BY,
)
from models.schemas import (
    Earthquake,
    EarthquakeListResponse,
    StatsResponse,
)
from services import usgs_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/earthquakes", tags=["Earthquakes"])


# ---------------------------------------------------------------------------
# GET /api/earthquakes
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=EarthquakeListResponse,
    summary="List earthquake events",
    description=(
        "Retrieve real-time earthquake events from USGS feeds. "
        "Results are cached for 60 seconds to avoid excessive load on USGS. "
        "If USGS is unreachable, the last successful cache is returned with `stale: true`."
    ),
)
async def list_earthquakes(
    feed: Annotated[
        str,
        Query(
            description=(
                f"USGS feed identifier. One of: {', '.join(VALID_FEEDS)}."
            )
        ),
    ] = DEFAULT_FEED,
    min_magnitude: Annotated[
        float,
        Query(ge=0.0, le=10.0, description="Minimum magnitude filter (inclusive)"),
    ] = DEFAULT_MIN_MAGNITUDE,
    limit: Annotated[
        int,
        Query(ge=1, le=MAX_LIMIT, description="Maximum number of results to return"),
    ] = DEFAULT_LIMIT,
    sort_by: Annotated[
        str,
        Query(
            description=f"Sort field. One of: {', '.join(VALID_SORT_BY)}."
        ),
    ] = DEFAULT_SORT_BY,
) -> EarthquakeListResponse:
    """Return a filtered and sorted list of earthquake events from the specified USGS feed."""
    if feed not in VALID_FEEDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid feed '{feed}'. Valid options: {VALID_FEEDS}",
        )
    if sort_by not in VALID_SORT_BY:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid sort_by '{sort_by}'. Valid options: {VALID_SORT_BY}",
        )

    try:
        earthquakes, is_stale, fetched_at = await usgs_service.fetch_earthquakes(
            feed=feed,
            sort_by=sort_by,
            min_magnitude=min_magnitude,
            limit=limit,
        )
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        logger.error("USGS service unavailable (feed=%s): %s", feed, exc)
        raise HTTPException(
            status_code=503,
            detail="USGS earthquake feed is currently unreachable and no cached data is available.",
        ) from exc

    # Fetch total count (all events, before limit) for metadata
    try:
        all_events, _, _ = await usgs_service.fetch_earthquakes(
            feed=feed, sort_by=sort_by, min_magnitude=min_magnitude, limit=10_000
        )
        total_count = len(all_events)
    except (httpx.HTTPError, httpx.TimeoutException):
        total_count = len(earthquakes)

    return EarthquakeListResponse(
        earthquakes=earthquakes,
        total_count=total_count,
        returned_count=len(earthquakes),
        feed=feed,
        stale=is_stale,
        fetched_at=fetched_at,
    )


# ---------------------------------------------------------------------------
# GET /api/earthquakes/{earthquake_id}
# ---------------------------------------------------------------------------

@router.get(
    "/{earthquake_id}",
    response_model=Earthquake,
    summary="Get single earthquake by ID",
    description=(
        "Retrieve detailed information about a specific earthquake event by its USGS event ID. "
        "The event must be present in the specified feed's current time window."
    ),
)
async def get_earthquake(
    earthquake_id: str,
    feed: Annotated[
        str,
        Query(description=f"USGS feed to search within. One of: {', '.join(VALID_FEEDS)}."),
    ] = DEFAULT_FEED,
) -> Earthquake:
    """Look up a single earthquake event by USGS ID within the specified feed."""
    if feed not in VALID_FEEDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid feed '{feed}'. Valid options: {VALID_FEEDS}",
        )

    try:
        earthquake = await usgs_service.get_earthquake_by_id(
            earthquake_id=earthquake_id, feed=feed
        )
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        logger.error(
            "USGS service unavailable when looking up '%s': %s", earthquake_id, exc
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

    return earthquake


# ---------------------------------------------------------------------------
# GET /api/stats
# ---------------------------------------------------------------------------

@router.get(
    "/stats/summary",
    response_model=StatsResponse,
    summary="Get aggregate earthquake statistics",
    description=(
        "Returns server-computed aggregate statistics for the specified USGS feed: "
        "total count, largest event, count above M4, count above M6, and average depth. "
        "Computed from the same cached data as the list endpoint."
    ),
)
async def get_stats(
    feed: Annotated[
        str,
        Query(description=f"USGS feed to compute stats for. One of: {', '.join(VALID_FEEDS)}."),
    ] = DEFAULT_FEED,
) -> StatsResponse:
    """Compute and return aggregate statistics for the current USGS feed window."""
    if feed not in VALID_FEEDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid feed '{feed}'. Valid options: {VALID_FEEDS}",
        )

    try:
        earthquakes, is_stale, _ = await usgs_service.fetch_earthquakes(
            feed=feed, sort_by="magnitude", min_magnitude=0.0, limit=10_000
        )
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        logger.error("USGS service unavailable when computing stats (feed=%s): %s", feed, exc)
        raise HTTPException(
            status_code=503,
            detail="USGS earthquake feed is currently unreachable.",
        ) from exc

    if not earthquakes:
        return StatsResponse(
            feed=feed,
            total_count=0,
            largest_magnitude=None,
            largest_event_id=None,
            count_above_m4=0,
            count_above_m6=0,
            average_depth_km=None,
            stale=is_stale,
        )

    # Sort by magnitude descending to find largest
    sorted_by_mag = sorted(earthquakes, key=lambda e: e.magnitude, reverse=True)
    largest = sorted_by_mag[0]

    depths = [e.depth_km for e in earthquakes]
    avg_depth = round(sum(depths) / len(depths), 1) if depths else None

    return StatsResponse(
        feed=feed,
        total_count=len(earthquakes),
        largest_magnitude=largest.magnitude,
        largest_event_id=largest.id,
        count_above_m4=sum(1 for e in earthquakes if e.magnitude >= 4.0),
        count_above_m6=sum(1 for e in earthquakes if e.magnitude >= 6.0),
        average_depth_km=avg_depth,
        stale=is_stale,
    )
