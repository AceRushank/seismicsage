// Typed API client — all calls go through Vite's dev proxy to http://localhost:8000
import type { AnalysisResponse, EarthquakeListResponse, FaultAnalysisRequest, FaultAnalysisResponse, FeedId, StatsResponse } from './types'

const BASE = '' // Vite proxy handles routing to backend

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options)
  if (!res.ok) {
    const errorText = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(errorText)
  }
  return res.json() as Promise<T>
}

export function getEarthquakes(
  feed: FeedId = 'significant_week',
  minMagnitude = 0,
  limit = 500,
): Promise<EarthquakeListResponse> {
  const params = new URLSearchParams({
    feed,
    min_magnitude: minMagnitude.toString(),
    limit: limit.toString(),
  })
  return request<EarthquakeListResponse>(`/api/earthquakes?${params}`)
}

export function getStats(feed: FeedId = 'significant_week'): Promise<StatsResponse> {
  return request<StatsResponse>(`/api/stats?feed=${feed}`)
}

export function analyzeEarthquake(
  id: string,
  feed: FeedId = 'significant_week',
): Promise<AnalysisResponse> {
  return request<AnalysisResponse>(`/api/analyze/${id}?feed=${feed}`, { method: 'POST' })
}

export function analyzeFault(body: FaultAnalysisRequest): Promise<FaultAnalysisResponse> {
  return request<FaultAnalysisResponse>('/api/analyze/fault', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

