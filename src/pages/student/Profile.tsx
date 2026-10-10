import { useRef, useState } from "react"
import type { FormEvent } from "react"
import { EvidenceProfileView } from "../../components/profile/EvidenceProfileView"
import { Card, CardHeader } from "../../components/ui/Card"
import { Async, Button, ChipInput, DemoBadge, Field, inputClass, Notice } from "../../components/ui/kit"
import { PageHeader } from "../../components/ui/PageHeader"
import { useApi } from "../../hooks/useApi"
import { api, ApiRequestError, download, fileToBase64 } from "../../lib/api"
import { formatBytes, formatDate, formatRelative } from "../../lib/format"
import type { Availability, CandidateLink, OwnProfile } from "../../types"

const AVAILABILITY: { value: Availability; label: string }[] = [
  { value: "open_to_work", label: "Open to work" },
  { value: "open_to_internships", label: "Open to internships" },
  { value: "not_available", label: "Not available" },
]

function InfoForm({ profile, onSaved }: { profile: OwnProfile; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: profile.name, headline: profile.headline, bio: profile.bio, location: profile.location, education: profile.education,
    status: profile.status, availability: profile.availability,
  })
  const [skills, setSkills] = useState(profile.declaredSkills)
  const [links, setLinks] = useState<CandidateLink[]>(profile.links)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setSaved(false)
    setForm((f) => ({ ...f, [k]: v }))
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      await api.put("/profile", { ...form, declaredSkills: skills, links })
      setSaved(true)
      onSaved()
    } catch (err) {
      setErrors(err instanceof ApiRequestError && err.field ? { [err.field]: err.message } : { form: err instanceof ApiRequestError ? err.message : "Something went wrong." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title="About you" subtitle="Everything here is self-reported. Qudra doesn't verify any of it, and employers see it labelled that way." />
      <form onSubmit={save} className="space-y-4 px-5 py-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="p-name" error={errors.name}><input id="p-name" className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={80} aria-invalid={!!errors.name} /></Field>
          <Field label="Headline" htmlFor="p-headline" optional error={errors.headline}><input id="p-headline" className={inputClass} value={form.headline} onChange={(e) => set("headline", e.target.value)} maxLength={120} placeholder="e.g. Backend developer · Python" /></Field>
          <Field label="I am a" htmlFor="p-status" error={errors.status}>
            <select id="p-status" className={inputClass} value={form.status} onChange={(e) => set("status", e.target.value as "student" | "graduate")}>
              <option value="student">Student</option>
              <option value="graduate">Graduate</option>
            </select>
          </Field>
          <Field label="Availability" htmlFor="p-availability" error={errors.availability}>
            <select id="p-availability" className={inputClass} value={form.availability} onChange={(e) => set("availability", e.target.value as Availability)}>
              {AVAILABILITY.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </Field>
          <Field label="Location" htmlFor="p-location" optional error={errors.location}><input id="p-location" className={inputClass} value={form.location} onChange={(e) => set("location", e.target.value)} maxLength={80} /></Field>
          <Field label="Education" htmlFor="p-education" optional hint="Free text, shown as you write it." error={errors.education}><input id="p-education" className={inputClass} value={form.education} onChange={(e) => set("education", e.target.value)} maxLength={200} /></Field>
        </div>
        <Field label="About" htmlFor="p-bio" optional error={errors.bio}><textarea id="p-bio" className={`${inputClass} min-h-24`} value={form.bio} onChange={(e) => set("bio", e.target.value)} maxLength={1200} /></Field>
        <Field label="Skills you declare" htmlFor="p-skills" hint="These show as “declared” until a Proof Engine assessment demonstrates them." error={errors.declaredSkills}>
          <ChipInput id="p-skills" value={skills} onChange={(v) => { setSaved(false); setSkills(v) }} max={20} placeholder="e.g. Python, SQL, Git" />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold text-ink-800">Links <span className="text-xs font-normal text-ink-400">optional, https only</span></legend>
          <div className="space-y-2">
            {links.map((l, i) => (
              <div key={i} className="flex flex-wrap gap-2">
                <input aria-label={`Link ${i + 1} label`} className={`${inputClass} !w-36`} placeholder="Label" value={l.label} maxLength={40} onChange={(e) => { setSaved(false); setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))) }} />
                <input aria-label={`Link ${i + 1} address`} className={`${inputClass} min-w-48 flex-1`} placeholder="https://…" value={l.url} maxLength={300} inputMode="url" onChange={(e) => { setSaved(false); setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x))) }} />
                <Button variant="ghost" onClick={() => setLinks(links.filter((_, j) => j !== i))} aria-label={`Remove link ${i + 1}`}>Remove</Button>
              </div>
            ))}
            {links.length < 5 && <Button variant="secondary" onClick={() => setLinks([...links, { label: "", url: "" }])}>Add a link</Button>}
            {errors.links && <p role="alert" className="text-xs font-medium text-danger-600">{errors.links}</p>}
          </div>
        </fieldset>
        {errors.form && <Notice tone="danger">{errors.form}</Notice>}
        <div className="flex items-center gap-3">
          <Button type="submit" loading={busy}>Save</Button>
          {saved && <span role="status" className="text-sm font-medium text-verified-600">Saved ✓</span>}
        </div>
      </form>
    </Card>
  )
}

