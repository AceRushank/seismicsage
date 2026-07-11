"""
services/groq_service.py — AI Geological Analysis via Groq (Llama 3.1 8B Instant).

Replaces gemini_service.py — identical public interface, different provider.
The original gemini_service.py is kept as gemini_service.py.bak for easy rollback.

Design decisions:
  - AsyncGroq client — natively async, no asyncio.to_thread() wrapping needed
  - response_format={"type": "json_object"} for reliable structured output
  - temperature=0.3 — factual consistency over creative variance
  - GROQ_TIMEOUT wraps the full API call via asyncio.wait_for
  - All error paths return structured fallback responses, never raise
  - Cache key uses same prefix as before so a cache clear isn't needed on swap
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timezone

from groq import AsyncGroq, RateLimitError, APITimeoutError, APIStatusError

from config import GEMINI_CACHE_TTL, GROQ_API_KEY, GROQ_MODEL, GROQ_TIMEOUT
from models.schemas import AnalysisResponse, GeologicalContext, Earthquake
from utils.cache import gemini_cache  # reuse same cache instance — no data loss on swap

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Client (module-level, lazily initialised)
# ---------------------------------------------------------------------------

_client: AsyncGroq | None = None


def _get_client() -> AsyncGroq:
    """Return the module-level AsyncGroq client, creating it on first call."""
    global _client
    if _client is None:
        _client = AsyncGroq(api_key=GROQ_API_KEY)
    return _client


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a geological analyst explaining earthquake data to an educated but \
non-expert audience. You are given real earthquake data including magnitude, \
depth, location, and tectonic context when available.

Rules:
- Be precise and factual, never speculative without flagging it as such
- Explain WHY the depth and magnitude matter for surface impact
- Reference the specific tectonic setting if provided
- Keep the summary to 2-3 sentences maximum
- Keep risk_assessment to 1-2 sentences maximum
- Do not elaborate beyond what is asked
- Output ONLY valid JSON — no markdown, no backticks, no preamble

Required output schema:
{
  "summary": "<2-3 sentence plain-language explanation>",
  "geological_context": {
    "tectonic_setting": "<description>",
    "fault_type": "<one of: convergent | divergent | transform | strike-slip>",
    "plate_boundary": "<boundary name or null>",
    "boundary_type": "<convergent|divergent|transform|unknown or null>",
    "distance_to_boundary_km": <number or null>,
    "historical_context": "<brief regional seismic history>",
    "confidence": "<data-backed or inferred>"
  },
  "risk_assessment": "<population and infrastructure risk assessment>",
  "tags": ["<tag1>", "<tag2>", "<tag3>"]
}"""

# ---------------------------------------------------------------------------
# Public API — analyze_earthquake
# ---------------------------------------------------------------------------


async def analyze_earthquake(
    earthquake: Earthquake,
    geo_context: GeologicalContext,
) -> AnalysisResponse:
    """
    Generate or retrieve a cached AI geological analysis for an earthquake.

    Checks gemini_cache first (same cache, zero disruption on swap).
    On cache miss, calls Groq Llama 3.1 8B Instant with a structured prompt.
    Enforces GROQ_TIMEOUT and returns structured fallback on any failure.

    Never raises — always returns a valid AnalysisResponse.
    """
    cache_key = f"gemini:{earthquake.id}"   # keep same prefix — cache-compatible
    cached = gemini_cache.get(cache_key)
    if cached is not None:
        logger.debug("Cache hit for analysis of event '%s'", earthquake.id)
        cached.cached = True
        return cached

    if not GROQ_API_KEY:
        logger.error("GROQ_API_KEY is not configured — returning fallback analysis.")
        return _fallback_response(
            earthquake_id=earthquake.id,
            reason="Groq API key not configured. Set GROQ_API_KEY in .env.",
        )

    user_prompt = _build_user_prompt(earthquake, geo_context)
    client = _get_client()

    try:
        response = await asyncio.wait_for(
            client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": user_prompt},
                ],
                temperature=0.3,
                max_tokens=600,
                response_format={"type": "json_object"},
            ),
            timeout=GROQ_TIMEOUT,
        )

        raw = response.choices[0].message.content
        analysis = _parse_response(raw, earthquake.id, geo_context)
        gemini_cache.set(cache_key, analysis, ttl=GEMINI_CACHE_TTL)
        logger.info(
            "Analysis generated for '%s' via Groq %s", earthquake.id, GROQ_MODEL
        )
        return analysis

    except asyncio.TimeoutError:
        logger.warning(
            "Groq timed out after %ds for event '%s'", GROQ_TIMEOUT, earthquake.id
        )
        return _fallback_response(
            earthquake_id=earthquake.id,
            reason=f"Analysis timed out after {GROQ_TIMEOUT} seconds.",
        )

    except RateLimitError as exc:
        logger.warning("Groq rate limit hit for event '%s': %s", earthquake.id, exc)
        return _fallback_response(
            earthquake_id=earthquake.id,
            reason="Groq rate limit reached. Please retry in a moment.",
            rate_limited=True,
        )

    except APITimeoutError as exc:
        logger.warning("Groq API timeout for event '%s': %s", earthquake.id, exc)
        return _fallback_response(
            earthquake_id=earthquake.id,
            reason="Groq API timed out. Please retry shortly.",
        )

    except APIStatusError as exc:
        logger.error(
            "Groq API status error (HTTP %s) for event '%s': %s",
            exc.status_code, earthquake.id, exc,
        )
        return _fallback_response(
            earthquake_id=earthquake.id,
            reason=f"Groq API error (HTTP {exc.status_code}): {exc.message}",
        )

    except Exception as exc:
        logger.exception("Unexpected error analyzing '%s': %s", earthquake.id, exc)
        return _fallback_response(
            earthquake_id=earthquake.id,
            reason="AI analysis temporarily unavailable.",
        )


