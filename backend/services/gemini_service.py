"""
services/gemini_service.py — AI Geological Analysis via Gemini Flash.

Responsibilities:
  - Generate structured JSON geological analyses for earthquake events
  - Cache analyses by earthquake ID to avoid redundant API calls
  - Enforce a hard timeout to prevent hanging requests
  - Handle rate limiting gracefully without raising 500 errors
  - Use JSON mode for reliable structured output (no regex parsing)

Design decisions:
  - temperature=0.3 — factual consistency over creative variance
  - SYSTEM_PROMPT is a module-level constant for visibility and testability
  - Uses google-genai SDK (>= 0.8.0) which supports all key formats
  - Gemini is run via asyncio.to_thread() since the SDK is synchronous
  - All error paths return structured fallback responses, never raise
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

import httpx
from google import genai
from google.genai import types
from google.genai.errors import APIError, ClientError, ServerError

from config import GEMINI_CACHE_TTL, GEMINI_TIMEOUT, GOOGLE_API_KEY
from models.schemas import AnalysisResponse, GeologicalContext, Earthquake
from utils.cache import gemini_cache

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Gemini configuration
# ---------------------------------------------------------------------------

# Instantiate a module-level client. The new google-genai SDK supports
# all key formats including the AQ.* keys from Google AI Studio.
_client: genai.Client | None = None


def _get_client() -> genai.Client:
    """
    Return the module-level Gemini client, creating it on first call.

    Lazy initialisation avoids crashing at import time when no API key
    is configured (e.g. during unit tests).

    Returns:
        A configured genai.Client instance.
    """
    global _client
    if _client is None:
        _client = genai.Client(api_key=GOOGLE_API_KEY)
    return _client


_MODEL_NAME = "gemini-3.5-flash"
_TEMPERATURE = 0.3

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a geological analyst explaining earthquake data \
to an educated but non-expert audience. You are given real earthquake data \
including magnitude, depth, location, and tectonic context when available.

Rules:
- Be precise and factual, never speculative without flagging it as such
- Explain WHY the depth and magnitude matter for surface impact
- Reference the specific tectonic setting if provided
- Keep the summary to 2-3 sentences
- Generate a risk_assessment considering population density context if inferable from place name
- Under geological_context, the fault_type field must be exactly one of: convergent, divergent, transform, or strike-slip (do not use null)
- Output valid JSON matching the exact schema provided"""

# JSON schema description passed to Gemini so it knows the exact output shape
_OUTPUT_SCHEMA = """
Output a single JSON object with exactly these fields:
{
  "summary": "<2-3 sentence plain-language explanation>",
  "geological_context": {
    "tectonic_setting": "<description>",
    "fault_type": "<must be one of: convergent | divergent | transform | strike-slip>",
    "plate_boundary": "<boundary name or null>",
    "boundary_type": "<convergent|divergent|transform|unknown or null>",
    "distance_to_boundary_km": <number or null>,
    "historical_context": "<brief regional seismic history>",
    "confidence": "<data-backed or inferred>"
  },
  "risk_assessment": "<population and infrastructure risk assessment>",
  "tags": ["<tag1>", "<tag2>", ...]
}
"""

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def analyze_earthquake(
    earthquake: Earthquake,
    geo_context: GeologicalContext,
) -> AnalysisResponse:
    """
    Generate or retrieve a cached AI geological analysis for an earthquake.

    Checks the gemini_cache first using the earthquake's USGS ID as key.
    If a cached analysis exists, returns it with cached=True.
    Otherwise, calls Gemini Flash with a structured prompt, enforces a hard
    timeout, and caches the successful response.

    On rate limiting (429) or timeout, returns a structured fallback
    AnalysisResponse with a descriptive message rather than raising.

    Args:
        earthquake:  The Earthquake model to analyse.
        geo_context: Pre-computed tectonic context from geology_service.

    Returns:
        An AnalysisResponse — never raises, always returns something useful.
    """
    cache_key = f"gemini:{earthquake.id}"
    cached = gemini_cache.get(cache_key)
    if cached is not None:
        logger.debug("Cache hit for Gemini analysis of event '%s'", earthquake.id)
        cached.cached = True
        return cached

    if not GOOGLE_API_KEY:
        logger.error("GOOGLE_API_KEY is not configured — returning fallback analysis.")
        return _fallback_response(
            earthquake_id=earthquake.id,
            reason="Gemini API key not configured.",
        )

    prompt = _build_user_prompt(earthquake, geo_context)

    try:
        response_text = await asyncio.wait_for(
            asyncio.to_thread(_call_gemini_sync, prompt),
            timeout=GEMINI_TIMEOUT,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "Gemini timed out after %ds for event '%s'", GEMINI_TIMEOUT, earthquake.id
        )
        return _fallback_response(
            earthquake_id=earthquake.id,
            reason=f"Analysis timed out after {GEMINI_TIMEOUT} seconds.",
        )
    except ClientError as exc:
        # 429 rate limit, 400 bad request, etc.
        status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
        logger.warning(
            "Gemini client error (status=%s) for event '%s': %s",
            status, earthquake.id, exc,
        )
        is_rate_limited = status == 429
        return _fallback_response(
            earthquake_id=earthquake.id,
            reason=f"Gemini API error: {exc}",
            rate_limited=is_rate_limited,
        )
    except ServerError as exc:
        logger.error("Gemini server error for event '%s': %s", earthquake.id, exc)
        return _fallback_response(
            earthquake_id=earthquake.id,
            reason="Gemini service is currently unavailable.",
        )
    except APIError as exc:
        logger.error("Gemini API error for event '%s': %s", earthquake.id, exc)
        return _fallback_response(
            earthquake_id=earthquake.id,
            reason=f"Gemini API error: {exc}",
        )

    analysis = _parse_gemini_response(response_text, earthquake.id, geo_context)

    # Cache successful analysis
    gemini_cache.set(cache_key, analysis, ttl=GEMINI_CACHE_TTL)
    return analysis


