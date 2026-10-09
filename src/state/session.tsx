import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { api, setActor } from "../lib/api"
import type { ActorInfo, Role, SessionInfo } from "../types"

// Which account the visitor is acting as. Only the account's id lives in the browser; everything else (its name, its work) is
// read from the server. This is DEMO sign-in: choosing an account is all it takes. It is not authentication.
const STORAGE_KEY = "wasl-demo-user-v1"

interface Stored {
  role: Role
  id: string
}

function load(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Stored) : null
    return parsed && (parsed.role === "student" || parsed.role === "company") && typeof parsed.id === "string" ? parsed : null
  } catch {
    return null
  }
}

interface SessionContextValue {
  /** The signed-in account once the server has confirmed it, otherwise null. */
  actor: ActorInfo | null
  /** False until the first check with the server has finished. */
  ready: boolean
  demoMode: boolean
  signInAs: (role: Role, id: string) => Promise<void>
  signOut: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Stored | null>(() => {
    const s = load()
    setActor(s?.role ?? null, s?.id ?? null) // before the first request, so it carries the header
    return s
  })
  const [actor, setActorInfo] = useState<ActorInfo | null>(null)
  const [ready, setReady] = useState(false)
  const [demoMode, setDemoMode] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const info = await api.get<SessionInfo>("/session")
      setActorInfo(info.actor)
      setDemoMode(info.demoMode)
      // An account that no longer exists (for example after a reset) is signed out.
      if (!info.actor) {
        setStored(null)
        setActor(null, null)
      }
    } catch {
      setActorInfo(null)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    try {
      if (stored) localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Storage unavailable — the session just won't survive a reload.
    }
  }, [stored])

  const value = useMemo<SessionContextValue>(
    () => ({
      actor,
      ready,
      demoMode,
      signInAs: async (role, id) => {
        setActor(role, id)
        setStored({ role, id })
        await refresh()
      },
      signOut: () => {
        setActor(null, null)
        setStored(null)
        setActorInfo(null)
      },
    }),
    [actor, ready, demoMode, refresh],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error("useSession must be used within SessionProvider")
  return ctx
}