# ---------------------------------------------------------------------------
# Public API — generate_fault_insight
# ---------------------------------------------------------------------------


async def generate_fault_insight(prompt: str) -> str:
    """
    Generate a plain-text geological insight about a tectonic fault boundary.

    Accepts a pre-built prompt string (same signature as gemini_service).
    Returns a 2-3 sentence insight string, or a descriptive error message.
    Never raises.
    """
    if not GROQ_API_KEY:
        return "AI insight unavailable — GROQ_API_KEY not configured."

    client = _get_client()
    try:
        response = await asyncio.wait_for(
            client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.4,
                max_tokens=300,
            ),
            timeout=GROQ_TIMEOUT,
        )
        return response.choices[0].message.content.strip()

    except asyncio.TimeoutError:
        logger.warning("Groq fault insight timed out after %ds", GROQ_TIMEOUT)
        return f"Insight generation timed out after {GROQ_TIMEOUT} seconds. Please try again."

    except (RateLimitError, APITimeoutError, APIStatusError) as exc:
        logger.warning("Groq fault insight API error: %s", exc)
        return "AI insight temporarily unavailable. Please try again shortly."

    except Exception as exc:
        logger.exception("Unexpected fault insight error: %s", exc)
        return "AI insight temporarily unavailable."


# ---------------------------------------------------------------------------
# Health check helper  (called by main.py /health endpoint)
# ---------------------------------------------------------------------------


async def check_gemini_health() -> tuple[bool, float | None]:
    """
    Minimal Groq connectivity probe — measures round-trip latency.

    Kept named check_gemini_health so main.py needs zero changes.
    Returns (is_healthy, latency_ms).
    """
    if not GROQ_API_KEY:
        return False, None

    client = _get_client()
    start = time.monotonic()
    try:
        await asyncio.wait_for(
            client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=5,
            ),
            timeout=10.0,
        )
        latency_ms = round((time.monotonic() - start) * 1000, 1)
        return True, latency_ms

    except Exception as exc:
        logger.debug("Groq health check failed: %s", exc)
        return False, None


# ---------------------------------------------------------------------------
# Internal: prompt construction
# ---------------------------------------------------------------------------


def _build_user_prompt(earthquake: Earthquake, geo_context: GeologicalContext) -> str:
    """Build the structured user-turn prompt with all grounding data."""
    confidence_note = (
        "Tectonic context below is from Peter Bird's PB2002 plate boundary dataset (data-backed)."
        if geo_context.confidence == "data-backed"
        else "Tectonic context below is AI-inferred from regional name and depth (treat as estimate)."
    )

    dist = (
        f"{geo_context.distance_to_boundary_km:.0f} km"
        if geo_context.distance_to_boundary_km is not None
        else "Unknown"
    )

    return f"""Analyse this earthquake and produce the required JSON output.

{confidence_note}

EARTHQUAKE DATA:
- Event ID:         {earthquake.id}
- Magnitude:        {earthquake.magnitude}
- Location:         {earthquake.place}
- Latitude:         {earthquake.latitude}, Longitude: {earthquake.longitude}
- Depth:            {earthquake.depth_km} km
- Time (UTC):       {earthquake.time.isoformat()}
- Tsunami warning:  {earthquake.tsunami_warning}
- USGS significance:{earthquake.significance}
- Felt reports:     {earthquake.felt_reports or 'None reported'}

TECTONIC CONTEXT (confidence: {geo_context.confidence}):
- Tectonic setting:     {geo_context.tectonic_setting}
- Nearest boundary:     {geo_context.plate_boundary or 'Unknown'}
- Boundary type:        {geo_context.boundary_type or 'Unknown'}
- Distance to boundary: {dist}
- Inferred fault type:  {geo_context.fault_type or 'Unknown'}
- Historical context:   {geo_context.historical_context}

Respond with ONLY the JSON object described in the system prompt. No other text."""


# ---------------------------------------------------------------------------
# Internal: response parsing
# ---------------------------------------------------------------------------


def _parse_response(
    raw_text: str,
    earthquake_id: str,
    geo_context: GeologicalContext,
) -> AnalysisResponse:
    """Parse Groq's JSON response into an AnalysisResponse model."""
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        logger.warning(
            "Groq returned non-JSON for event '%s': %s", earthquake_id, exc
        )
        return _fallback_response(
            earthquake_id=earthquake_id,
            reason=f"Groq returned malformed JSON: {raw_text[:200]}",
        )

    try:
        gc_raw = data.get("geological_context", {})
        geological_context = GeologicalContext(
            tectonic_setting=gc_raw.get("tectonic_setting", geo_context.tectonic_setting),
            fault_type=gc_raw.get("fault_type", geo_context.fault_type),
            plate_boundary=gc_raw.get("plate_boundary", geo_context.plate_boundary),
            boundary_type=gc_raw.get("boundary_type", geo_context.boundary_type),
            distance_to_boundary_km=gc_raw.get(
                "distance_to_boundary_km", geo_context.distance_to_boundary_km
            ),
            historical_context=gc_raw.get(
                "historical_context", geo_context.historical_context
            ),
            confidence=gc_raw.get("confidence", geo_context.confidence),
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
# Internal: fallback response builder
# ---------------------------------------------------------------------------


def _fallback_response(
    earthquake_id: str,
    reason: str,
    rate_limited: bool = False,
) -> AnalysisResponse:
    """Build a structured fallback when Groq is unavailable. Never raises."""
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
        risk_assessment=(
            "Risk assessment unavailable — please check the USGS event page for hazard information."
        ),
        tags=tags,
        generated_at=None,
        cached=False,
    )
