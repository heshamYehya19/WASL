import { useState } from "react"
import { Card } from "../ui/Card"
import { Button, ChipInput, Field, inputClass, Notice } from "../ui/kit"
import { DIFFICULTIES, DIMENSION_LABELS } from "../../types"
import type { ChallengeSpec, Difficulty, Dimension, PhaseSpec } from "../../types"

/* The structured challenge, editable. A company reviews every part of what the AI drafted: the framing, each phase's task,
   acceptance criteria, rubric (including the notes that stay hidden from candidates) and which earlier phases it builds on. */

const DIMS = Object.keys(DIMENSION_LABELS) as Dimension[]

function List({ id, label, hint, items, onChange, max, rows = 1 }: { id: string; label: string; hint?: string; items: string[]; onChange: (v: string[]) => void; max: number; rows?: number }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold text-ink-800">{label}</legend>
      {hint && <p className="mb-1.5 text-xs text-ink-500">{hint}</p>}
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            {rows > 1 ? (
              <textarea aria-label={`${label} ${i + 1}`} className={`${inputClass} min-h-16`} value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
            ) : (
              <input aria-label={`${label} ${i + 1}`} className={inputClass} value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
            )}
            <Button variant="ghost" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</Button>
          </div>
        ))}
        {items.length < max && <Button id={id} variant="secondary" onClick={() => onChange([...items, ""])}>Add</Button>}
      </div>
    </fieldset>
  )
}