function Toggle({ id, label, help, checked, onChange }: { id: string; label: string; help: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 p-4 transition-colors hover:border-teal-400">
      <input id={id} type="checkbox" role="switch" className="mt-1 h-4 w-4 accent-teal-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block font-semibold text-ink-900">{label}</span>
        <span className="block text-sm text-ink-600">{help}</span>
      </span>
    </label>
  )
}

function Visibility({ profile, onChanged }: { profile: OwnProfile; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const update = async (patch: Record<string, boolean>) => {
    setError(null)
    try {
      await api.put("/profile", patch)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong.")
    }
  }
  const employerShared = profile.work.filter((w) => w.shareScope === "employers").length
  return (
    <Card>
      <CardHeader title="Who can find you" subtitle={profile.sharingNotice} />
      <div className="space-y-3 px-5 py-4">
        <Toggle id="discoverable" label="Appear in Talent Discovery" help="Companies can find your profile when they search for skills. You can turn this off at any time." checked={profile.discoverable} onChange={(v) => void update({ discoverable: v })} />
        <Toggle id="cvShared" label="Let employers download my CV" help="Only applies while you're discoverable and have uploaded a CV." checked={profile.cvShared} onChange={(v) => void update({ cvShared: v })} />
        {profile.discoverable && employerShared === 0 && (
          <Notice tone="warn">You're discoverable, but no work is shared with employers, so they will only see what you've declared. Open a piece of work and choose “Employers who find me” to let them see what you've demonstrated.</Notice>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Card>
  )
}

function Cv({ profile, onChanged }: { profile: OwnProfile; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader title="CV" subtitle="Optional. PDF, Word, text or Markdown, up to 8 MB. Private unless you let employers download it." />
      <div className="space-y-3 px-5 py-4">
        {profile.cv ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span><strong>{profile.cv.name}</strong> · {formatBytes(profile.cv.size)} · uploaded {formatDate(profile.cv.uploadedAt)}</span>
            <span className="flex gap-2">
              <Button variant="secondary" onClick={() => void download("/profile/cv", profile.cv!.name).catch((e) => setError(e instanceof Error ? e.message : "Download failed."))}>Download</Button>
              <Button variant="danger" onClick={async () => { await api.del("/profile/cv"); onChanged() }}>Remove</Button>
            </span>
          </div>
        ) : (
          <p className="text-sm text-ink-500">No CV uploaded.</p>
        )}
        <input
          ref={input}
          type="file"
          accept=".pdf,.docx,.doc,.txt,.md"
          className="sr-only"
          id="cv-file"
          aria-label="Choose a CV file"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            setBusy(true)
            setError(null)
            try {
              await api.put("/profile/cv", { name: file.name, data: await fileToBase64(file) })
              onChanged()
            } catch (err) {
              setError(err instanceof ApiRequestError ? err.message : "Something went wrong.")
            } finally {
              setBusy(false)
              if (input.current) input.current.value = ""
            }
          }}
        />
        <Button variant="secondary" loading={busy} onClick={() => input.current?.click()}>{profile.cv ? "Replace CV" : "Upload CV"}</Button>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Card>
  )
}

export default function Profile() {
  const state = useApi<{ profile: OwnProfile }>("/profile")
  const interest = useApi<{ interest: { company: { id: string; name: string; industry: string }; message: string; at: string }[] }>("/interest")

  return (
    <Async state={state}>
      {({ profile }) => (
        <div className="mx-auto max-w-4xl space-y-6">
          <PageHeader eyebrow="Profile" title={<span className="inline-flex flex-wrap items-center gap-3">{profile.name}{profile.isDemoFixture && <DemoBadge />}</span>} subtitle={profile.headline || "Add a headline so companies know who you are."} />
          <EvidenceProfileView profile={profile.evidence} audience="self" />
          <InfoForm key={JSON.stringify([profile.name, profile.headline, profile.bio, profile.location, profile.education, profile.status, profile.availability, profile.declaredSkills, profile.links])} profile={profile} onSaved={() => void state.reload()} />
          <Visibility profile={profile} onChanged={() => void state.reload()} />
          <Cv profile={profile} onChanged={() => void state.reload()} />
          <Card>
            <CardHeader title="Companies that expressed interest" subtitle="They can only do this if you're discoverable." />
            {(interest.data?.interest.length ?? 0) === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-500">None yet.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {interest.data!.interest.map((i) => (
                  <li key={i.company.id} className="px-5 py-3 text-sm">
                    <div className="font-semibold text-ink-900">{i.company.name} <span className="font-normal text-ink-500">· {i.company.industry} · {formatRelative(i.at)}</span></div>
                    {i.message && <p className="mt-0.5 text-ink-700">“{i.message}”</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </Async>
  )
}
