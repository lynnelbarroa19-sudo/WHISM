'use client'
import { useEffect } from 'react'
import { useSyncExternalStore } from 'react'

// ---- Shared fetch/cache for /api/warehouse-predict ----
//
// WHY THIS FILE EXISTS: PredictionCard.tsx and BarangayDistributionCard.tsx
// both need the same prediction payload, but each used to call
// fetch('/api/warehouse-predict') independently on mount. That endpoint
// proxies to the Python ML service, which recomputes the forecast AND the
// barangay split from scratch on every call -- so loading the dashboard
// was silently doing that expensive work TWICE, back to back, before either
// card could render. This module makes both cards share a single in-flight
// request and a single cached result, so the dashboard only pays for that
// computation once per load (and once per manual Refresh click, no matter
// which card's Refresh button was clicked).
//
// If the dashboard is still slow after this, the bottleneck is inside
// api_server.py / predict_and_distribution.py itself (model inference,
// Supabase round-trips, the 96-barangay split math) rather than duplicate
// requests -- that's the next place to look (e.g. caching the computed
// result server-side for a minute or two, since a demand forecast doesn't
// need to be recomputed on every single page load).

interface WarehousePredictionState {
  data: any | null
  error: string
  loading: boolean
  refreshing: boolean
  lastComputed: Date | null
}

let state: WarehousePredictionState = {
  data: null,
  error: '',
  loading: true,
  refreshing: false,
  lastComputed: null,
}

let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

function setState(patch: Partial<WarehousePredictionState>) {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}

function extractErrorMessage(json: any): string {
  let reason = ''
  if (typeof json?.detail === 'string') {
    try {
      reason = JSON.parse(json.detail)?.detail || json.detail
    } catch {
      reason = json.detail
    }
  }
  return [json?.error, reason].filter(Boolean).join(' — ') || 'Could not load the prediction.'
}

async function doFetch(): Promise<void> {
  if (state.lastComputed) setState({ refreshing: true })
  else setState({ loading: true })
  setState({ error: '' })

  try {
    const res = await fetch('/api/warehouse-predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const json = await res.json()

    if (!res.ok) {
      setState({ error: extractErrorMessage(json), data: null, loading: false, refreshing: false })
      return
    }

    setState({ data: json, lastComputed: new Date(), loading: false, refreshing: false, error: '' })
  } catch (err) {
    console.error('warehouse prediction fetch error:', err)
    setState({ error: 'Could not reach the prediction service.', data: null, loading: false, refreshing: false })
  }
}

/** Called by both cards on mount. Only actually fetches once -- if a
 * request is already in flight, or we already have data/an error from a
 * previous mount, this is a no-op. */
function ensureLoaded() {
  if (inFlight) return inFlight
  if (state.data || state.error) return null
  inFlight = doFetch().finally(() => {
    inFlight = null
  })
  return inFlight
}

/** Called by either card's Refresh button. If a refresh is already in
 * flight (e.g. the user double-clicked, or clicked both cards' Refresh
 * buttons back to back), both callers share the same request. */
function refresh() {
  if (inFlight) return inFlight
  inFlight = doFetch().finally(() => {
    inFlight = null
  })
  return inFlight
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state
}

// >>> Fires the moment this module is first evaluated in the browser --
// i.e. as soon as the page's JS loads, NOT when a card component finally
// mounts/paints. `ensureLoaded()` is safe to call multiple times (it's a
// no-op once a request is in flight or data/error is already set), so
// this doesn't create a duplicate request even though the hook below also
// calls it. This is what makes the dashboard start fetching "kasabay ng
// pagbukas ng site" instead of only once the cards themselves render.
if (typeof window !== 'undefined') {
  ensureLoaded()
}

/** Optional: call this explicitly at the very top of your dashboard page
 * (e.g. in a page-level useEffect, or even during render) if your cards
 * are lazy-loaded / dynamically imported and might not mount right away.
 * It's the same as the automatic module-load trigger above, exported here
 * in case you want to kick things off from somewhere even earlier, like
 * the dashboard page itself rather than relying on a card importing this
 * file. Safe to call as many times as you want. */
export function prefetchWarehousePrediction() {
  ensureLoaded()
}

export function useWarehousePrediction() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    ensureLoaded()
  }, [])

  return {
    data: snapshot.data,
    error: snapshot.error,
    loading: snapshot.loading,
    refreshing: snapshot.refreshing,
    lastComputed: snapshot.lastComputed,
    refresh,
  }
}