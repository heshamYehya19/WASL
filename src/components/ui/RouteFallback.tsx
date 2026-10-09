/** Suspense fallback for lazy-loaded routes — same quiet treatment as StoreProvider's own loading state. */
export function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <p className="text-sm text-ink-400">Loading…</p>
    </div>
  )
}
