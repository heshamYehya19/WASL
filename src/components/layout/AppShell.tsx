import { Suspense, useEffect, useState } from "react"
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom"
import type { ReactNode } from "react"
import { Wordmark } from "../ui/Wordmark"
import { AccountMenu } from "./AccountMenu"
import { ThemeToggle } from "../ui/ThemeToggle"
import { RouteFallback } from "../ui/RouteFallback"
import { AmbientConstellation } from "../ui/AmbientConstellation"
import { useSession } from "../../state/session"
import { useApi } from "../../hooks/useApi"
import { api } from "../../lib/api"
import { formatRelative } from "../../lib/format"
import type { AppNotification, Role } from "../../types"

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  end?: boolean
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const HOME = "M3 12l9-9 9 9M5 10v10h14V10"
const BOLT = "M13 2L4 14h7l-1 8 9-12h-7l1-8z"
const BRIEFCASE = "M3 8h18v12H3zM8 8V5h8v3"
const FLASK = "M9 3h6M10 3v6L4 20h16l-6-11V3"
const LOOP = "M4 12a8 8 0 0113.7-5.7L20 8M20 4v4h-4M20 12a8 8 0 01-13.7 5.7L4 16M4 20v-4h4"
const USER = "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c1.5-4 5-6 8-6s6.5 2 8 6"
const SEARCH = "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3"
const STAR = "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"
const PLUS = "M12 5v14M5 12h14"

const NAV: Record<Role, NavItem[]> = {
  student: [
    { to: "/student", label: "Dashboard", icon: <Icon d={HOME} />, end: true },
    { to: "/student/challenges", label: "Company challenges", icon: <Icon d={BRIEFCASE} /> },
    { to: "/student/practice", label: "Practice Lab", icon: <Icon d={FLASK} /> },
    { to: "/student/work", label: "My work", icon: <Icon d={BOLT} /> },
    { to: "/student/learning", label: "Improve", icon: <Icon d={LOOP} /> },
    { to: "/student/profile", label: "Profile", icon: <Icon d={USER} /> },
  ],
  company: [
    { to: "/company", label: "Dashboard", icon: <Icon d={HOME} />, end: true },
    { to: "/company/challenges", label: "Challenges", icon: <Icon d={BRIEFCASE} />, end: true },
    { to: "/company/challenges/new", label: "New challenge", icon: <Icon d={PLUS} /> },
    { to: "/company/talent", label: "Talent Discovery", icon: <Icon d={SEARCH} /> },
    { to: "/company/shortlist", label: "Shortlist", icon: <Icon d={STAR} /> },
  ],
}

const ROLE_LABEL: Record<Role, string> = { student: "Student / graduate", company: "Company" }

function NavList({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  return (
    <>
      {NAV[role].map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
              isActive ? "bg-night text-white shadow-md shadow-ink-950/10" : "text-ink-600 hover:translate-x-0.5 hover:bg-ink-50 hover:text-ink-900"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span className={isActive ? "text-teal-300" : ""}>{item.icon}</span>
              {item.label}
            </>
          )}
        </NavLink>
      ))}
    </>
  )
}

