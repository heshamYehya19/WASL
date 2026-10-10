import { Link } from "react-router-dom"
import { PageHeader } from "../../components/ui/PageHeader"

const POINTS = [
  ["Five fields in, a challenge out", "Describe the problem, the skills, the difficulty, the deliverables and a realistic time. Qudra drafts a phased challenge with acceptance criteria, rubrics and a workload that adds up to your time."],
  ["You review before anyone sees it", "Read it, edit any part, and mark it reviewed. Each edit is a new version; the original draft is kept. Publishing needs an explicit confirmation of how submissions may be used."],
  ["Evaluation use is explicit", "Submissions are used to evaluate candidates' abilities. Publishing a challenge does not transfer ownership of anything a candidate writes, and candidates are told so before they start."],
  ["See the work, and the reasoning", "For candidates who shared their work with you: submissions, the review, the interview transcript with what each question was grounded in, and the three separate ratings with their evidence."],
  ["Search by evidence", "Talent Discovery ranks candidates by demonstrated skills and shows why. Self-declared skills are shown, but marked as declared. Express interest in one click — the candidate sees who and why."],
]

export default function ForCompanies() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <PageHeader eyebrow="For companies" title="Hire from evidence" subtitle="Real problems in, demonstrated ability out." />
      <div className="space-y-3">
        {POINTS.map(([title, text]) => (
          <div key={title} className="rounded-2xl border border-ink-200 bg-surface p-5">
            <h2 className="font-semibold text-ink-900">{title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-600">{text}</p>
          </div>
        ))}
      </div>
      <div className="mt-8 rounded-2xl border border-dashed border-ink-300 bg-ink-100 p-5 text-sm leading-relaxed text-ink-700">
        <strong>Good to know:</strong> challenges are evaluation exercises with invented data, not a channel for production work. Candidates are not employees or contractors, and a
        pass means a candidate demonstrated a skill on that phase — not that they are the right hire.
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link to="/login" className="rounded-full bg-night px-6 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-teal-600">Try the demo</Link>
        <Link to="/how-it-works" className="rounded-full border border-ink-200 px-6 py-3 text-sm font-semibold text-ink-800 hover:border-teal-400">How judging works</Link>
      </div>
    </div>
  )
}
