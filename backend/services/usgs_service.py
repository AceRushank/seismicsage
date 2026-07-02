"""
services/usgs_service.py — USGS Earthquake Feed Fetcher.

Responsibilities:
  - Fetch real-time GeoJSON earthquake data from the USGS public API
  - Parse raw GeoJSON features into typed Earthquake Pydantic models
  - Cache responses with a configurable TTL (default 60s) to avoid
    hammering the USGS API on every frontend request
  - Retry failed requests with exponential backoff (max 3 attempts)
  - Return stale cached data with a `stale=True` flag when USGS is down,
    rather than failing the request entirely
  - Skip and log malformed feed entries instead of crashing

USGS feed documentation:
https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
"""

import logging
from datetime import datetime, timezone

import httpx
from tenacity import (
    AsyncRetrying,
    RetryError,
    stop_after_attempt,
    wait_exponential,
)

from config import (
    DEFAULT_SORT_BY,
    HTTP_TIMEOUT,
    MAX_RETRIES,
    RETRY_WAIT_MAX,
    RETRY_WAIT_MIN,
    USGS_BASE_URL,
    USGS_CACHE_TTL,
    VALID_FEEDS,
    VALID_SORT_BY,
)
from models.schemas import Earthquake
from utils.cache import usgs_cache

logger = logging.getLogger(__name__)

# Cache key prefix for USGS feed responses
_CACHE_KEY_PREFIX = "usgs_feed:"

# Sentinel stored alongside the cached earthquake list so we know when it was fetched
_CACHE_TIMESTAMP_SUFFIX = ":fetched_at"


async def fetch_earthquakes(
    feed: str = "significant_week",
    sort_by: str = DEFAULT_SORT_BY,
    min_magnitude: float = 0.0,
    limit: int = 50,
) -> tuple[list[Earthquake], bool, datetime | None]:
    """
    Fetch and return a filtered, sorted list of earthquake events.

    Attempts to retrieve fresh data from the USGS GeoJSON feed. On network
    failure, falls back to the last successfully cached response and sets
    the `stale` flag to True. When no cache exists and USGS is unreachable,
    raises an httpx.HTTPError so the router can return a 503.

    Args:
        feed:          USGS feed identifier (must be in VALID_FEEDS).
        sort_by:       Sort field — "time", "magnitude", or "depth".
        min_magnitude: Lower bound filter on magnitude (inclusive).
        limit:         Maximum number of results to return.

    Returns:
        A 3-tuple of:
          - list[Earthquake]: Parsed and filtered earthquake events
          - bool:             True if data is served from a stale cache
          - datetime | None:  UTC timestamp of the last successful fetch
    """
    if feed not in VALID_FEEDS:
        raise ValueError(f"Invalid feed '{feed}'. Valid options: {VALID_FEEDS}")
    if sort_by not in VALID_SORT_BY:
        raise ValueError(f"Invalid sort_by '{sort_by}'. Valid options: {VALID_SORT_BY}")

    cache_key = f"{_CACHE_KEY_PREFIX}{feed}"
    ts_key = f"{cache_key}{_CACHE_TIMESTAMP_SUFFIX}"

    # --- Attempt fresh fetch with retry logic ---
    try:
        raw_features = await _fetch_with_retry(feed)
        earthquakes = _parse_features(raw_features)

        usgs_cache.set(cache_key, earthquakes, ttl=USGS_CACHE_TTL)
        fetched_at = datetime.now(tz=timezone.utc)
        usgs_cache.set(ts_key, fetched_at, ttl=USGS_CACHE_TTL)

        logger.info(
            "Fetched %d events from USGS feed '%s'", len(earthquakes), feed
        )
        is_stale = False

    except (RetryError, httpx.HTTPError, httpx.TimeoutException) as exc:
        logger.warning(
            "USGS fetch failed for feed '%s': %s. Checking cache.", feed, exc
        )
        cached = usgs_cache.get(cache_key)
        if cached is not None:
            earthquakes = cached
            fetched_at = usgs_cache.get(ts_key)
            is_stale = True
            logger.info(
                "Serving stale cache for feed '%s' (%d events)", feed, len(earthquakes)
            )
        else:
            logger.error(
                "No cache available for feed '%s' and USGS is unreachable.", feed
            )
            raise  # Let the router return 503

    # --- Filter and sort ---
    earthquakes = [e for e in earthquakes if e.magnitude >= min_magnitude]
    earthquakes = _sort_earthquakes(earthquakes, sort_by)

    return earthquakes[:limit], is_stale, fetched_at if not is_stale else usgs_cache.get(ts_key)