function Notifications({ role }: { role: Role }) {
  const path = role === "student" ? "/notifications" : "/company/notifications"
  const { data, reload } = useApi<{ notifications: AppNotification[] }>(path, { poll: () => 30_000 })
  const [open, setOpen] = useState(false)
  const notifications = data?.notifications ?? []
  const unread = notifications.filter((n) => !n.read).length
  const { pathname } = useLocation()

  // New page, new chance something arrived (a phase assessed, an expression of interest).
  useEffect(() => {
    void reload()
  }, [pathname, reload])

  const close = async () => {
    setOpen(false)
    if (unread > 0) {
      await api.post(`${path}/read`).catch(() => undefined)
      await reload()
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? void close() : setOpen(true))}
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        className="relative rounded-full border border-ink-200 p-2 text-ink-500 transition-colors hover:border-teal-400 hover:text-teal-600"
      >
        <span className={`block ${unread > 0 ? "animate-bell" : ""}`}>
          <Icon d="M15 17h5l-1.4-2.1a2 2 0 01-.3-1V11a6 6 0 10-12 0v2.9c0 .36-.1.7-.3 1L4 17h5m6 0a3 3 0 11-6 0m6 0H9" />
        </span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-500 px-1 text-[9px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => void close()} aria-hidden="true" />
          <div className="animate-pop-in absolute right-0 z-50 mt-2 max-h-96 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-ink-200 bg-surface p-2 shadow-2xl shadow-ink-950/10">
            <div className="flex items-center justify-between px-3 pt-1 pb-2">
              <span className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Notifications</span>
              {unread > 0 && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-700">{unread} new</span>}
            </div>
            {notifications.length === 0 && <p className="px-3 py-4 text-center text-sm text-ink-500">Nothing yet.</p>}
            {notifications.map((n) => {
              const body = (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-ink-800">{n.title}</span>
                    {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-500" aria-label="Unread" />}
                  </div>
                  <div className="text-xs text-ink-500">{n.body}</div>
                  <div className="mt-0.5 text-[11px] text-ink-500">{formatRelative(n.createdAt)}</div>
                </>
              )
              return n.link ? (
                <Link key={n.id} to={n.link} onClick={() => void close()} className={`block rounded-xl px-3 py-2 text-sm transition-colors hover:bg-ink-50 ${!n.read ? "bg-teal-100/40" : ""}`}>
                  {body}
                </Link>
              ) : (
                <div key={n.id} className="rounded-lg px-3 py-2 text-sm">{body}</div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export function AppShell({ role }: { role: Role }) {
  const { actor, ready, aiMock } = useSession()
  const { pathname } = useLocation()
  // The menu is open "at" a path, so navigating anywhere closes it without an effect.
  const [menuAt, setMenuAt] = useState<string | null>(null)
  const menuOpen = menuAt === pathname

  if (!ready) return <RouteFallback />
  // Signed in as the other kind of account: go to that account's home, not the login screen.
  if (actor && actor.role !== role) return <Navigate to={`/${actor.role}`} replace />
  if (!actor) return <Navigate to="/login" replace />

  return (
    <div className="relative isolate flex min-h-screen bg-ink-50">
      <a href="#main" className="sr-only z-[100] rounded-lg bg-night px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <AmbientConstellation />
      <aside className="relative z-10 hidden w-64 shrink-0 flex-col border-r border-ink-100 bg-surface px-4 py-5 md:flex">
        <Wordmark />
        <div className="relative mt-6 overflow-hidden rounded-2xl bg-night px-3 py-3">
          <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
          <div className="relative flex items-center gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center bg-gradient-to-br from-teal-400 to-teal-600 text-xs font-bold text-white ${role === "student" ? "rounded-full" : "rounded-xl"}`}>
              {actor.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold tracking-wider text-teal-300 uppercase">{ROLE_LABEL[role]}</div>
              <div className="truncate text-sm font-semibold text-white">{actor.name}</div>
            </div>
          </div>
        </div>
        <nav aria-label="Main" className="mt-6 flex flex-1 flex-col gap-1">
          <NavList role={role} />
        </nav>
        <NavLink to="/" className="mt-4 rounded-lg px-3 py-2 text-xs font-medium text-ink-500 hover:text-ink-800">
          ← Back to the public site
        </NavLink>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-ink-100 bg-surface/90 backdrop-blur">
          <div className="flex h-16 items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-2 md:hidden">
              <button
                type="button"
                onClick={() => setMenuAt(menuOpen ? null : pathname)}
                aria-expanded={menuOpen}
                aria-controls="mobile-nav"
                aria-label="Menu"
                className="rounded-lg border border-ink-200 p-2"
              >
                <span className="block h-0.5 w-4 bg-ink-800" />
                <span className="mt-1 block h-0.5 w-4 bg-ink-800" />
                <span className="mt-1 block h-0.5 w-4 bg-ink-800" />
              </button>
              <Wordmark />
            </div>
            <div className="hidden text-sm text-ink-500 md:block">Where Ability Meets Opportunity.</div>
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <Notifications role={role} />
              <ThemeToggle />
              <AccountMenu />
            </div>
          </div>
          {menuOpen && (
            <nav id="mobile-nav" aria-label="Main" className="flex flex-col gap-1 border-t border-ink-100 px-4 py-3 md:hidden">
              <NavList role={role} onNavigate={() => setMenuAt(null)} />
            </nav>
          )}
        </header>
        {aiMock && (
          <div role="note" data-testid="ai-mock-banner" className="border-b border-dashed border-amber-400/60 bg-amber-100 px-4 py-2 text-center text-xs font-semibold text-ink-900 sm:px-6 lg:px-8">
            Demo mock AI — rehearsal mode. No AI provider is used: every review, interview question and assessment here is scripted demonstration data, not a genuine AI assessment.
          </div>
        )}
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
          <div key={pathname} className="animate-page-enter">
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  )
}
