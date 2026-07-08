import { useState, useEffect, useRef, useCallback } from 'react'
import type { Earthquake, FeedId, StatsResponse } from '../lib/types'
import { getEarthquakes, getStats } from '../lib/api'

const POLL_INTERVAL_MS = 60_000 // matches backend USGS_CACHE_TTL exactly

interface UseEarthquakesResult {
  earthquakes: Earthquake[]
  stats: StatsResponse | null
  loading: boolean
  error: string | null
  stale: boolean
  refetch: () => void
}

export function useEarthquakes(feed: FeedId): UseEarthquakesResult {
  const [earthquakes, setEarthquakes] = useState<Earthquake[]>([])
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  const fetchData = useCallback(async () => {
    try {
      const [listRes, statsRes] = await Promise.all([
        getEarthquakes(feed, 0, 500),
        getStats(feed),
      ])
      if (!mountedRef.current) return
      setEarthquakes(listRes.earthquakes)
      setStale(listRes.stale)
      setStats(statsRes)
      setError(null)
    } catch (e) {
      if (!mountedRef.current) return
      setError(e instanceof Error ? e.message : 'Failed to load earthquake data')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [feed])

  useEffect(() => {
    mountedRef.current = true
    setLoading(true)
    void fetchData()

    intervalRef.current = setInterval(() => {
      void fetchData()
    }, POLL_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchData])

  return { earthquakes, stats, loading, error, stale, refetch: fetchData }
}
