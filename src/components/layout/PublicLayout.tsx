import { useState } from "react"
import { Link, NavLink, Outlet } from "react-router-dom"
import { Wordmark } from "../ui/Wordmark"
import { ThemeToggle } from "../ui/ThemeToggle"
import { AmbientConstellation } from "../ui/AmbientConstellation"
import { AccountMenu } from "./AccountMenu"
import { useSession } from "../../state/session"

const LINKS = [
  { to: "/about", label: "About" },
  { to: "/how-it-works", label: "How it works" },
  { to: "/for-students", label: "For students & graduates" },
  { to: "/for-companies", label: "For companies" },
]

function PublicNav() {
  const [open, setOpen] = useState(false)
  const { actor } = useSession()
  return (
    <header className="sticky top-0 z-50 border-b border-ink-100 bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Wordmark />
        <nav aria-label="Main" className="hidden items-center gap-6 lg:flex">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `relative pb-0.5 text-sm font-medium transition-colors after:absolute after:-bottom-0.5 after:left-0 after:h-px after:w-full after:origin-left after:bg-teal-500 after:transition-transform after:duration-300 after:content-[''] ${
                  isActive ? "text-teal-700 after:scale-x-100" : "text-ink-600 after:scale-x-0 hover:text-ink-950 hover:after:scale-x-100"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <ThemeToggle />
          {actor ? (
            <>
              <Link to={`/${actor.role}`} className="hidden rounded-full border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-700 hover:border-teal-400 sm:block">
                Open my area
              </Link>
              <AccountMenu />
            </>
          ) : (
            <NavLink to="/login" className="rounded-full bg-night px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-teal-600 hover:shadow-lg hover:shadow-teal-600/20">
              Sign in
            </NavLink>
          )}
          <button
            type="button"
            className="rounded-lg border border-ink-200 p-2 lg:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-label="Toggle menu"
            aria-expanded={open}
            aria-controls="public-menu"
          >
            <span className="block h-0.5 w-4 bg-ink-800" />
            <span className="mt-1 block h-0.5 w-4 bg-ink-800" />
            <span className="mt-1 block h-0.5 w-4 bg-ink-800" />
          </button>
        </div>
      </div>
      {open && (
        <nav id="public-menu" aria-label="Main" className="flex flex-col gap-1 border-t border-ink-100 px-4 py-3 lg:hidden">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} onClick={() => setOpen(false)} className={({ isActive }) => `rounded-lg px-2 py-2 text-sm font-medium hover:bg-ink-50 ${isActive ? "text-teal-700" : "text-ink-700"}`}>
              {l.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  )
}

function Footer() {
  return (
    <footer className="border-t border-ink-100 bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <Wordmark />
            <p className="mt-3 text-sm leading-relaxed text-ink-600">
              Qudra connects students and graduates directly with companies. Real challenges, an AI that inspects the work and interviews the person behind it, and employers who see evidence — not claims.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">Platform</div>
              <ul className="space-y-1.5 text-sm text-ink-600">
                <li><Link to="/how-it-works" className="hover:text-teal-700">How it works</Link></li>
                <li><Link to="/about" className="hover:text-teal-700">About Qudra</Link></li>
                <li><Link to="/login" className="hover:text-teal-700">Sign in</Link></li>
              </ul>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">Who it's for</div>
              <ul className="space-y-1.5 text-sm text-ink-600">
                <li><Link to="/for-students" className="hover:text-teal-700">Students &amp; graduates</Link></li>
                <li><Link to="/for-companies" className="hover:text-teal-700">Companies</Link></li>
              </ul>
            </div>
          </div>
        </div>
        <p className="mt-8 border-t border-ink-100 pt-6 text-xs leading-relaxed text-ink-500">
          Where Ability Meets Opportunity. Sample companies and candidates in the demo are fictional and are labelled “Demonstration data”. Sign-in here is a demo
          account switcher, not real authentication.
        </p>
      </div>
    </footer>
  )
}

export function PublicLayout() {
  return (
    <div className="relative isolate flex min-h-screen flex-col bg-ink-50">
      <a href="#main" className="sr-only z-[100] rounded-lg bg-night px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <AmbientConstellation />
      <PublicNav />
      <main id="main" tabIndex={-1} className="relative z-10 flex-1 outline-none">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
