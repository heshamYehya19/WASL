import { Link } from "react-router-dom"

export function Wordmark({ to = "/", dark = false }: { to?: string; dark?: boolean }) {
  return (
    <Link to={to} className="group flex items-center gap-2 shrink-0" aria-label="WASL — home">
      <svg
        width="28"
        height="28"
        viewBox="0 0 32 32"
        aria-hidden="true"
        className="shrink-0 transition-transform duration-300 ease-out group-hover:rotate-[8deg] group-hover:scale-110"
      >
        <rect width="32" height="32" rx="8" fill="#0B1D26" />
        <path d="M9 10 L23 22" stroke="#5EEAD4" strokeWidth="2.2" strokeLinecap="round" className="wordmark-connector" />
        <circle cx="9" cy="10" r="3.2" fill="#2DD4BF" className="wordmark-node" />
        <circle cx="23" cy="22" r="3.2" fill="#2DD4BF" className="wordmark-node wordmark-node-delay" />
        <circle cx="23" cy="10" r="2" fill="#F2C879" className="wordmark-spark" />
      </svg>
      <span
        className={`text-lg font-extrabold tracking-tight transition-all duration-300 ease-out group-hover:tracking-wider ${dark ? "text-white" : "text-ink-950"}`}
      >
        WASL
      </span>
      <span lang="ar" className={`wordmark-ink font-arabic text-lg font-bold ${dark ? "text-teal-300" : "text-teal-600"}`}>
        وصل
      </span>
    </Link>
  )
}
