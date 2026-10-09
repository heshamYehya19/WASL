import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { EvidenceProfileView } from "../../components/profile/EvidenceProfileView"
import { Card, CardHeader } from "../../components/ui/Card"
import { Async, Button, DemoBadge, Field, inputClass, Notice } from "../../components/ui/kit"
import { Badge } from "../../components/ui/StatusBadge"
import { useApi } from "../../hooks/useApi"
import { api, ApiRequestError, download } from "../../lib/api"
import type { TalentCandidate } from "../../types"

export default function TalentProfile() {
  const { id } = useParams()
  const state = useApi<{ candidate: TalentCandidate }>(`/talent/${id}`)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name)
    setError(null)
    try {
      await fn()
      await state.reload()
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <Async state={state}>
      {({ candidate: c }) => (
        <div className="mx-auto max-w-4xl space-y-6">
          <Link to="/company/talent" className="text-sm font-medium text-ink-500 hover:text-teal-700">← Talent Discovery</Link>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-ink-950">{c.name}</h1>
              {c.isDemoFixture && <DemoBadge />}
              {c.saved && <Badge tone="teal">Saved</Badge>}
            </div>
            <p className="mt-1 text-ink-700">{c.headline || (c.status === "graduate" ? "Graduate" : "Student")}</p>
            <p className="mt-1 text-sm text-ink-500">{[c.location, c.education, c.availabilityLabel].filter(Boolean).join(" · ")}</p>
            {c.bio && <p className="mt-3 max-w-3xl leading-relaxed text-ink-700">{c.bio}</p>}
            <p className="mt-2 text-xs text-ink-500">Education, bio and links are self-reported and not verified by WASL.</p>
            {(c.links.length > 0 || c.cvAvailable) && (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                {c.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-teal-700 hover:underline">{l.label}<span className="sr-only"> (opens in a new tab)</span></a>)}
                {c.cvAvailable && <Button variant="secondary" onClick={() => void act("cv", () => download(`/talent/${c.id}/cv`, "cv"))}>Download CV</Button>}
              </div>
            )}
          </div>

          <EvidenceProfileView profile={c.evidence} audience="employer" />

          <Card>
            <CardHeader title="Get in touch" subtitle="The candidate sees who you are and your message. They aren't obliged to reply." />
            <div className="space-y-3 px-5 py-4">
              {error && <Notice tone="danger">{error}</Notice>}
              {c.interestSent || sent ? (
                <Notice tone="success">You've told {c.name.split(" ")[0]} you're interested.</Notice>
              ) : (
                <>
                  <Field label="A message" htmlFor="interest-message" optional hint="What you'd like to talk about. Up to 500 characters.">
                    <textarea id="interest-message" className={`${inputClass} min-h-24`} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} />
                  </Field>
                  <Button loading={busy === "interest"} onClick={() => void act("interest", async () => { await api.post(`/talent/${c.id}/interest`, { message }); setSent(true) })}>Express interest</Button>
                </>
              )}
              <div>
                <Button variant="secondary" loading={busy === "save"} onClick={() => void act("save", () => api.post(`/talent/${c.id}/save`))}>{c.saved ? "Remove from shortlist" : "Save to shortlist"}</Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </Async>
  )
}
