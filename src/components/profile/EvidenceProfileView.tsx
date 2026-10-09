import { Card, CardHeader } from "../ui/Card"
import { DemoBadge } from "../ui/kit"
import { RatingPips } from "../ui/ListKit"
import { SkillChip } from "../ui/SkillChip"
import { formatDate } from "../../lib/format"
import type { EvidenceProfile, SkillEvidence } from "../../types"

const GROUPS: { status: SkillEvidence["status"]; title: string; selfOnly?: boolean; help: string }[] = [
  { status: "demonstrated", title: "Demonstrated", help: "A Proof Engine assessment of the candidate's own submission and interview passed for a phase that exercises this skill." },
  { status: "building", title: "Building", selfOnly: true, help: "Work in progress — attempts that haven't passed yet. Only you see this." },
  { status: "declared", title: "Declared", help: "Self-reported and not yet demonstrated on WASL." },
]

/** Declared and demonstrated skills side by side, each with the evidence behind it. Used for the candidate and for employers. */
export function EvidenceProfileView({ profile, audience }: { profile: EvidenceProfile; audience: "self" | "employer" }) {
  const groups = GROUPS.filter((g) => audience === "self" || !g.selfOnly)
  return (
    <Card>
      <CardHeader title="Skills and evidence" subtitle={audience === "self" ? "What you've shown, what you're building, and what you've only declared." : "Only skills the candidate has demonstrated carry evidence."} />
      <div className="space-y-6 px-5 py-4">
        {groups.map((g) => {
          const skills = profile.skills.filter((s) => s.status === g.status)
          return (
            <section key={g.status} aria-label={g.title}>
              <h3 className="text-sm font-bold text-ink-900">{g.title} <span className="font-normal text-ink-500">({skills.length})</span></h3>
              <p className="mb-2 text-xs text-ink-500">{g.help}</p>
              {skills.length === 0 && <p className="text-sm text-ink-500">{g.status === "demonstrated" ? "No skills demonstrated yet." : "None."}</p>}
              <ul className="space-y-3">
                {skills.map((s) => (
                  <li key={s.skill}>
                    <SkillChip skill={s.skill} state={s.status} />
                    {s.evidence.length > 0 && (
                      <ul className="mt-2 space-y-2 border-l-2 border-ink-100 pl-4">
                        {s.evidence.map((e, i) => (
                          <li key={i} className="text-sm">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                              <span className="font-medium text-ink-800">{e.phaseTitle}</span>
                              <span className="text-xs text-ink-500">in {e.runTitle}{e.companyName ? ` · ${e.companyName}` : e.kind === "practice" ? " · practice" : ""} · {formatDate(e.assessedAt)}</span>
                              {e.isDemoFixture && <DemoBadge />}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-600">
                              <span className="flex items-center gap-2">Correctness <RatingPips rating={e.ratings.correctness} /></span>
                              <span className="flex items-center gap-2">Code quality <RatingPips rating={e.ratings.codeQuality} /></span>
                              <span className="flex items-center gap-2">Understanding <RatingPips rating={e.ratings.understanding} /></span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
        <p className="rounded-xl bg-ink-100 px-4 py-2.5 text-xs leading-relaxed text-ink-600">{profile.explanation}</p>
      </div>
    </Card>
  )
}
