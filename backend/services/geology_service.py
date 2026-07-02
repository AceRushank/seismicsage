"""
services/geology_service.py — Tectonic Plate Boundary Lookup Service.

This service is the scientific differentiator of SeismicSage.
Rather than relying entirely on Gemini to hallucinate tectonic context,
it uses real plate boundary geometry to ground the AI analysis in data.

Data Source:
    Peter Bird's PB2002 tectonic plate boundary model.
    Bird, P. (2003). An updated digital model of plate boundaries.
    Geochemistry, Geophysics, Geosystems, 4(3).
    https://doi.org/10.1029/2001GC000252

    Hosted via the fraxen/tectonicplates GitHub mirror:
    https://github.com/fraxen/tectonicplates

Approach:
    1. On startup, download PB2002_boundaries.json and cache it locally.
    2. Load each boundary segment as a Shapely LineString.
    3. For a given (lat, lng), compute the nearest boundary and classify
       the tectonic setting from the boundary's Type property.
    4. If the plate data is unavailable, fall back to an "inferred"
       GeologicalContext stub — Gemini will fill the details.
"""

import json
import logging
import math
import os
from pathlib import Path

import httpx

from config import (
    HTTP_TIMEOUT,
    MAX_BOUNDARY_DISTANCE_KM,
    PLATE_BOUNDARY_PATH,
    PLATE_BOUNDARY_URL,
)
from models.schemas import GeologicalContext

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level state — loaded once at startup
# ---------------------------------------------------------------------------

# Each entry: {"name": str, "plate_a": str, "plate_b": str, "type": str,
#              "coordinates": list[tuple[float, float]]}
_plate_segments: list[dict] = []
_plate_data_loaded: bool = False


# ---------------------------------------------------------------------------
# Startup loader
# ---------------------------------------------------------------------------

async def load_plate_boundaries() -> bool:
    """
    Download and cache the PB2002 plate boundary GeoJSON, then load it into memory.

    Called once during FastAPI's startup event. Saves to PLATE_BOUNDARY_PATH
    for offline use on subsequent cold starts. Returns True on success.

    Data source: Peter Bird's PB2002 model via fraxen/tectonicplates on GitHub.
    Citation: Bird, P. (2003). Geochemistry, Geophysics, Geosystems, 4(3).
              https://doi.org/10.1029/2001GC000252

    Returns:
        True if plate data was loaded successfully, False on any failure.
    """
    global _plate_data_loaded

    local_path = Path(PLATE_BOUNDARY_PATH)

    # Try loading from local cache first (avoids network on warm restarts)
    if local_path.exists():
        try:
            _load_from_file(local_path)
            logger.info(
                "PB2002 plate boundaries loaded from local cache (%d segments).",
                len(_plate_segments),
            )
            _plate_data_loaded = True
            return True
        except (json.JSONDecodeError, OSError, KeyError, ValueError) as exc:
            logger.warning("Failed to load cached plate boundaries: %s", exc)

    # Download from GitHub
    logger.info("Downloading PB2002 plate boundaries from %s", PLATE_BOUNDARY_URL)
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            response = await client.get(PLATE_BOUNDARY_URL)
            response.raise_for_status()
            geojson_data = response.json()

        # Persist locally
        local_path.parent.mkdir(parents=True, exist_ok=True)
        with open(local_path, "w", encoding="utf-8") as f:
            json.dump(geojson_data, f)

        _load_from_geojson(geojson_data)
        logger.info(
            "PB2002 plate boundaries downloaded and cached (%d segments).",
            len(_plate_segments),
        )
        _plate_data_loaded = True
        return True

    except (httpx.HTTPError, httpx.TimeoutException, json.JSONDecodeError) as exc:
        logger.error(
            "Could not load PB2002 plate boundaries: %s. "
            "Geology service will use AI-inferred context.",
            exc,
        )
        _plate_data_loaded = False
        return False


# ---------------------------------------------------------------------------
# Public lookup API
# ---------------------------------------------------------------------------

