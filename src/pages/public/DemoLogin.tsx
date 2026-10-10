import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Async, Button, DemoBadge, Field, inputClass, Notice } from "../../components/ui/kit"
import { PageHeader } from "../../components/ui/PageHeader"
import { useApi } from "../../hooks/useApi"
import { api, ApiRequestError } from "../../lib/api"
import { useSession } from "../../state/session"
import type { DemoAccounts, Health, Role } from "../../types"

function AiStatus() {
  const { data } = useApi<Health>("/health")
  if (!data) return null
  const ai = data.ai
  if (!ai.configured) {
    return (
      <Notice tone="warn" title="No AI provider is configured on this server">
        You can still explore. Challenge generation falls back to a clearly labelled template, and the review, interview and assessment steps will report “assessment unavailable”
        instead of guessing. Add a key to <code>.env</code> to enable them.
      </Notice>
    )
  }
  return ai.keyWorks ? (
    <Notice tone="success">AI is available ({ai.provider}{ai.backup ? `, with ${ai.backup} as backup` : ""}). Review, interview and assessment are live.</Notice>
  ) : (
    <Notice tone="warn" title={`The ${ai.provider} key is set but isn't responding`}>
      {ai.message ?? "The provider didn't answer."} Phases will show “assessment unavailable” until it does.
    </Notice>
  )
}

function SignUp({ role, onDone }: { role: Role; onDone: (id: string) => Promise<void> }) {
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const label = role === "company" ? "Company name" : "Your name"
  return (
    <form
      className="mt-4 flex flex-col gap-2 border-t border-ink-100 pt-4 sm:flex-row sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          const res = await api.post<{ id: string }>("/accounts", { role, name })
          await onDone(res.id)
        } catch (err) {
          setError(err instanceof ApiRequestError ? err.message : "Something went wrong.")
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="flex-1">
        <Field label={`Or create ${role === "company" ? "a company" : "a student account"}`} htmlFor={`new-${role}`} error={error}>
          <input id={`new-${role}`} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={label} autoComplete="off" aria-invalid={!!error} />
        </Field>
      </div>
      <Button type="submit" variant="secondary" loading={busy} disabled={name.trim().length < 2}>
        Create
      </Button>
    </form>
  )
}

export default function DemoLogin() {
  const { signInAs, actor, demoMode } = useSession()
  const navigate = useNavigate()
  const accounts = useApi<DemoAccounts>("/demo-accounts")

  const enter = async (role: Role, id: string) => {
    await signInAs(role, id)
    navigate(role === "student" ? "/student" : "/company")
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <PageHeader eyebrow="Demo sign-in" title="Choose who to be" subtitle="See Qudra from either side. There are no passwords here — this is an account switcher for exploring the prototype, not real authentication." />
      <div className="mb-6 space-y-3">
        <AiStatus />
        {actor && (
          <Notice tone="info">
            You're signed in as <strong>{actor.name}</strong>.{" "}
            <button type="button" className="font-semibold underline" onClick={() => navigate(`/${actor.role}`)}>
              Continue
            </button>
          </Notice>
        )}
      </div>
      {!demoMode && accounts.data && !accounts.data.demoMode && (
        <Notice tone="warn" title="Demo sign-in is switched off on this server">Real accounts are not part of this prototype.</Notice>
      )}
      <Async state={accounts}>
        {(a) => (
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border border-ink-200 bg-surface p-5" aria-labelledby="students-title">
              <h2 id="students-title" className="font-bold text-ink-950">Students &amp; graduates</h2>
              <ul className="mt-3 space-y-2">
                {a.students.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => void enter("student", s.id)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink-200 px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-teal-400">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink-900">{s.name}</span>
                        <span className="block truncate text-xs text-ink-500">{s.headline || (s.status === "graduate" ? "Graduate" : "Student")}</span>
                      </span>
                      {s.isDemoFixture && <DemoBadge className="shrink-0" />}
                    </button>
                  </li>
                ))}
              </ul>
              {a.demoMode && <SignUp role="student" onDone={(id) => enter("student", id)} />}
            </section>
            <section className="rounded-2xl border border-ink-200 bg-surface p-5" aria-labelledby="companies-title">
              <h2 id="companies-title" className="font-bold text-ink-950">Companies</h2>
              <ul className="mt-3 space-y-2">
                {a.companies.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => void enter("company", c.id)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink-200 px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-teal-400">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink-900">{c.name}</span>
                        <span className="block truncate text-xs text-ink-500">{c.industry}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {a.demoMode && <SignUp role="company" onDone={(id) => enter("company", id)} />}
            </section>
          </div>
        )}
      </Async>
      <p className="mt-6 text-xs text-ink-500">“Demonstration data” marks sample people and results that were not produced by the Proof Engine. Sara Nasser is a blank account for trying the whole flow.</p>
    </div>
  )
}
