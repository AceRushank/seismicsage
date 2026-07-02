# SeismicSage

> Real-time earthquake intelligence — USGS data feeds + Gemini AI geological analysis, grounded in Peter Bird's PB2002 tectonic plate boundary model.

## Repository Structure

```
seismicsage/
└── backend/          # FastAPI backend (this is what you deploy to Render)
    ├── main.py
    ├── config.py
    ├── models/
    ├── services/
    ├── routers/
    ├── utils/
    ├── requirements.txt
    ├── render.yaml
    └── README.md     ← full API docs & setup instructions here
```

## Quick Start

See [`backend/README.md`](./backend/README.md) for full setup, API documentation, and deployment instructions.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API | FastAPI + Uvicorn |
| Earthquake data | USGS GeoJSON Feeds |
| Geological context | Peter Bird's PB2002 plate boundary model |
| AI analysis | Google Gemini 1.5 Flash |
| Deployment | Render (backend) |

## Data Sources

- **USGS Earthquake Hazards Program** — public domain real-time feeds
- **Peter Bird, PB2002** — Bird, P. (2003). *Geochemistry, Geophysics, Geosystems*, 4(3). [DOI: 10.1029/2001GC000252](https://doi.org/10.1029/2001GC000252)
- **Google Gemini Flash** — AI-powered analysis layer
