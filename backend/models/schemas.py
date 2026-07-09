"""
models/schemas.py — Pydantic v2 data models for SeismicSage.

All API request/response shapes are defined here.
No raw dicts are passed between service layers or returned to the frontend.
"""

from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Core earthquake model
# ---------------------------------------------------------------------------

class Earthquake(BaseModel):
    """Represents a single earthquake event parsed from the USGS GeoJSON feed."""

    id: str = Field(..., description="USGS event identifier")
    magnitude: float = Field(..., description="Richter / moment magnitude")
    place: str = Field(..., description="Human-readable location description")
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    depth_km: float = Field(..., description="Hypocenter depth in kilometres")
    time: datetime = Field(..., description="Event origin time (UTC)")
    url: str = Field(..., description="USGS event detail page URL")
    tsunami_warning: bool = Field(
        ..., description="True if USGS issued a tsunami warning for this event"
    )
    felt_reports: int | None = Field(
        None, description="Number of 'Did You Feel It?' reports submitted"
    )
    significance: int = Field(
        ..., description="USGS significance score (0–1000+); higher = more significant"
    )


# ---------------------------------------------------------------------------
# Geological context model
# ---------------------------------------------------------------------------

class GeologicalContext(BaseModel):
    """Tectonic and geological context for an earthquake location."""

    tectonic_setting: str = Field(
        ..., description="Broad tectonic environment (e.g. subduction zone, rift)"
    )
    fault_type: str | None = Field(
        None, description="Inferred fault mechanism (e.g. strike-slip, thrust)"
    )
    plate_boundary: str | None = Field(
        None, description="Nearest named plate boundary (e.g. 'NA-PA')"
    )
    boundary_type: str | None = Field(
        None,
        description="Boundary interaction type: convergent, divergent, or transform",
    )
    distance_to_boundary_km: float | None = Field(
        None, description="Straight-line distance to nearest plate boundary in km"
    )
    historical_context: str = Field(
        ..., description="Brief note on regional seismic history"
    )
    confidence: Literal["data-backed", "inferred"] = Field(
        ...,
        description=(
            "'data-backed' when derived from PB2002 plate boundary geometry; "
            "'inferred' when Gemini reasons from regional name and depth"
        ),
    )


# ---------------------------------------------------------------------------
# AI analysis response model
# ---------------------------------------------------------------------------

class AnalysisResponse(BaseModel):
    """Full AI-generated geological analysis for a single earthquake event."""

    earthquake_id: str = Field(..., description="USGS event ID this analysis applies to")
    summary: str = Field(..., description="2–3 sentence plain-language summary")
    geological_context: GeologicalContext
    risk_assessment: str = Field(
        ...,
        description=(
            "Population and infrastructure risk assessment, "
            "considering depth, magnitude, and inferred region density"
        ),
    )
    tags: list[str] = Field(..., description="Keyword tags for filtering/display")
    generated_at: datetime | None = Field(
        None,
        description="UTC timestamp of analysis generation; null if generation failed",
    )
    cached: bool = Field(
        False, description="True if this response was served from cache"
    )


# ---------------------------------------------------------------------------
# List / pagination response wrappers
# ---------------------------------------------------------------------------

class EarthquakeListResponse(BaseModel):
    """Paginated list of earthquake events with metadata."""

    earthquakes: list[Earthquake]
    total_count: int = Field(..., description="Total events in the current feed")
    returned_count: int = Field(..., description="Number of events in this response")
    feed: str = Field(..., description="USGS feed identifier used for this request")
    stale: bool = Field(
        False,
        description=(
            "True if the response is served from a stale cache "
            "because the USGS API was unreachable"
        ),
    )
    fetched_at: datetime | None = Field(
        None, description="When the underlying USGS data was last successfully fetched"
    )


# ---------------------------------------------------------------------------
# Stats response model
# ---------------------------------------------------------------------------

class StatsResponse(BaseModel):
    """Aggregate statistics computed server-side from the current feed."""

    feed: str
    total_count: int
    largest_magnitude: float | None = Field(
        None, description="Highest magnitude in the feed"
    )
    largest_event_id: str | None = Field(
        None, description="USGS ID of the highest-magnitude event"
    )
    count_above_m4: int = Field(..., description="Events with magnitude >= 4.0")
    count_above_m6: int = Field(..., description="Events with magnitude >= 6.0")
    average_depth_km: float | None = Field(
        None, description="Mean depth across all events in the feed"
    )
    stale: bool = False


# ---------------------------------------------------------------------------
# Health check models
# ---------------------------------------------------------------------------

class ServiceStatus(BaseModel):
    """Status of a single downstream service dependency."""

    status: Literal["ok", "degraded", "down"]
    latency_ms: float | None = None
    detail: str | None = None


class HealthResponse(BaseModel):
    """Overall health of the SeismicSage backend and its dependencies."""

    status: Literal["ok", "degraded", "down"]
    usgs: ServiceStatus
    gemini: ServiceStatus
    plate_data: ServiceStatus
    version: str = "1.0.0"
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------------
# Error response model
# ---------------------------------------------------------------------------

class ErrorResponse(BaseModel):
    """Structured error envelope returned by the global exception handler."""

    error: str = Field(..., description="Short machine-readable error code")
    message: str = Field(..., description="Human-readable explanation")
    detail: str | None = Field(None, description="Additional debug context")
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------------
# Fault analysis models
# ---------------------------------------------------------------------------

class FaultAnalysisRequest(BaseModel):
    """Request body for POST /api/analyze/fault."""

    boundary_type: str = Field(
        ..., description="Plate boundary type: subduction | transform | spreading"
    )
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    nearby_earthquake_ids: list[str] = Field(
        default_factory=list, description="USGS IDs of nearby quakes for context"
    )


class FaultAnalysisResponse(BaseModel):
    """AI-generated insight about a tectonic plate boundary location."""

    insight: str = Field(..., description="2-3 sentence geological insight")
    boundary_type: str
    latitude: float
    longitude: float
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

