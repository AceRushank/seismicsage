import { useState, useRef, useCallback } from 'react'
import type { AnalysisResponse, FeedId } from '../lib/types'
import { analyzeEarthquake } from '../lib/api'

interface UseAnalysisResult {
  analysis: AnalysisResponse | null
  loading: boolean
  error: string | null
  fetchAnalysis: (id: string, feed?: FeedId) => void
  clearAnalysis: () => void
}

export function useAnalysis(): UseAnalysisResult {
  // Client-side cache: re-selecting a quake doesn't re-fetch
  const cacheRef = useRef(new Map<string, AnalysisResponse>())
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentIdRef = useRef<string | null>(null)

  const fetchAnalysis = useCallback((id: string, feed: FeedId = 'significant_week') => {
    currentIdRef.current = id

    // Serve from client cache immediately if available
    const cached = cacheRef.current.get(id)
    if (cached) {
      setAnalysis(cached)
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    setAnalysis(null)

    analyzeEarthquake(id, feed)
      .then((result) => {
        // Only update if this is still the current request
        if (currentIdRef.current !== id) return
        cacheRef.current.set(id, result)
        setAnalysis(result)
      })
      .catch((e) => {
        if (currentIdRef.current !== id) return
        setError(e instanceof Error ? e.message : 'Analysis failed')
      })
      .finally(() => {
        if (currentIdRef.current === id) setLoading(false)
      })
  }, [])

  const clearAnalysis = useCallback(() => {
    currentIdRef.current = null
    setAnalysis(null)
    setError(null)
    setLoading(false)
  }, [])

  return { analysis, loading, error, fetchAnalysis, clearAnalysis }
}
