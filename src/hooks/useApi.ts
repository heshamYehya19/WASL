import { useCallback, useEffect, useRef, useState } from "react"
import { api, ApiRequestError } from "../lib/api"

export interface ApiState<T> {
  data: T | null
  error: ApiRequestError | null
  /** True only until the first answer for this path; a reload keeps showing the previous data. */
  loading: boolean
  reload: () => Promise<void>
}

interface Loaded<T> {
  path: string | null
  data: T | null
  error: ApiRequestError | null
}

/**
 * Loads `path` (pass `null` to wait). `poll` says how often to refresh given what has been loaded — return undefined to stop —
 * so a page can refresh by itself only while something is in progress.
 */
export function useApi<T>(path: string | null, options: { poll?: (data: T | null) => number | undefined } = {}): ApiState<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ path: null, data: null, error: null })
  const current = useRef(path)
  useEffect(() => {
    current.current = path
  })

  const load = useCallback(async () => {
    if (path === null) return
    try {
      const data = await api.get<T>(path)
      if (current.current === path) setLoaded({ path, data, error: null })
    } catch (err) {
      if (current.current !== path) return
      const error = err instanceof ApiRequestError ? err : new ApiRequestError("Something went wrong.")
      setLoaded((prev) => ({ path, data: prev.path === path ? prev.data : null, error }))
    }
  }, [path])

  useEffect(() => {
    void load()
  }, [load])

  // Results that belong to an earlier path are not shown for this one.
  const fresh = loaded.path === path
  const data = fresh ? loaded.data : null
  const error = fresh ? loaded.error : null
  const delay = options.poll?.(data)

  useEffect(() => {
    if (!delay || path === null) return
    const timer = setInterval(() => void load(), delay)
    return () => clearInterval(timer)
  }, [delay, path, load])

  return { data, error, loading: path !== null && !data && !error, reload: load }
}
