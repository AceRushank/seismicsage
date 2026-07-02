"""
config.py — Central configuration for SeismicSage backend.

All environment variables are loaded here via python-dotenv.
All constants live here — no magic numbers elsewhere in the codebase.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# External API URLs
# ---------------------------------------------------------------------------

USGS_BASE_URL: str = (
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{feed}.geojson"
)

# Peter Bird's PB2002 tectonic plate boundary dataset, hosted on GitHub.
# Citation: Bird, P. (2003). An updated digital model of plate boundaries.
# Geochemistry, Geophysics, Geosystems, 4(3).
# https://doi.org/10.1029/2001GC000252
PLATE_BOUNDARY_URL: str = (
    "https://raw.githubusercontent.com/fraxen/tectonicplates/master"
    "/GeoJSON/PB2002_boundaries.json"
)

# ---------------------------------------------------------------------------
# Local file paths
# ---------------------------------------------------------------------------

PLATE_BOUNDARY_PATH: str = "data/plate_boundaries.geojson"

# ---------------------------------------------------------------------------
# Valid parameter values
# ---------------------------------------------------------------------------

VALID_FEEDS: list[str] = [
    "significant_week",
    "4.5_day",
    "2.5_day",
    "all_day",
    "significant_month",
]

VALID_SORT_BY: list[str] = ["time", "magnitude", "depth"]

# ---------------------------------------------------------------------------
# Cache TTLs (seconds)
# ---------------------------------------------------------------------------

USGS_CACHE_TTL: int = int(os.getenv("USGS_CACHE_TTL_SECONDS", "60"))
GEMINI_CACHE_TTL: int = int(os.getenv("GEMINI_CACHE_TTL_SECONDS", "3600"))

# ---------------------------------------------------------------------------
# HTTP / network settings
# ---------------------------------------------------------------------------

GEMINI_TIMEOUT: int = int(os.getenv("GEMINI_TIMEOUT_SECONDS", "10"))
HTTP_TIMEOUT: int = 15  # general httpx client timeout
MAX_RETRIES: int = 3
RETRY_WAIT_MIN: float = 1.0   # seconds — minimum exponential backoff wait
RETRY_WAIT_MAX: float = 8.0   # seconds — maximum exponential backoff wait

# ---------------------------------------------------------------------------
# Query parameter limits / defaults
# ---------------------------------------------------------------------------

DEFAULT_FEED: str = "significant_week"
DEFAULT_LIMIT: int = 50
MAX_LIMIT: int = 500
DEFAULT_SORT_BY: str = "time"
DEFAULT_MIN_MAGNITUDE: float = 0.0

# Nearest boundary distance threshold (km) — beyond this, context is "inferred"
MAX_BOUNDARY_DISTANCE_KM: float = 500.0

# ---------------------------------------------------------------------------
# Secrets & deployment
# ---------------------------------------------------------------------------

GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000")
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").upper()