def get_tectonic_context(
    lat: float,
    lng: float,
    depth_km: float,
) -> GeologicalContext:
    """
    Return the tectonic context for a given earthquake location.

    When plate boundary data is available, computes the nearest PB2002
    boundary segment using haversine-based point-to-polyline distance and
    returns a 'data-backed' GeologicalContext.

    When plate data is unavailable, returns a stub 'inferred' context so
    Gemini can fill in the details from regional name and depth heuristics.

    Args:
        lat:      Earthquake latitude in decimal degrees.
        lng:      Earthquake longitude in decimal degrees.
        depth_km: Hypocenter depth in kilometres.

    Returns:
        A GeologicalContext with confidence='data-backed' or 'inferred'.
    """
    if not _plate_data_loaded or not _plate_segments:
        return _inferred_context(depth_km)

    nearest = _find_nearest_segment(lat, lng)
    if nearest is None:
        return _inferred_context(depth_km)

    distance_km, segment = nearest

    boundary_name = segment["name"]
    raw_type = segment.get("type", "").lower()
    boundary_type = _classify_boundary_type(raw_type, segment)
    tectonic_setting = _describe_tectonic_setting(boundary_type, distance_km, depth_km)
    fault_type = _infer_fault_type(boundary_type, depth_km)
    historical_context = _historical_context_stub(boundary_name, boundary_type)

    confidence: str
    if distance_km <= MAX_BOUNDARY_DISTANCE_KM:
        confidence = "data-backed"
    else:
        # Too far from any boundary — boundary context is less meaningful
        confidence = "inferred"

    return GeologicalContext(
        tectonic_setting=tectonic_setting,
        fault_type=fault_type,
        plate_boundary=boundary_name,
        boundary_type=boundary_type,
        distance_to_boundary_km=round(distance_km, 1),
        historical_context=historical_context,
        confidence=confidence,
    )


def is_plate_data_loaded() -> bool:
    """Return True if the PB2002 plate boundary data is currently loaded in memory."""
    return _plate_data_loaded


# ---------------------------------------------------------------------------
# Internal: GeoJSON loading
# ---------------------------------------------------------------------------

def _load_from_file(path: Path) -> None:
    """Load plate boundary GeoJSON from a local file path."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    _load_from_geojson(data)


def _load_from_geojson(data: dict) -> None:
    """
    Parse a GeoJSON FeatureCollection of plate boundary LineStrings into
    the module-level _plate_segments list.

    Each segment dict contains:
      name       - "PlateA-PlateB" identifier
      plate_a    - First plate code
      plate_b    - Second plate code
      type       - Raw boundary type string from PB2002 properties
      coordinates - list of (lng, lat) tuples forming the polyline
    """
    global _plate_segments
    _plate_segments = []

    for feature in data.get("features", []):
        props = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}

        if geometry.get("type") != "LineString":
            continue

        coordinates = geometry.get("coordinates", [])
        if len(coordinates) < 2:
            continue

        name = props.get("Name", "")
        plate_a = props.get("PlateA", "")
        plate_b = props.get("PlateB", "")
        boundary_type = props.get("Type", "")
        source = props.get("Source", "")

        _plate_segments.append(
            {
                "name": name,
                "plate_a": plate_a,
                "plate_b": plate_b,
                "type": boundary_type,
                "source": source,
                "coordinates": [(c[0], c[1]) for c in coordinates],  # (lng, lat)
            }
        )


# ---------------------------------------------------------------------------
# Internal: nearest boundary search
# ---------------------------------------------------------------------------

def _find_nearest_segment(
    lat: float, lng: float
) -> tuple[float, dict] | None:
    """
    Find the nearest plate boundary segment to the given coordinates.

    Uses haversine distance from the point to each segment's polyline nodes.
    This is an approximation (node-based, not true point-to-segment) that is
    accurate enough for geological classification purposes.

    Args:
        lat: Earthquake latitude (decimal degrees).
        lng: Earthquake longitude (decimal degrees).

    Returns:
        A (distance_km, segment_dict) tuple for the nearest segment, or None.
    """
    if not _plate_segments:
        return None

    min_distance = float("inf")
    nearest_segment: dict | None = None

    for segment in _plate_segments:
        for seg_lng, seg_lat in segment["coordinates"]:
            dist = _haversine_km(lat, lng, seg_lat, seg_lng)
            if dist < min_distance:
                min_distance = dist
                nearest_segment = segment

    if nearest_segment is None:
        return None

    return min_distance, nearest_segment


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great-circle distance between two points on Earth.

    Uses the haversine formula. Accurate to ~0.5% for typical distances.

    Args:
        lat1, lon1: First point in decimal degrees.
        lat2, lon2: Second point in decimal degrees.

    Returns:
        Distance in kilometres.
    """
    earth_radius_km = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return earth_radius_km * c


# ---------------------------------------------------------------------------
# Internal: classification helpers
# ---------------------------------------------------------------------------

