import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../../lib/api"
import { useSession } from "../../state/session"
import type { DemoAccounts } from "../../types"
import { DemoBadge } from "../ui/kit"

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")

function Row({ active, onClick, name, sub, round, demo }: { active: boolean; onClick: () => void; name: string; sub: string; round: boolean; demo?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm transition-colors ${active ? "bg-teal-100/60" : "hover:bg-ink-50"}`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center text-[10px] font-bold ${round ? "rounded-full" : "rounded-lg"} ${active ? "bg-gradient-to-br from-teal-400 to-teal-600 text-white" : "bg-ink-100 text-ink-600"}`}
      >
        {initials(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink-900">{name}</span>
        <span className="block truncate text-[11px] text-ink-500">{sub}</span>
      </span>
      {demo && <DemoBadge className="shrink-0" />}
      {active && <span className="text-teal-600" aria-label="Current account">✓</span>}
    </button>
  )
}

/** The signed-in account, and — in demo mode — a way to switch to another one to see WASL from the other side. */
export function AccountMenu() {
  const { actor, demoMode, signInAs, signOut } = useSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [accounts, setAccounts] = useState<DemoAccounts | null>(null)
  const [query, setQuery] = useState("")

  useEffect(() => {
    if (!open || !demoMode) return
    let cancelled = false
    api.get<DemoAccounts>("/demo-accounts").then((a) => !cancelled && setAccounts(a)).catch(() => undefined)
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", onKey)
    return () => {
      cancelled = true
      window.removeEventListener("keydown", onKey)
    }
  }, [open, demoMode])

  if (!actor) return null
  const close = () => {
    setOpen(false)
    setQuery("")
  }
  const choose = async (role: "student" | "company", id: string) => {
    await signInAs(role, id)
    close()
    navigate(role === "student" ? "/student" : "/company")
  }
  const q = query.trim().toLowerCase()
  const match = (...fields: string[]) => !q || fields.some((f) => f.toLowerCase().includes(q))

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="menu"
        className="group flex max-w-[44vw] items-center gap-2 rounded-full border border-ink-200 bg-surface py-1 pr-3 pl-1 text-sm font-medium text-ink-700 transition-all duration-200 hover:border-teal-400 sm:max-w-[60vw]"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-600 text-[10px] font-bold text-white">{initials(actor.name)}</span>
        <span className="truncate">{actor.name}</span>
        <span className={`text-ink-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden="true">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} aria-hidden="true" />
          <div role="menu" className="animate-pop-in absolute right-0 z-50 mt-2 flex max-h-[75vh] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-ink-200 bg-surface shadow-2xl shadow-ink-950/15">
            {demoMode && (
              <>
                <div className="border-b border-ink-100 p-3">
                  <p className="mb-2 px-1 text-xs text-ink-500">Demo sign-in: switch accounts to see Qudra from each side. This is not real authentication.</p>
                  <label htmlFor="account-search" className="sr-only">Search accounts</label>
                  <input
                    id="account-search"
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search students and companies…"
                    className="w-full rounded-xl border border-ink-200 bg-ink-50 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20"
                  />
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {!accounts && <p className="py-6 text-center text-sm text-ink-400">Loading accounts…</p>}
                  {accounts && (
                    <>
                      <div className="px-2 pt-2 pb-1 text-[10px] font-bold tracking-wider text-ink-500 uppercase">Students and graduates</div>
                      {accounts.students.filter((s) => match(s.name, s.headline)).map((s) => (
                        <Row key={s.id} active={actor.role === "student" && actor.id === s.id} onClick={() => void choose("student", s.id)} name={s.name} sub={s.headline || s.status} round demo={s.isDemoFixture} />
                      ))}
                      <div className="px-2 pt-3 pb-1 text-[10px] font-bold tracking-wider text-ink-500 uppercase">Companies</div>
                      {accounts.companies.filter((c) => match(c.name, c.industry)).map((c) => (
                        <Row key={c.id} active={actor.role === "company" && actor.id === c.id} onClick={() => void choose("company", c.id)} name={c.name} sub={c.industry} round={false} />
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-1 border-t border-ink-100 p-2">
              {demoMode ? (
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm("Reset all data back to the starting demonstration data? Everything created by any account will be lost.")) return
                    try {
                      await api.post("/reset")
                    } catch {
                      return
                    }
                    signOut()
                    close()
                    navigate("/")
                  }}
                  className="rounded-xl px-2 py-2 text-xs font-medium text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-800"
                >
                  ↺ Reset all data
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => {
                  signOut()
                  close()
                  navigate("/")
                }}
                className="rounded-xl px-2 py-2 text-xs font-medium text-ink-500 transition-colors hover:bg-danger-100 hover:text-danger-600"
              >
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
