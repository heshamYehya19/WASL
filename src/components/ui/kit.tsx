import { Link } from "react-router-dom"
import type { ButtonHTMLAttributes, ReactNode } from "react"
import { ApiRequestError } from "../../lib/api"
import type { ApiState } from "../../hooks/useApi"

/* Small, accessible building blocks shared by every page: buttons, form fields, notices and loading / error states. */

type Variant = "primary" | "secondary" | "ghost" | "danger"

const VARIANTS: Record<Variant, string> = {
  primary: "bg-night text-white hover:bg-teal-600 hover:shadow-lg hover:shadow-teal-600/20 disabled:hover:bg-night disabled:hover:shadow-none",
  secondary: "border border-ink-200 bg-surface text-ink-800 hover:border-teal-400 hover:text-teal-700",
  ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
  danger: "border border-danger-600/30 bg-danger-100 text-danger-600 hover:border-danger-600",
}

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"

export function Button({
  variant = "primary",
  loading = false,
  className = "",
  children,
  disabled,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props}>
      {loading && <Spinner small />}
      {children}
    </button>
  )
}

export function LinkButton({ to, variant = "primary", className = "", children }: { to: string; variant?: Variant; className?: string; children: ReactNode }) {
  return (
    <Link to={to} className={`${BASE} hover:-translate-y-0.5 ${VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  )
}

export function Spinner({ small = false }: { small?: boolean }) {
  return (
    <svg className={`${small ? "h-4 w-4" : "h-6 w-6"} animate-spin text-current motion-reduce:animate-none`} viewBox="0 0 24 24" fill="none" role="status" aria-label="Loading">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export const inputClass =
  "w-full rounded-xl border border-ink-200 bg-surface px-3.5 py-2.5 text-sm text-ink-900 shadow-sm outline-none transition-all placeholder:text-ink-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-400/15 disabled:bg-ink-100 aria-[invalid=true]:border-danger-600"

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  optional = false,
}: {
  label: string
  hint?: ReactNode
  error?: string | null
  htmlFor: string
  children: ReactNode
  optional?: boolean
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-semibold text-ink-800">
        <span>{label}</span>
        {optional && <span className="text-xs font-normal text-ink-400">optional</span>}
      </label>
      {children}
      {hint && !error && <p id={`${htmlFor}-hint`} className="mt-1.5 text-xs text-ink-500">{hint}</p>}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1.5 text-xs font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  )
}

type Tone = "info" | "warn" | "danger" | "success" | "demo"

const TONES: Record<Tone, string> = {
  info: "border-teal-400/40 bg-teal-100/60 text-ink-800",
  warn: "border-amber-400/50 bg-amber-100 text-ink-900",
  danger: "border-danger-600/30 bg-danger-100 text-ink-900",
  success: "border-verified-500/40 bg-verified-100 text-ink-900",
  demo: "border-dashed border-ink-300 bg-ink-100 text-ink-700",
}

export function Notice({ tone = "info", title, children, className = "" }: { tone?: Tone; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "note"} className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${TONES[tone]} ${className}`}>
      {title && <div className="mb-0.5 font-semibold">{title}</div>}
      {children}
    </div>
  )
}

/** The label shown wherever demonstration data appears, so it can never be mistaken for real activity. */
export function DemoBadge({ className = "" }: { className?: string }) {
  return (
    <span title="Sample data included so the product can be explored. It was not produced by a real candidate or by the Proof Engine." className={`inline-flex items-center rounded-full border border-dashed border-ink-300 bg-ink-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-ink-600 uppercase ${className}`}>
      Demonstration data
    </span>
  )
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[30vh] items-center justify-center gap-3 text-sm text-ink-400" aria-live="polite">
      <Spinner />
      {label}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: ApiRequestError | string; onRetry?: () => void }) {
  const message = typeof error === "string" ? error : error.message
  return (
    <div className="rounded-2xl border border-danger-600/30 bg-danger-100 px-6 py-8 text-center" role="alert">
      <p className="font-semibold text-ink-900">We couldn't load this.</p>
      <p className="mt-1 text-sm text-ink-600">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

/** Renders loading, error or the loaded data — so every page handles all three the same way. */
export function Async<T>({ state, children }: { state: ApiState<T>; children: (data: T) => ReactNode }) {
  if (state.data) return <>{children(state.data)}</>
  if (state.error) return <ErrorState error={state.error} onRetry={() => void state.reload()} />
  return <Loading />
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-ink-200">
      {tabs.map((t) => {
        const active = t.value === value
        return (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${active ? "border-teal-500 text-ink-950" : "border-transparent text-ink-500 hover:text-ink-800"}`}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 rounded-full bg-ink-100 px-1.5 text-[11px] text-ink-500 tabular-nums">{t.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Comma-separated chips entered one at a time (skills). */
export function ChipInput({ id, value, onChange, placeholder, max = 10 }: { id: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string; max?: number }) {
  const add = (raw: string) => {
    const parts = raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
    if (parts.length === 0) return
    const next = [...value]
    for (const p of parts) if (next.length < max && !next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p)
    onChange(next)
  }
  return (
    <div className="flex flex-wrap gap-1.5 rounded-xl border border-ink-200 bg-surface p-2 focus-within:border-teal-400 focus-within:ring-4 focus-within:ring-teal-400/15">
      {value.map((s) => (
        <span key={s} className="inline-flex items-center gap-1 rounded-lg bg-ink-100 px-2 py-1 text-sm font-medium text-ink-800">
          {s}
          <button type="button" aria-label={`Remove ${s}`} onClick={() => onChange(value.filter((v) => v !== s))} className="text-ink-400 hover:text-danger-600">
            ✕
          </button>
        </span>
      ))}
      {value.length < max && (
        <input
          id={id}
          className="min-w-32 flex-1 bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-ink-400"
          placeholder={value.length === 0 ? placeholder : "Add another…"}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault()
              add(e.currentTarget.value)
              e.currentTarget.value = ""
            } else if (e.key === "Backspace" && e.currentTarget.value === "" && value.length > 0) onChange(value.slice(0, -1))
          }}
          onBlur={(e) => {
            add(e.currentTarget.value)
            e.currentTarget.value = ""
          }}
        />
      )}
    </div>
  )
}
