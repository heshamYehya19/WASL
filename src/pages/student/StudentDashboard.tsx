import { Link } from "react-router-dom"
import { Card, CardHeader, StatTile } from "../../components/ui/Card"
import { EmptyState } from "../../components/ui/EmptyState"
import { LinkButton, Notice } from "../../components/ui/kit"
import { PageHero } from "../../components/ui/ListKit"
import { SkillChip } from "../../components/ui/SkillChip"
import { Badge } from "../../components/ui/StatusBadge"
import { useApi } from "../../hooks/useApi"
import { formatRelative } from "../../lib/format"
import { useSession } from "../../state/session"
import type { GapListItem, Health, OwnProfile, WorkItem } from "../../types"

export default function StudentDashboard() {
  const { actor } = useSession()
  const work = useApi<{ work: WorkItem[] }>("/work")
  const profile = useApi<{ profile: OwnProfile }>("/profile")
  const gaps = useApi<{ gaps: GapListItem[] }>("/learning")
  const interest = useApi<{ interest: unknown[] }>("/interest")
  const health = useApi<Health>("/health")

  const runs = work.data?.work ?? []
  const active = runs.filter((r) => r.status === "in_progress")
  const skills = profile.data?.profile.evidence.skills ?? []
  const openGaps = (gaps.data?.gaps ?? []).filter((g) => !g.resolved)

  return (
    <div>
      <PageHero
        eyebrow="Student / graduate"
        title={`Welcome, ${actor?.name.split(" ")[0] ?? ""}`}
        subtitle="Take a company's challenge, or practise on your own. Whatever you submit is reviewed, discussed with you, and turned into evidence you control."
        action={<LinkButton to="/student/practice" variant="secondary" className="!border-white/20 !bg-white/10 !text-white hover:!border-teal-300">Start a practice challenge</LinkButton>}
      />

      {health.data && !health.data.ai.configured && (
        <Notice tone="warn" title="The AI isn't configured on this server" className="mb-6">
          You can browse and write submissions, but review, interview and assessment will say “assessment unavailable” until a provider key is added.
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Challenges in progress" value={active.length} />
        <StatTile label="Skills demonstrated" value={profile.data?.profile.evidence.demonstratedCount ?? 0} />
        <StatTile label="Skills to work on" value={openGaps.length} />
        <StatTile label="Companies interested" value={interest.data?.interest.length ?? 0} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Pick up where you left off" action={<Link to="/student/work" className="text-sm font-semibold text-teal-700 hover:underline">All my work</Link>} />
            {active.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="Nothing in progress"
                  description="Start with a company challenge, or build a practice challenge around the skills you want to prove."
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      <LinkButton to="/student/challenges">Browse company challenges</LinkButton>
                      <LinkButton to="/student/practice" variant="secondary">Practice Lab</LinkButton>
                    </div>
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-ink-100">
                {active.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    <Link to={`/student/work/${r.id}`} className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-ink-50">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink-900">{r.title}</span>
                        <span className="block text-xs text-ink-500">{r.kind === "practice" ? "Practice" : r.companyName} · started {formatRelative(r.startedAt)}</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-ink-700 tabular-nums">{r.progress.passed}/{r.progress.total} phases</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Improve" subtitle="Skills your assessed work showed room to grow in." action={<Link to="/student/learning" className="text-sm font-semibold text-teal-700 hover:underline">Open</Link>} />
            {openGaps.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-500">Nothing to work on yet. When a phase is assessed, specific gaps and a plan to close them appear here.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {openGaps.slice(0, 4).map((g) => (
                  <li key={g.id}>
                    <Link to={`/student/learning/${g.id}`} className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-ink-50">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink-900">{g.title}</span>
                        <span className="block truncate text-xs text-ink-500">{g.skill} · from “{g.phaseTitle}”</span>
                      </span>
                      <Badge tone={g.severity === "significant" ? "amber" : "neutral"}>{g.severity}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="Your skills" subtitle="Demonstrated through assessed work, or declared by you." action={<Link to="/student/profile" className="text-sm font-semibold text-teal-700 hover:underline">Profile</Link>} />
          <div className="flex flex-wrap gap-2 px-5 py-4">
            {skills.length === 0 && <p className="text-sm text-ink-500">No skills yet. Add the skills you have on your profile, then demonstrate them.</p>}
            {skills.map((s) => <SkillChip key={s.skill} skill={s.skill} state={s.status} size="sm" />)}
          </div>
        </Card>
      </div>
    </div>
  )
}
