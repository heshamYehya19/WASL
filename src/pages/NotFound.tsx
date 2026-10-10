import { Link } from "react-router-dom"

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink-50 px-4 text-center">
      <div className="text-6xl font-extrabold text-ink-200">404</div>
      <h1 className="mt-2 text-2xl font-bold text-ink-950">That page isn't here</h1>
      <p className="mt-1 max-w-sm text-ink-600">The link may be old, or the thing it pointed to may have been removed.</p>
      <Link to="/" className="mt-6 rounded-full bg-night px-6 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-teal-600">
        Back to Qudra
      </Link>
    </div>
  )
}