async def get_earthquake_by_id(
    earthquake_id: str,
    feed: str = "significant_week",
) -> Earthquake | None:
    """
    Return a single earthquake by its USGS event ID from the specified feed.

    Triggers a feed fetch (using cache if warm) and scans for the matching ID.
    Returns None if the ID is not found in the current feed window.

    Args:
        earthquake_id: USGS event identifier string.
        feed:          USGS feed to search within.

    Returns:
        The matching Earthquake, or None if not found.
    """
    earthquakes, _, _ = await fetch_earthquakes(feed=feed, limit=10_000)
    for eq in earthquakes:
        if eq.id == earthquake_id:
            return eq
    return None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _fetch_with_retry(feed: str) -> list[dict]:
    """
    Perform an HTTP GET against the USGS GeoJSON endpoint with exponential backoff.

    Uses tenacity's AsyncRetrying to retry up to MAX_RETRIES times on
    httpx transport errors or non-2xx responses, with jittered wait between
    RETRY_WAIT_MIN and RETRY_WAIT_MAX seconds.

    Args:
        feed: USGS feed identifier (already validated by the caller).

    Returns:
        The raw list of GeoJSON feature dicts from the API response.

    Raises:
        RetryError:           All retry attempts exhausted.
        httpx.HTTPStatusError: Non-retriable HTTP error.
    """
    url = USGS_BASE_URL.format(feed=feed)

    async for attempt in AsyncRetrying(
        stop=stop_after_attempt(MAX_RETRIES),
        wait=wait_exponential(min=RETRY_WAIT_MIN, max=RETRY_WAIT_MAX),
        reraise=True,
    ):
        with attempt:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
                response = await client.get(url)
                response.raise_for_status()
                data = response.json()
                return data.get("features", [])

    # unreachable — tenacity raises before reaching here
    return []  # pragma: no cover


def _parse_features(features: list[dict]) -> list[Earthquake]:
    """
    Convert a list of raw USGS GeoJSON feature dicts into Earthquake models.

    Malformed entries (null magnitude, missing geometry, missing ID) are
    skipped and logged rather than crashing the entire parse.

    USGS GeoJSON structure reference:
    https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php

    Args:
        features: Raw list of GeoJSON feature objects from USGS.

    Returns:
        List of valid Earthquake models, sorted descending by time.
    """
    earthquakes: list[Earthquake] = []

    for feature in features:
        try:
            parsed = _parse_feature(feature)
            if parsed is not None:
                earthquakes.append(parsed)
        except (TypeError, ValueError, KeyError, IndexError) as exc:
            event_id = feature.get("id", "unknown")
            logger.debug("Skipping malformed USGS feature '%s': %s", event_id, exc)

    return earthquakes


def _parse_feature(feature: dict) -> Earthquake | None:
    """
    Parse a single USGS GeoJSON feature dict into an Earthquake model.

    Returns None (and logs a debug message) for entries that are missing
    required fields such as magnitude, coordinates, or event ID.

    Args:
        feature: A single GeoJSON feature object from the USGS feed.

    Returns:
        An Earthquake model, or None for invalid/incomplete entries.
    """
    event_id: str | None = feature.get("id")
    if not event_id:
        logger.debug("Skipping USGS feature with no ID")
        return None

    props: dict = feature.get("properties") or {}
    geometry: dict = feature.get("geometry") or {}

    magnitude = props.get("mag")
    if magnitude is None:
        logger.debug("Skipping event '%s': null magnitude", event_id)
        return None

    coordinates: list | None = geometry.get("coordinates")
    if not coordinates or len(coordinates) < 3:
        logger.debug("Skipping event '%s': missing or incomplete coordinates", event_id)
        return None

    longitude, latitude, depth_km = (
        float(coordinates[0]),
        float(coordinates[1]),
        float(coordinates[2]),
    )

    place: str = props.get("place") or "Unknown location"
    url: str = props.get("url") or ""
    tsunami_warning: bool = bool(props.get("tsunami", 0))
    felt_reports: int | None = props.get("felt")
    significance: int = int(props.get("sig", 0))

    # USGS timestamps are milliseconds since epoch (UTC)
    time_ms: int | None = props.get("time")
    if time_ms is None:
        logger.debug("Skipping event '%s': missing time field", event_id)
        return None

    event_time = datetime.fromtimestamp(time_ms / 1000.0, tz=timezone.utc)

    return Earthquake(
        id=event_id,
        magnitude=float(magnitude),
        place=place,
        latitude=latitude,
        longitude=longitude,
        depth_km=depth_km,
        time=event_time,
        url=url,
        tsunami_warning=tsunami_warning,
        felt_reports=felt_reports,
        significance=significance,
    )


def _sort_earthquakes(earthquakes: list[Earthquake], sort_by: str) -> list[Earthquake]:
    """
    Sort a list of Earthquake models by the specified field, descending.

    Args:
        earthquakes: Unsorted list of Earthquake models.
        sort_by:     One of "time", "magnitude", or "depth".

    Returns:
        Sorted list (descending) by the specified attribute.
    """
    key_map: dict[str, str] = {
        "time": "time",
        "magnitude": "magnitude",
        "depth": "depth_km",
    }
    attr = key_map.get(sort_by, "time")
    return sorted(earthquakes, key=lambda eq: getattr(eq, attr), reverse=True)
