"""
utils/cache.py — Simple thread-safe TTL in-memory cache.

No Redis or external dependencies required for this scale.
Two module-level singletons are exported:
  - usgs_cache   — for USGS feed responses
  - gemini_cache — for Gemini analysis results, keyed by earthquake ID
"""

import threading
import time
from typing import Any


class TTLCache:
    """
    Thread-safe dictionary-backed cache with per-entry time-to-live expiry.

    Each entry stores the cached value alongside its absolute expiry
    timestamp. Expired entries are evicted lazily on access.
    """

    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, float]] = {}  # key -> (value, expires_at)
        self._lock = threading.RLock()

    def get(self, key: str) -> Any | None:
        """
        Retrieve a cached value by key.

        Returns the value if it exists and has not expired, otherwise None.
        Expired entries are removed on access (lazy eviction).
        """
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expires_at = entry
            if time.monotonic() > expires_at:
                del self._store[key]
                return None
            return value

    def set(self, key: str, value: Any, ttl: int) -> None:
        """
        Store a value under the given key with a TTL in seconds.

        Overwrites any existing entry for the same key.
        """
        with self._lock:
            expires_at = time.monotonic() + ttl
            self._store[key] = (value, expires_at)

    def delete(self, key: str) -> None:
        """Remove a single entry from the cache, if it exists."""
        with self._lock:
            self._store.pop(key, None)

    def clear(self) -> None:
        """Evict all entries from the cache."""
        with self._lock:
            self._store.clear()

    def has(self, key: str) -> bool:
        """Return True if the key exists and has not expired."""
        return self.get(key) is not None

    def __len__(self) -> int:
        """Return the number of non-expired entries (approximate)."""
        now = time.monotonic()
        with self._lock:
            return sum(1 for _, expires_at in self._store.values() if now <= expires_at)


# ---------------------------------------------------------------------------
# Module-level cache singletons
# ---------------------------------------------------------------------------

usgs_cache: TTLCache = TTLCache()
"""Cache for USGS GeoJSON feed responses. TTL = USGS_CACHE_TTL (default 60s)."""

gemini_cache: TTLCache = TTLCache()
"""Cache for Gemini analysis results, keyed by USGS earthquake ID. TTL = GEMINI_CACHE_TTL."""
