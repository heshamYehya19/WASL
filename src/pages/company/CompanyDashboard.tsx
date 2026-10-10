import { Link } from "react-router-dom"
import { Card, CardHeader, StatTile } from "../../components/ui/Card"
import { EmptyState } from "../../components/ui/EmptyState"
import { LinkButton, Notice } from "../../components/ui/kit"
import { PageHero } from "../../components/ui/ListKit"
import { ChallengeStatusBadge } from "../../components/ui/StatusBadge"
import { useApi } from "../../hooks/useApi"
import { formatRelative } from "../../lib/format"
import { useSession } from "../../state/session"
import type { ChallengeSummary, Health, TalentCandidate } from "../../types"

export default function CompanyDashboard() {
  const { actor } = useSession()
  const me = useApi<{ company: { name: string; industry: string }; counts: { challenges: number; published: number; candidates: number } }>("/company/me")
  const challenges = useApi<{ challenges: ChallengeSummary[] }>("/company/challenges")
  const shortlist = useApi<{ shortlist: { kind: "saved" | "interested"; candidate: TalentCandidate }[] }>("/talent/shortlist")
  const health = useApi<Health>("/health")
  const list = challenges.data?.challenges ?? []
  const needsAttention = list.filter((c) => c.status === "generated" || c.status === "reviewed")

  return (
    <div>
      <PageHero
        eyebrow="Company"
        title={actor?.name ?? "Your company"}
        subtitle="Turn a real problem into a phased challenge, see how candidates handle it, and find people by what they've demonstrated."
        action={<LinkButton to="/company/challenges/new" variant="secondary" className="!border-white/20 !bg-white/10 !text-white hover:!border-teal-300">New challenge</LinkButton>}
      />
      {health.data && !health.data.ai.configured && (
        <Notice tone="warn" title="The AI isn't configured on this server" className="mb-6">
          Challenge generation will use a plain, clearly labelled template, and candidates' reviews, interviews and assessments will report “assessment unavailable”.
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Challenges" value={me.data?.counts.challenges ?? 0} />
        <StatTile label="Open to candidates" value={me.data?.counts.published ?? 0} />
        <StatTile label="Candidates who started" value={me.data?.counts.candidates ?? 0} />
        <StatTile label="On your shortlist" value={shortlist.data?.shortlist.length ?? 0} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Your challenges" action={<Link to="/company/challenges" className="text-sm font-semibold text-teal-700 hover:underline">All</Link>} />
          {list.length === 0 ? (
            <div className="p-5"><EmptyState title="No challenges yet" description="Describe a problem in five fields and Qudra will draft a phased challenge for you to review." action={<LinkButton to="/company/challenges/new">Create a challenge</LinkButton>} /></div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {list.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <Link to={`/company/challenges/${c.id}`} className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-ink-50">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink-900">{c.title}</span>
                      <span className="block text-xs text-ink-500">{c.candidatesStarted} started · {c.candidatesCompleted} completed · updated {formatRelative(c.updatedAt)}</span>
                    </span>
                    <ChallengeStatusBadge status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-6">
          {needsAttention.length > 0 && (
            <Notice tone="info" title="Waiting on you">
              <ul className="mt-1 list-disc pl-5">
                {needsAttention.map((c) => <li key={c.id}><Link to={`/company/challenges/${c.id}`} className="font-semibold underline">{c.title}</Link> — {c.status === "generated" ? "review and edit it" : "ready to publish"}</li>)}
              </ul>
            </Notice>
          )}
          <Card>
            <CardHeader title="Talent Discovery" />
            <p className="px-5 py-4 text-sm text-ink-600">Search by demonstrated skills. Every match shows the evidence behind it.</p>
            <div className="px-5 pb-4"><LinkButton to="/company/talent" variant="secondary">Find candidates</LinkButton></div>
          </Card>
        </div>
      </div>
    </div>
  )
}
