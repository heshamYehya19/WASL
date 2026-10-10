import { Link } from "react-router-dom"

export function Wordmark({ to = "/", dark = false }: { to?: string; dark?: boolean }) {
  return (
    <Link to={to} className="group flex items-center gap-2 shrink-0" aria-label="Qudra — home">
      {/* The Qudra mark: a "Q" on an indigo tile, a teal spark of potential, and (on hover) a violet line rising inside it. */}
      <svg
        width="28"
        height="28"
        viewBox="0 0 32 32"
        aria-hidden="true"
        className="shrink-0 transition-transform duration-300 ease-out group-hover:rotate-[8deg] group-hover:scale-110"
      >
        <rect width="32" height="32" rx="8" fill="#4338CA" />
        <circle cx="15" cy="15" r="7.5" fill="none" stroke="#EEF2FF" strokeWidth="2.6" className="wordmark-node" />
        <path d="M19.8 19.8 L24.5 24.5" stroke="#EEF2FF" strokeWidth="2.6" strokeLinecap="round" className="wordmark-node wordmark-node-delay" />
        <path d="M11.5 17.5 L14 15 L15.8 16.6 L18.5 12.5" fill="none" stroke="#C4B5FD" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="wordmark-connector" />
        <circle cx="25" cy="7" r="2" fill="#2DD4BF" className="wordmark-spark" />
      </svg>
      <span
        className={`text-lg font-extrabold tracking-tight transition-all duration-300 ease-out group-hover:tracking-wider ${dark ? "text-white" : "text-ink-950"}`}
      >
        Qudra
      </span>
      <span lang="ar" className={`wordmark-ink font-arabic text-lg font-bold ${dark ? "text-teal-300" : "text-teal-600"}`}>
        قدرة
      </span>
    </Link>
  )
}
