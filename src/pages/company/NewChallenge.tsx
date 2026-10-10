import { useState } from "react"
import type { FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Card, CardHeader } from "../../components/ui/Card"
import { Button, ChipInput, Field, inputClass, Notice } from "../../components/ui/kit"
import { PageHeader } from "../../components/ui/PageHeader"
import { api, ApiRequestError } from "../../lib/api"
import type { Difficulty } from "../../types"

export default function NewChallenge() {
  const navigate = useNavigate()
  const [problem, setProblem] = useState("")
  const [skills, setSkills] = useState<string[]>([])
  const [difficulty, setDifficulty] = useState<Difficulty>("intermediate")
  const [deliverables, setDeliverables] = useState("")
  const [hours, setHours] = useState("8")
  const [busy, setBusy] = useState<"draft" | "generate" | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [general, setGeneral] = useState<string | null>(null)

  const submit = async (e: FormEvent, generate: boolean) => {
    e.preventDefault()
    setBusy(generate ? "generate" : "draft")
    setErrors({})
    setGeneral(null)
    let id: string | null = null
    try {
      const created = await api.post<{ id: string }>("/company/challenges", {
        problemDescription: problem, requiredSkills: skills, difficulty, expectedDeliverables: deliverables, timeHours: hours === "" ? "" : Number(hours),
      })
      id = created.id
      if (generate) await api.post(`/company/challenges/${id}/generate`, {})
      navigate(`/company/challenges/${id}`)
    } catch (err) {
      // The brief was saved even if generating failed: continue on its page, where the problem is explained.
      if (id) {
        navigate(`/company/challenges/${id}`, { state: { generationError: err instanceof Error ? err.message : "The AI couldn't generate the challenge." } })
        return
      }
      if (err instanceof ApiRequestError && err.field) setErrors({ [err.field]: err.message })
      else setGeneral(err instanceof Error ? err.message : "Something went wrong.")
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Company challenge" title="Describe the problem" subtitle="Five fields. Qudra turns them into a phased challenge with objectives, acceptance criteria and rubrics — and you review it before anyone sees it." />
      <form onSubmit={(e) => void submit(e, true)} noValidate>
        <Card>
          <CardHeader title="Your brief" />
          <div className="space-y-5 px-5 py-5">
            <Field label="Problem description" htmlFor="problem" hint="What needs solving, and why. Use invented data — don't paste personal data, customer details or secrets." error={errors.problemDescription}>
              <textarea id="problem" className={`${inputClass} min-h-36`} value={problem} onChange={(e) => setProblem(e.target.value)} maxLength={4000} aria-invalid={!!errors.problemDescription} />
            </Field>
            <Field label="Required skills and technologies" htmlFor="skills" hint="Up to 8. Press Enter or comma after each." error={errors.requiredSkills}>
              <ChipInput id="skills" value={skills} onChange={setSkills} max={8} placeholder="e.g. Python, REST API design, SQL" />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Difficulty" htmlFor="difficulty" error={errors.difficulty}>
                <select id="difficulty" className={inputClass} value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </Field>
              <Field label="Realistic time for one candidate (hours)" htmlFor="hours" hint="The phases will add up to this." error={errors.timeHours}>
                <input id="hours" type="number" min={1} max={200} className={inputClass} value={hours} onChange={(e) => setHours(e.target.value)} aria-invalid={!!errors.timeHours} />
              </Field>
            </div>
            <Field label="Expected deliverables" htmlFor="deliverables" hint="What you'd want to see handed in." error={errors.expectedDeliverables}>
              <textarea id="deliverables" className={`${inputClass} min-h-24`} value={deliverables} onChange={(e) => setDeliverables(e.target.value)} maxLength={2000} aria-invalid={!!errors.expectedDeliverables} />
            </Field>
            {general && <Notice tone="danger">{general}</Notice>}
            <Notice tone="info" title="What happens next">
              The challenge is drafted by AI (or, if no AI is configured, from a labelled template). It stays private to you until you review, edit if you like, and publish it. The company's brief is treated as data, never as instructions.
            </Notice>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" loading={busy === "generate"} disabled={busy !== null}>{busy === "generate" ? "Drafting your challenge…" : "Create and generate"}</Button>
              <Button variant="secondary" loading={busy === "draft"} disabled={busy !== null} onClick={(e) => void submit(e, false)}>Save as draft</Button>
              {busy === "generate" && <span className="text-xs text-ink-500">This can take up to a minute.</span>}
            </div>
          </div>
        </Card>
      </form>
    </div>
  )
}
