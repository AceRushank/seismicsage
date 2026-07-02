# SeismicSage Backend

A production-grade FastAPI service that aggregates real-time earthquake data from USGS and generates AI-powered geological analysis using Google Gemini Flash.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│              Vercel Frontend                │
└───────────────────┬─────────────────────────┘
                    │ HTTPS
┌───────────────────▼─────────────────────────┐
│          FastAPI (Render / Uvicorn)         │
│                                             │
│  routers/                                   │
│    earthquakes.py  →  GET /api/earthquakes  │
│    analysis.py     →  POST /api/analyze     │
│                                             │
│  services/                                  │
│    usgs_service.py    ─── USGS GeoJSON API  │
│    geology_service.py ─── PB2002 plate data │
│    gemini_service.py  ─── Gemini Flash API  │
│                                             │
│  utils/cache.py  (TTL in-memory cache)      │
└─────────────────────────────────────────────┘
```

**Request flow for `POST /api/analyze/{id}`:**
1. `usgs_service` resolves the earthquake from the USGS feed (cached 60s)
2. `geology_service` computes nearest PB2002 plate boundary (haversine distance)
3. `gemini_service` runs Gemini Flash with structured JSON mode (cached 1h)
4. Response includes `confidence: "data-backed"` or `"inferred"` so the frontend can signal data quality

---

## Setup

### Prerequisites

- Python 3.11+
- A free [Google AI Studio](https://aistudio.google.com/) API key

### Local development

```bash
# 1. Clone and enter the backend directory
cd seismicsage/backend

# 2. Create and activate a virtual environment
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment
cp .env.example .env
# Edit .env — add your GOOGLE_API_KEY

# 5. Start the development server
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.
Interactive docs: `http://localhost:8000/docs`

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health — USGS, Gemini, and plate data status |
| `GET` | `/api/earthquakes` | List earthquake events from USGS feeds |
| `GET` | `/api/earthquakes/{id}` | Single earthquake event by USGS ID |
| `GET` | `/api/earthquakes/stats/summary` | Aggregate stats (count, largest, M4+, M6+, avg depth) |
| `POST` | `/api/analyze/{earthquake_id}` | Generate AI geological analysis |

### Query Parameters — `GET /api/earthquakes`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `feed` | string | `significant_week` | USGS feed: `significant_week`, `4.5_day`, `2.5_day`, `all_day`, `significant_month` |
| `min_magnitude` | float | `0.0` | Minimum magnitude filter |
| `limit` | int | `50` | Max results (1–500) |
| `sort_by` | string | `time` | Sort field: `time`, `magnitude`, `depth` |

### Example responses

**`GET /api/earthquakes?feed=significant_week&min_magnitude=5.0`**
```json
{
  "earthquakes": [
    {
      "id": "us7000n6c4",
      "magnitude": 6.2,
      "place": "Southern Alaska",
      "latitude": 59.82,
      "longitude": -152.71,
      "depth_km": 86.0,
      "time": "2024-01-15T03:22:14Z",
      "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000n6c4",
      "tsunami_warning": false,
      "felt_reports": 142,
      "significance": 610
    }
  ],
  "total_count": 12,
  "returned_count": 12,
  "feed": "significant_week",
  "stale": false,
  "fetched_at": "2024-01-15T03:30:00Z"
}
```

**`POST /api/analyze/us7000n6c4`**
```json
{
  "earthquake_id": "us7000n6c4",
  "summary": "A magnitude 6.2 intermediate-depth earthquake struck Southern Alaska at 86 km depth, reducing surface shaking intensity compared to shallower events. At this depth, energy is absorbed over a larger area, though the region's dense network of active faults means felt shaking was still widespread across the Cook Inlet area.",
  "geological_context": {
    "tectonic_setting": "An intermediate-depth earthquake adjacent to a convergent plate boundary (subduction zone).",
    "fault_type": "deep intraslab",
    "plate_boundary": "PA-NA",
    "boundary_type": "convergent",
    "distance_to_boundary_km": 48.3,
    "historical_context": "Boundary PA-NA: Subduction zones are among the most seismically active regions on Earth and are capable of generating megathrust earthquakes above M9.",
    "confidence": "data-backed"
  },
  "risk_assessment": "Moderate risk to infrastructure in Anchorage and surrounding communities. Depth of 86 km attenuates ground motion significantly; however, Alaska's high seismic exposure and aging building stock warrant preparedness.",
  "tags": ["subduction-zone", "alaska", "intermediate-depth", "pacific-ring-of-fire"],
  "generated_at": "2024-01-15T03:30:05Z",
  "cached": false
}
```

---

## Data Sources

### USGS Earthquake Hazards Program
Real-time earthquake data from the [USGS GeoJSON Feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php).
Updated every 1–5 minutes. No API key required. Data is public domain.

### Peter Bird's PB2002 Tectonic Plate Boundary Model
Geological context is grounded in the **PB2002 plate boundary dataset**, a peer-reviewed academic dataset:

> Bird, P. (2003). An updated digital model of plate boundaries. *Geochemistry, Geophysics, Geosystems*, 4(3).
> [https://doi.org/10.1029/2001GC000252](https://doi.org/10.1029/2001GC000252)

The dataset defines 52 tectonic plates and their boundaries, classifying each segment as convergent (subduction/collision), divergent (spreading ridge/rift), or transform. SeismicSage downloads this dataset on startup via the [fraxen/tectonicplates](https://github.com/fraxen/tectonicplates) GitHub mirror and caches it locally.

This enables the claim: *"geological analysis grounded in Peter Bird's published PB2002 tectonic plate model"* — a meaningfully stronger statement than AI hallucination.

### Google Gemini Flash
AI analysis powered by [Gemini 1.5 Flash](https://ai.google.dev/gemini-api/docs/models/gemini#gemini-1.5-flash) (free tier).

---

## Deployment — Render

1. Push code to GitHub
2. Create a new **Web Service** on [Render](https://render.com), pointing to this repo
3. Set root directory to `backend`
4. Add environment variables in the Render dashboard:
   - `GOOGLE_API_KEY` — your Gemini API key
   - `FRONTEND_URL` — your Vercel frontend URL
5. Render will use `render.yaml` for the rest of the configuration

### Free-tier cold start note

Render's free tier spins down services after 15 minutes of inactivity. The first request after a cold start will take **20–50 seconds** — this includes:
- Container startup (~5s)
- Downloading PB2002 plate boundary data from GitHub (~3s for ~500KB)
- FastAPI initialisation (~1s)

Subsequent requests will be fast. Consider using [UptimeRobot](https://uptimerobot.com) to ping `/health` every 14 minutes to keep the service warm.

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| `httpx.AsyncClient` instead of `requests` | `requests` is synchronous; using it inside async handlers blocks the event loop |
| `tenacity` for retry logic | Declarative, testable, handles both sync and async — cleaner than manual loops |
| TTL in-memory cache (no Redis) | Redis adds infrastructure cost and complexity unnecessary at this scale; TTLCache is thread-safe and eviction-lazy |
| Stale-cache fallback | USGS occasionally has brief outages; serving stale data with a `stale: true` flag is better UX than a 503 |
| PB2002 haversine lookup | Pure Python, no C extension dependencies — avoids Shapely build failures on Render's free tier |
| `temperature: 0.3` for Gemini | Geological analysis should be consistent and factual, not creative |
| JSON mode for Gemini | Eliminates fragile regex parsing of free-text responses |
| `confidence: "data-backed" / "inferred"` | Transparent data provenance — consumers know whether tectonic context came from real geometry or AI estimation |
