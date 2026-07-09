// TypeScript mirrors of backend Pydantic schemas (models/schemas.py)
// No `any` — all types are fully explicit

export interface Earthquake {
  id: string
  magnitude: number
  place: string
  latitude: number
  longitude: number
  depth_km: number
  time: string // ISO 8601 UTC
  url: string
  tsunami_warning: boolean
  felt_reports: number | null
  significance: number
}

export interface GeologicalContext {
  tectonic_setting: string
  fault_type: string | null
  plate_boundary: string | null
  boundary_type: string | null
  distance_to_boundary_km: number | null
  historical_context: string
  confidence: 'data-backed' | 'inferred'
}

export interface AnalysisResponse {
  earthquake_id: string
  summary: string
  geological_context: GeologicalContext
  risk_assessment: string
  tags: string[]
  generated_at: string | null
  cached: boolean
}

export interface EarthquakeListResponse {
  earthquakes: Earthquake[]
  total_count: number
  returned_count: number
  feed: string
  stale: boolean
  fetched_at: string | null
}

export interface StatsResponse {
  feed: string
  total_count: number
  largest_magnitude: number | null
  largest_event_id: string | null
  count_above_m4: number
  count_above_m6: number
  average_depth_km: number | null
  stale: boolean
}

export type FeedId =
  | 'significant_week'
  | '4.5_day'
  | '2.5_day'
  | 'all_day'
  | 'significant_month'

export type MagnitudeFilter = 'all' | 'm4plus' | 'm6plus'
export type TimeFilter = 'week' | 'day'

export interface FilterState {
  magnitude: MagnitudeFilter
  time: TimeFilter
  showFaultLines: boolean
}

// ─── Fault analysis types ─────────────────────────────────────────────────────

export interface FaultAnalysisRequest {
  boundary_type: string
  latitude: number
  longitude: number
  nearby_earthquake_ids: string[]
}

export interface FaultAnalysisResponse {
  insight: string
  boundary_type: string
  latitude: number
  longitude: number
  generated_at: string
}