function PhaseEditor({ phase, index, all, onChange, onRemove, canRemove }: { phase: PhaseSpec; index: number; all: PhaseSpec[]; onChange: (p: PhaseSpec) => void; onRemove: () => void; canRemove: boolean }) {
  const set = <K extends keyof PhaseSpec>(k: K, v: PhaseSpec[K]) => onChange({ ...phase, [k]: v })
  const earlier = all.slice(0, index)
  const id = `ph${index}`
  return (
    <Card>
      <details open={index === 0} className="group">
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 font-semibold text-ink-900">
          <span>Phase {index + 1}: {phase.title || "Untitled"}</span>
          <span className="text-xs font-normal text-ink-500 group-open:hidden">Edit</span>
        </summary>
        <div className="space-y-4 border-t border-ink-100 px-5 py-5">
          <Field label="Title" htmlFor={`${id}-title`}><input id={`${id}-title`} className={inputClass} value={phase.title} onChange={(e) => set("title", e.target.value)} maxLength={100} /></Field>
          <Field label="Objective" htmlFor={`${id}-obj`} hint="What the candidate will have shown by the end."><textarea id={`${id}-obj`} className={`${inputClass} min-h-16`} value={phase.objective} onChange={(e) => set("objective", e.target.value)} maxLength={400} /></Field>
          <Field label="Instructions to the candidate" htmlFor={`${id}-ins`}><textarea id={`${id}-ins`} className={`${inputClass} min-h-32`} value={phase.instructions} onChange={(e) => set("instructions", e.target.value)} maxLength={2500} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Skills this phase exercises" htmlFor={`${id}-skills`}><ChipInput id={`${id}-skills`} value={phase.skills} onChange={(v) => set("skills", v)} max={6} /></Field>
            <Field label="Estimated hours" htmlFor={`${id}-hours`}><input id={`${id}-hours`} type="number" min={0.25} step={0.25} className={inputClass} value={phase.estimatedHours} onChange={(e) => set("estimatedHours", Number(e.target.value))} /></Field>
          </div>
          <List id={`${id}-ac`} label="Acceptance criteria" hint="Conditions that can be checked by reading the submission." items={phase.acceptanceCriteria.map((c) => c.text)} onChange={(v) => set("acceptanceCriteria", v.map((text, n) => ({ id: phase.acceptanceCriteria[n]?.id ?? `new${n}`, text })))} max={8} />
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-ink-800">Rubric</legend>
            <p className="mb-1.5 text-xs text-ink-500">Each phase needs at least one item for correctness, code quality and demonstrated understanding. The “strong answer” note is never shown to candidates.</p>
            <div className="space-y-3">
              {phase.rubric.map((r, n) => (
                <div key={n} className="rounded-xl border border-ink-200 p-3">
                  <div className="flex flex-wrap gap-2">
                    <select aria-label={`Rubric item ${n + 1} dimension`} className={`${inputClass} !w-auto`} value={r.dimension} onChange={(e) => set("rubric", phase.rubric.map((x, j) => (j === n ? { ...x, dimension: e.target.value as Dimension } : x)))}>
                      {DIMS.map((d) => <option key={d} value={d}>{DIMENSION_LABELS[d]}</option>)}
                    </select>
                    <input aria-label={`Rubric item ${n + 1} criterion`} className={`${inputClass} min-w-48 flex-1`} placeholder="What is being judged" value={r.criterion} onChange={(e) => set("rubric", phase.rubric.map((x, j) => (j === n ? { ...x, criterion: e.target.value } : x)))} />
                    <Button variant="ghost" aria-label={`Remove rubric item ${n + 1}`} onClick={() => set("rubric", phase.rubric.filter((_, j) => j !== n))}>✕</Button>
                  </div>
                  <input aria-label={`Rubric item ${n + 1} strong answer`} className={`${inputClass} mt-2`} placeholder="What a strong answer would show (hidden from candidates)" value={r.strongSignal} onChange={(e) => set("rubric", phase.rubric.map((x, j) => (j === n ? { ...x, strongSignal: e.target.value } : x)))} />
                </div>
              ))}
              {phase.rubric.length < 9 && <Button variant="secondary" onClick={() => set("rubric", [...phase.rubric, { id: `new${phase.rubric.length}`, dimension: "correctness", criterion: "", strongSignal: "" }])}>Add rubric item</Button>}
            </div>
          </fieldset>
          <List id={`${id}-del`} label="Deliverables" items={phase.deliverables} onChange={(v) => set("deliverables", v)} max={6} />
          {earlier.length > 0 && (
            <fieldset>
              <legend className="mb-1 text-sm font-semibold text-ink-800">Builds on</legend>
              <p className="mb-1.5 text-xs text-ink-500">This phase opens once these have been assessed — passed or not yet passed.</p>
              <div className="flex flex-wrap gap-3">
                {earlier.map((p, n) => (
                  <label key={p.key} className="flex items-center gap-2 text-sm text-ink-800">
                    <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={phase.dependsOn.includes(p.key)} onChange={(e) => set("dependsOn", e.target.checked ? [...phase.dependsOn, p.key] : phase.dependsOn.filter((k) => k !== p.key))} />
                    Phase {n + 1}: {p.title || "Untitled"}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {canRemove && <Button variant="danger" onClick={onRemove}>Remove this phase</Button>}
        </div>
      </details>
    </Card>
  )
}

export function SpecEditor({ spec, onSave, saving }: { spec: ChallengeSpec; onSave: (spec: ChallengeSpec) => Promise<void>; saving: boolean }) {
  const [draft, setDraft] = useState<ChallengeSpec>(() => structuredClone(spec))
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const change = (next: ChallengeSpec) => {
    setDirty(true)
    setDraft(next)
  }
  const totalHours = draft.phases.reduce((n, p) => n + (Number.isFinite(p.estimatedHours) ? p.estimatedHours : 0), 0)

  const updatePhase = (i: number, p: PhaseSpec) => change({ ...draft, phases: draft.phases.map((x, j) => (j === i ? p : x)) })
  const removePhase = (i: number) => {
    const key = draft.phases[i].key
    // Re-key by position so dependencies keep pointing at the right phases.
    const kept = draft.phases.filter((_, j) => j !== i)
    const map = new Map(kept.map((p, n) => [p.key, `p${n + 1}`]))
    change({ ...draft, phases: kept.map((p, n) => ({ ...p, key: `p${n + 1}`, dependsOn: p.dependsOn.filter((k) => k !== key).map((k) => map.get(k)!).filter(Boolean) })) })
  }
  const addPhase = () => {
    const n = draft.phases.length + 1
    change({
      ...draft,
      phases: [...draft.phases, {
        key: `p${n}`, title: "", objective: "", instructions: "", skills: draft.skills.slice(0, 2), acceptanceCriteria: [{ id: "new0", text: "" }, { id: "new1", text: "" }],
        rubric: DIMS.map((d, i) => ({ id: `new${i}`, dimension: d, criterion: "", strongSignal: "" })), deliverables: [""], dependsOn: [draft.phases[draft.phases.length - 1].key], estimatedHours: 1,
      }],
    })
  }

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault()
        setError(null)
        try {
          await onSave(draft)
          setDirty(false)
        } catch (err) {
          setError(err instanceof Error ? err.message : "Something went wrong.")
        }
      }}
    >
      <Card>
        <div className="space-y-4 px-5 py-5">
          <Field label="Title" htmlFor="spec-title"><input id="spec-title" className={inputClass} value={draft.title} onChange={(e) => change({ ...draft, title: e.target.value })} maxLength={120} /></Field>
          <Field label="Summary" htmlFor="spec-summary"><textarea id="spec-summary" className={`${inputClass} min-h-24`} value={draft.summary} onChange={(e) => change({ ...draft, summary: e.target.value })} maxLength={900} /></Field>
          <Field label="Scenario" htmlFor="spec-scenario" optional><textarea id="spec-scenario" className={`${inputClass} min-h-20`} value={draft.scenario} onChange={(e) => change({ ...draft, scenario: e.target.value })} maxLength={1500} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Skills" htmlFor="spec-skills"><ChipInput id="spec-skills" value={draft.skills} onChange={(v) => change({ ...draft, skills: v })} max={10} /></Field>
            <Field label="Difficulty" htmlFor="spec-difficulty">
              <select id="spec-difficulty" className={inputClass} value={draft.difficulty} onChange={(e) => change({ ...draft, difficulty: e.target.value as Difficulty })}>
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
              </select>
            </Field>
          </div>
          <List id="spec-goals" label="Learning goals" items={draft.learningGoals} onChange={(v) => change({ ...draft, learningGoals: v })} max={6} />
        </div>
      </Card>

      <div className="space-y-3">
        {draft.phases.map((p, i) => <PhaseEditor key={i} phase={p} index={i} all={draft.phases} onChange={(np) => updatePhase(i, np)} onRemove={() => removePhase(i)} canRemove={draft.phases.length > 2} />)}
        {draft.phases.length < 6 && <Button variant="secondary" onClick={addPhase}>Add a phase</Button>}
      </div>

      <p className="text-sm text-ink-600">Total workload: <strong>{totalHours.toFixed(2).replace(/\.?0+$/, "")} hours</strong></p>
      {error && <Notice tone="danger" title="This can't be saved yet">{error}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={saving} disabled={!dirty}>Save as a new version</Button>
        {dirty && <span className="text-sm text-amber-600">Unsaved changes</span>}
        <span className="text-xs text-ink-500">Saving keeps the previous version, and the challenge goes back to “generated” until you mark it reviewed again.</span>
      </div>
    </form>
  )
}