# ---------------------------------------------------------------------------
# Internal: prompt construction
# ---------------------------------------------------------------------------

def _build_user_prompt(earthquake: Earthquake, geo_context: GeologicalContext) -> str:
    """
    Construct the structured user prompt sent to Gemini.

    Embeds all known earthquake data and the pre-computed tectonic context
    so Gemini has real grounding data to reason from.
    Marks AI-inferred context explicitly so the model can calibrate its
    confidence language accordingly.

    Args:
        earthquake:  The Earthquake model.
        geo_context: GeologicalContext from geology_service.

    Returns:
        A formatted string prompt for the Gemini user turn.
    """
    confidence_note = (
        "The tectonic context below is derived from Peter Bird's PB2002 plate boundary dataset (data-backed)."
        if geo_context.confidence == "data-backed"
        else "The tectonic context below is AI-inferred from regional name and depth (treat as estimate)."
    )

    return f"""Analyse the following earthquake event and provide a structured geological assessment.

{confidence_note}

EARTHQUAKE DATA:
- Event ID: {earthquake.id}
- Magnitude: {earthquake.magnitude}
- Location: {earthquake.place}
- Latitude: {earthquake.latitude}, Longitude: {earthquake.longitude}
- Depth: {earthquake.depth_km} km
- Time (UTC): {earthquake.time.isoformat()}
- Tsunami warning: {earthquake.tsunami_warning}
- USGS significance score: {earthquake.significance}
- Felt reports: {earthquake.felt_reports or 'None reported'}

TECTONIC CONTEXT (confidence: {geo_context.confidence}):
- Tectonic setting: {geo_context.tectonic_setting}
- Nearest plate boundary: {geo_context.plate_boundary or 'Unknown'}
- Boundary type: {geo_context.boundary_type or 'Unknown'}
- Distance to boundary: {f'{geo_context.distance_to_boundary_km:.0f} km' if geo_context.distance_to_boundary_km is not None else 'Unknown'}
- Inferred fault type: {geo_context.fault_type or 'Unknown'}
- Historical context: {geo_context.historical_context}

{_OUTPUT_SCHEMA}
"""


# ---------------------------------------------------------------------------
# Internal: Gemini call (synchronous, run via asyncio.to_thread)
# ---------------------------------------------------------------------------

def _call_gemini_sync(user_prompt: str) -> str:
    """
    Synchronous Gemini API call using the google-genai SDK.

    Intended to be run in a thread via asyncio.to_thread to keep the
    async event loop unblocked.

    Uses JSON response MIME type to enforce structured output.
    Sets temperature to 0.3 for factual consistency.

    Args:
        user_prompt: The fully constructed user prompt string.

    Returns:
        The raw text response from Gemini (expected to be valid JSON).

    Raises:
        ClientError: On 4xx responses (rate limit, bad request, etc.)
        ServerError: On 5xx responses from Gemini.
        APIError:    On other API-level failures.
    """
    client = _get_client()
    response = client.models.generate_content(
        model=_MODEL_NAME,
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            temperature=_TEMPERATURE,
            response_mime_type="application/json",
        ),
    )
    return response.text


# ---------------------------------------------------------------------------
# Internal: response parsing
# ---------------------------------------------------------------------------

