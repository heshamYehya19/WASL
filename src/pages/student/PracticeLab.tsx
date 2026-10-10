import { useState } from "react"
import type { FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Card, CardHeader } from "../../components/ui/Card"
import { Button, ChipInput, Field, inputClass, Notice } from "../../components/ui/kit"
import { PageHero } from "../../components/ui/ListKit"
import { Badge } from "../../components/ui/StatusBadge"
import { useApi } from "../../hooks/useApi"
import { api, ApiRequestError } from "../../lib/api"
import { formatRelative } from "../../lib/format"
import type { Difficulty, WorkItem } from "../../types"

const LANGUAGES = ["Python", "JavaScript", "TypeScript", "Java", "C#", "C++", "Go", "Rust", "SQL", "Kotlin", "PHP", "Ruby"]

export default function PracticeLab() {
  const navigate = useNavigate()
  const existing = useApi<{ work: WorkItem[] }>("/work?kind=practice")
  const [skills, setSkills] = useState<string[]>([])
  const [difficulty, setDifficulty] = useState<Difficulty>("beginner")
  const [description, setDescription] = useState("")
  const [language, setLanguage] = useState("")
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [general, setGeneral] = useState<{ message: string; canUseTemplate: boolean } | null>(null)

  const create = async (useTemplate = false) => {
    setBusy(true)
    setErrors({})
    setGeneral(null)
    try {
      const res = await api.post<{ runId: string }>("/practice", { skills, difficulty, description, language, useTemplate })
      navigate(`/student/work/${res.runId}`)
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.field) setErrors({ [err.field]: err.message })
        else setGeneral({ message: err.message, canUseTemplate: err.status === 503 })
      } else setGeneral({ message: "Something went wrong.", canUseTemplate: false })
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void create(false)
  }

  return (
    <div>
      <PageHero eyebrow="Student Practice Lab" title="Practise on something built for you" subtitle="Choose the skills and the difficulty. Qudra designs a phased challenge, then reviews and interviews you on your work exactly as it would for a company. It's private unless you decide otherwise." />
      <div className="grid gap-6 lg:grid-cols-3">
        <form onSubmit={submit} className="space-y-5 lg:col-span-2" noValidate>
          <Card>
            <CardHeader title="New practice challenge" />
            <div className="space-y-5 px-5 py-5">
              <Field label="Skills to practise" htmlFor="skills" hint="Up to 6. Press Enter or comma after each." error={errors.skills}>
                <ChipInput id="skills" value={skills} onChange={setSkills} max={6} placeholder="e.g. Python, SQL, REST API design" />
              </Field>
              <Field label="Difficulty" htmlFor="difficulty" error={errors.difficulty}>
                <select id="difficulty" className={inputClass} value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                  <option value="beginner">Beginner — about 3 hours</option>
                  <option value="intermediate">Intermediate — about 5 hours</option>
                  <option value="advanced">Advanced — about 8 hours</option>
                </select>
              </Field>
              <Field label="Describe what you'd like to build" htmlFor="description" optional hint="A domain, a scenario, a constraint — or leave it blank and one is chosen for you." error={errors.description}>
                <textarea id="description" className={`${inputClass} min-h-24`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1500} aria-invalid={!!errors.description} />
              </Field>
              <Field label="Programming language" htmlFor="language" optional hint="Leave blank to choose yourself." error={errors.language}>
                <input id="language" list="languages" className={inputClass} value={language} onChange={(e) => setLanguage(e.target.value)} maxLength={40} autoComplete="off" aria-invalid={!!errors.language} />
                <datalist id="languages">{LANGUAGES.map((l) => <option key={l} value={l} />)}</datalist>
              </Field>
              {general && (
                <Notice tone="danger" title={general.canUseTemplate ? "The AI couldn't design this right now" : undefined}>
                  {general.message}
                  {general.canUseTemplate && (
                    <div className="mt-3 text-sm">
                      You can try again, or start from a plain template instead — it is not AI-generated and says so. The review and interview still need the AI.
                      <div className="mt-2"><Button variant="secondary" onClick={() => void create(true)} loading={busy}>Use the template</Button></div>
                    </div>
                  )}
                </Notice>
              )}
              <Button type="submit" loading={busy} disabled={skills.length === 0}>{busy ? "Designing your challenge…" : "Create my challenge"}</Button>
              {busy && <p className="text-xs text-ink-500">This can take up to a minute.</p>}
            </div>
          </Card>
        </form>
        <div className="space-y-4">
          <Notice tone="info" title="How practice works">
            Each phase: you submit code and/or a GitHub link, the work is reviewed, you're interviewed about it, then it's assessed. Your code is read, never run.
          </Notice>
          <Notice tone="info" title="Private by default">Nobody else sees practice work. You can later share a run with employers from its page.</Notice>
        </div>
      </div>

      <div className="mt-10">
        <h2 className="mb-4 text-xl font-bold tracking-tight text-ink-950">Your practice challenges</h2>
        {existing.data && existing.data.work.length === 0 && <p className="text-sm text-ink-500">None yet.</p>}
        <ul className="grid gap-3 md:grid-cols-2">
          {(existing.data?.work ?? []).map((w) => (
            <li key={w.id}>
              <Link to={`/student/work/${w.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-surface px-5 py-4 transition-all hover:-translate-y-0.5 hover:border-teal-400">
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink-900">{w.title}</span>
                  <span className="block text-xs text-ink-500">{w.skills.slice(0, 3).join(", ")} · {formatRelative(w.startedAt)}</span>
                </span>
                <Badge tone={w.status === "completed" ? "green" : "sky"}>{w.progress.passed}/{w.progress.total}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
