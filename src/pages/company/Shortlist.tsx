import { Link } from "react-router-dom"
import { Card } from "../../components/ui/Card"
import { EmptyState } from "../../components/ui/EmptyState"
import { Async, DemoBadge, LinkButton } from "../../components/ui/kit"
import { PageHero } from "../../components/ui/ListKit"
import { SkillChip } from "../../components/ui/SkillChip"
import { Badge } from "../../components/ui/StatusBadge"
import { useApi } from "../../hooks/useApi"
import { formatRelative } from "../../lib/format"
import type { TalentCandidate } from "../../types"

export default function Shortlist() {
  const state = useApi<{ shortlist: { kind: "saved" | "interested"; message: string; at: string; candidate: TalentCandidate }[] }>("/talent/shortlist")
  return (
    <div>
      <PageHero eyebrow="Shortlist" title="People you've saved or reached out to" subtitle="Only visible to your company." />
      <Async state={state}>
        {({ shortlist }) =>
          shortlist.length === 0 ? (
            <EmptyState title="Nobody yet" description="Save candidates from Talent Discovery, or express interest, and they'll collect here." action={<LinkButton to="/company/talent">Find candidates</LinkButton>} />
          ) : (
            <ul className="space-y-3">
              {shortlist.map((s) => (
                <li key={`${s.kind}-${s.candidate.id}`}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to={`/company/talent/${s.candidate.id}`} className="font-bold text-teal-700 hover:underline">{s.candidate.name}</Link>
                          <Badge tone={s.kind === "interested" ? "green" : "teal"}>{s.kind === "interested" ? "Interest sent" : "Saved"}</Badge>
                          {s.candidate.isDemoFixture && <DemoBadge />}
                        </div>
                        <div className="text-sm text-ink-600">{s.candidate.headline}</div>
                        {s.message && <p className="mt-1 text-sm text-ink-700">“{s.message}”</p>}
                        <div className="mt-2 flex flex-wrap gap-1.5">{s.candidate.evidence.skills.slice(0, 5).map((k) => <SkillChip key={k.skill} skill={k.skill} state={k.status === "building" ? "declared" : k.status} size="sm" />)}</div>
                      </div>
                      <span className="text-xs text-ink-500">{formatRelative(s.at)}</span>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </div>
  )
}