def _classify_boundary_type(raw_type: str, segment: dict) -> str:
    """
    Map the PB2002 raw Type field to a standardised boundary classification.

    PB2002 boundary types include: subduction, ridge, transform, trench,
    and empty strings for unclassified segments.

    Args:
        raw_type: Lowercase raw Type string from PB2002 properties.
        segment:  Full segment dict (used to inspect plate codes for context).

    Returns:
        One of: "convergent", "divergent", "transform", "unknown".
    """
    if "subduction" in raw_type or "trench" in raw_type:
        return "convergent"
    if "ridge" in raw_type or "spreading" in raw_type or "rift" in raw_type:
        return "divergent"
    if "transform" in raw_type or "fault" in raw_type:
        return "transform"
    # Many PB2002 segments have an empty Type — use plate code heuristics
    name = segment.get("name", "").upper()
    if any(code in name for code in ("PA-NA", "PA-AU", "NA-CA")):
        return "transform"
    return "unknown"


def _describe_tectonic_setting(
    boundary_type: str, distance_km: float, depth_km: float
) -> str:
    """
    Compose a human-readable tectonic setting description.

    Args:
        boundary_type: Standardised boundary type string.
        distance_km:   Distance from epicentre to nearest boundary (km).
        depth_km:      Earthquake hypocenter depth (km).

    Returns:
        A descriptive sentence about the tectonic environment.
    """
    proximity = (
        "adjacent to" if distance_km < 50
        else "near" if distance_km < 200
        else "in the interior of a region near"
    )

    depth_label = (
        "shallow-focus" if depth_km < 70
        else "intermediate-depth" if depth_km < 300
        else "deep-focus"
    )

    setting_map = {
        "convergent": f"A {depth_label} earthquake {proximity} a convergent plate boundary (subduction zone or collision zone).",
        "divergent": f"A {depth_label} earthquake {proximity} a divergent plate boundary (mid-ocean ridge or rift zone).",
        "transform": f"A {depth_label} earthquake {proximity} a transform fault boundary.",
        "unknown": f"A {depth_label} earthquake in a region with complex or uncertain plate boundary configuration.",
    }
    return setting_map.get(boundary_type, setting_map["unknown"])


def _infer_fault_type(boundary_type: str, depth_km: float) -> str | None:
    """
    Infer the most likely fault mechanism from boundary type and depth.

    This is a heuristic — real fault typing requires moment tensor data.
    Marked clearly as 'inferred' via the parent GeologicalContext.confidence.

    Args:
        boundary_type: Standardised boundary type string.
        depth_km:      Earthquake hypocenter depth (km).

    Returns:
        A fault type string, or None if no reasonable inference is possible.
    """
    fault_map = {
        "convergent": "reverse (thrust)" if depth_km < 100 else "deep intraslab",
        "divergent": "normal",
        "transform": "strike-slip",
    }
    return fault_map.get(boundary_type)


def _historical_context_stub(boundary_name: str, boundary_type: str) -> str:
    """
    Return a brief, data-grounded historical context note.

    The stub provides Gemini with a starting frame; Gemini's prompt asks it
    to expand with region-specific history.

    Args:
        boundary_name: PB2002 boundary name (e.g. "NA-PA").
        boundary_type: Standardised boundary type string.

    Returns:
        A short contextual note string.
    """
    type_context = {
        "convergent": "Subduction zones are among the most seismically active regions on Earth and are capable of generating megathrust earthquakes above M9.",
        "divergent": "Divergent boundaries produce frequent moderate seismicity as the lithosphere is pulled apart; large tsunamigenic events are less common.",
        "transform": "Transform faults generate predominantly strike-slip earthquakes; the San Andreas and Alpine faults are classic examples.",
        "unknown": "The boundary configuration in this region is complex; further analysis is needed to characterise the seismic regime.",
    }
    base = type_context.get(boundary_type, type_context["unknown"])
    return f"Boundary {boundary_name}: {base}"


def _inferred_context(depth_km: float) -> GeologicalContext:
    """
    Return a fallback GeologicalContext when plate data is unavailable.

    The confidence field is set to 'inferred', signalling to callers and to
    Gemini that this context should be treated as a starting estimate only.

    Args:
        depth_km: Earthquake depth, used for depth-label classification.

    Returns:
        A GeologicalContext stub with confidence='inferred'.
    """
    depth_label = (
        "shallow-focus" if depth_km < 70
        else "intermediate-depth" if depth_km < 300
        else "deep-focus"
    )
    return GeologicalContext(
        tectonic_setting=(
            f"A {depth_label} earthquake; tectonic setting to be inferred "
            "from regional geological context."
        ),
        fault_type=None,
        plate_boundary=None,
        boundary_type=None,
        distance_to_boundary_km=None,
        historical_context=(
            "Plate boundary data currently unavailable. "
            "Tectonic context is AI-inferred from location and depth."
        ),
        confidence="inferred",
    )