def _parse_gemini_response(
    raw_text: str,
    earthquake_id: str,
    geo_context: GeologicalContext,
) -> AnalysisResponse:
    """
    Parse Gemini's JSON response into an AnalysisResponse model.

    If parsing fails (malformed JSON, missing fields), returns a fallback
    response with the raw text as the summary so no information is lost.

    Args:
        raw_text:      The raw text response from Gemini.
        earthquake_id: USGS earthquake ID for the response.
        geo_context:   Original GeologicalContext (used as fallback).

    Returns:
        A fully populated AnalysisResponse.
    """
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        logger.warning(
            "Gemini returned non-JSON for event '%s': %s", earthquake_id, exc
        )
        return _fallback_response(
            earthquake_id=earthquake_id,
            reason=f"Gemini returned malformed JSON: {raw_text[:200]}",
        )

    try:
        gem_context_raw = data.get("geological_context", {})
        geological_context = GeologicalContext(
            tectonic_setting=gem_context_raw.get(
                "tectonic_setting", geo_context.tectonic_setting
            ),
            fault_type=gem_context_raw.get("fault_type", geo_context.fault_type),
            plate_boundary=gem_context_raw.get(
                "plate_boundary", geo_context.plate_boundary
            ),
            boundary_type=gem_context_raw.get(
                "boundary_type", geo_context.boundary_type
            ),
            distance_to_boundary_km=gem_context_raw.get(
                "distance_to_boundary_km", geo_context.distance_to_boundary_km
            ),
            historical_context=gem_context_raw.get(
                "historical_context", geo_context.historical_context
            ),
            confidence=gem_context_raw.get("confidence", geo_context.confidence),
        )

        return AnalysisResponse(
            earthquake_id=earthquake_id,
            summary=data["summary"],
            geological_context=geological_context,
            risk_assessment=data["risk_assessment"],
            tags=data.get("tags", []),
            generated_at=datetime.now(tz=timezone.utc),
            cached=False,
        )

    except (KeyError, TypeError, ValueError) as exc:
        logger.warning(
            "Failed to build AnalysisResponse for event '%s': %s", earthquake_id, exc
        )
        return _fallback_response(
            earthquake_id=earthquake_id,
            reason=f"Analysis parsing failed: {exc}",
        )


# ---------------------------------------------------------------------------
# Fallback response builder
# ---------------------------------------------------------------------------

def _fallback_response(
    earthquake_id: str,
    reason: str,
    rate_limited: bool = False,
) -> AnalysisResponse:
    """
    Build a structured fallback AnalysisResponse when Gemini is unavailable.

    Returns a valid AnalysisResponse (not an exception) with a descriptive
    summary so the frontend can display something meaningful.

    Args:
        earthquake_id: USGS earthquake ID.
        reason:        Human-readable explanation of the failure.
        rate_limited:  If True, tags the response as rate-limited.

    Returns:
        An AnalysisResponse with generated_at=None indicating failure.
    """
    tags = ["analysis-unavailable"]
    if rate_limited:
        tags.append("rate-limited")

    return AnalysisResponse(
        earthquake_id=earthquake_id,
        summary=f"AI analysis temporarily unavailable. {reason}",
        geological_context=GeologicalContext(
            tectonic_setting="Analysis unavailable",
            fault_type=None,
            plate_boundary=None,
            boundary_type=None,
            distance_to_boundary_km=None,
            historical_context="Analysis unavailable",
            confidence="inferred",
        ),
        risk_assessment="Risk assessment unavailable — please check USGS event page for hazard information.",
        tags=tags,
        generated_at=None,
        cached=False,
    )


# ---------------------------------------------------------------------------
# Health check helper
# ---------------------------------------------------------------------------

async def check_gemini_health() -> tuple[bool, float | None]:
    """
    Perform a minimal Gemini API connectivity check.

    Sends a trivial prompt and measures round-trip latency.
    Used by the /health endpoint.

    Returns:
        A (is_healthy, latency_ms) tuple. latency_ms is None on failure.
    """
    import time

    if not GOOGLE_API_KEY:
        return False, None

    start = time.monotonic()
    try:
        await asyncio.wait_for(
            asyncio.to_thread(_call_gemini_sync, "Reply with the single word: ok"),
            timeout=10.0,
        )
        latency_ms = (time.monotonic() - start) * 1000
        return True, round(latency_ms, 1)
    except (asyncio.TimeoutError, ClientError, ServerError, APIError,
            httpx.HTTPError, ValueError, RuntimeError) as exc:
        logger.debug("Gemini health check failed: %s", exc)
        return False, None
