"""
main.py — SeismicSage FastAPI Application Entry Point.

This file contains only app wiring:
  - FastAPI instance creation with full OpenAPI metadata
  - CORS middleware configuration
  - Router registration
  - Startup event (loads PB2002 plate boundary data)
  - Global exception handler (structured JSON, never raw tracebacks)
  - /health endpoint
  - /api/stats convenience route (delegates to earthquakes router)

All business logic lives in routers/ and services/.
"""

import logging
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import FRONTEND_URL, LOG_LEVEL
from models.schemas import ErrorResponse, HealthResponse, ServiceStatus
from routers import analysis, earthquakes
from services import gemini_service
from services.geology_service import is_plate_data_loaded, load_plate_boundaries

# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lifespan handler (startup / shutdown)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage application startup and shutdown lifecycle.

    On startup: downloads and caches Peter Bird's PB2002 plate boundary data.
    Failure is non-fatal — the geology service falls back to AI-inferred context.
    """
    logger.info("SeismicSage starting up...")
    success = await load_plate_boundaries()
    if success:
        logger.info("PB2002 plate boundary data ready.")
    else:
        logger.warning(
            "PB2002 plate data unavailable — geology service will use AI-inferred context."
        )
    yield
    logger.info("SeismicSage shutting down.")


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="SeismicSage API",
    description=(
        "Real-time earthquake data aggregation and AI-powered geological analysis. "
        "Data sourced from the USGS Earthquake Hazards Program. "
        "Geological context grounded in Peter Bird's PB2002 tectonic plate boundary model. "
        "AI analysis powered by Google Gemini Flash."
    ),
    version="1.0.0",
    contact={
        "name": "SeismicSage",
        "url": "https://github.com/your-username/seismicsage",
    },
    license_info={
        "name": "MIT",
    },
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ---------------------------------------------------------------------------
# CORS middleware
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Router registration
# ---------------------------------------------------------------------------

app.include_router(earthquakes.router)
app.include_router(analysis.router)

# ---------------------------------------------------------------------------
# Global exception handler
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Catch-all exception handler that returns structured JSON errors.

    Ensures no raw Python tracebacks are ever exposed to API consumers.
    Logs the full context (method, path, exception type) for debugging.
    """
    logger.exception(
        "Unhandled exception on %s %s: %s",
        request.method,
        request.url.path,
        exc,
    )
    error_response = ErrorResponse(
        error="internal_server_error",
        message="An unexpected error occurred. Please try again.",
        detail=type(exc).__name__,
    )
    return JSONResponse(
        status_code=500,
        content=error_response.model_dump(mode="json"),
    )


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------

@app.get(
    "/health",
    response_model=HealthResponse,
    summary="Service health check",
    description=(
        "Returns the operational status of SeismicSage and its dependencies: "
        "USGS earthquake feed, Gemini AI API, and PB2002 plate data. "
        "Useful for deployment health checks and monitoring."
    ),
    tags=["Health"],
)
async def health_check() -> HealthResponse:
    """
    Check connectivity to USGS and Gemini, and confirm plate data is loaded.

    Each dependency is probed independently. Overall status is:
      - 'ok'       — all dependencies healthy
      - 'degraded' — one or more dependencies down but core function available
      - 'down'     — critical failures preventing basic operation
    """
    # --- Check USGS ---
    usgs_status = await _check_usgs_health()

    # --- Check Gemini ---
    gemini_ok, gemini_latency = await gemini_service.check_gemini_health()
    gemini_status = ServiceStatus(
        status="ok" if gemini_ok else "down",
        latency_ms=gemini_latency,
        detail=None if gemini_ok else "Gemini API unreachable or API key not configured.",
    )

    # --- Check plate data ---
    plate_loaded = is_plate_data_loaded()
    plate_status = ServiceStatus(
        status="ok" if plate_loaded else "degraded",
        detail=(
            "PB2002 plate boundary data loaded."
            if plate_loaded
            else "Plate boundary data unavailable; geology service using AI-inferred context."
        ),
    )

    # --- Determine overall status ---
    if not usgs_status.status == "ok":
        overall = "down"
    elif not gemini_ok or not plate_loaded:
        overall = "degraded"
    else:
        overall = "ok"

    return HealthResponse(
        status=overall,
        usgs=usgs_status,
        gemini=gemini_status,
        plate_data=plate_status,
    )


async def _check_usgs_health() -> ServiceStatus:
    """
    Probe USGS with a lightweight request to confirm reachability.

    Fetches the significant_week feed URL with a 5-second timeout.
    Returns a ServiceStatus with measured latency.

    Returns:
        A ServiceStatus reflecting USGS connectivity.
    """
    usgs_probe_url = (
        "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson"
    )
    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.head(usgs_probe_url)
            response.raise_for_status()
        latency_ms = round((time.monotonic() - start) * 1000, 1)
        return ServiceStatus(status="ok", latency_ms=latency_ms)
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        return ServiceStatus(
            status="down",
            detail=f"USGS probe failed: {exc}",
        )


# ---------------------------------------------------------------------------
# Root redirect to docs
# ---------------------------------------------------------------------------

@app.get("/", include_in_schema=False)
async def root() -> JSONResponse:
    """Redirect root path visitors to the interactive API docs."""
    return JSONResponse(
        content={
            "message": "SeismicSage API v1.0.0 — visit /docs for interactive documentation.",
            "docs": "/docs",
            "health": "/health",
        }
    )
