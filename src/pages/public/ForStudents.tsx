import { Link } from "react-router-dom"
import { PageHeader } from "../../components/ui/PageHeader"

const POINTS = [
  ["Practise on your own terms", "Choose skills and a difficulty, optionally describe what you'd like to build and in which language. You get a private, phased challenge and the same review and interview a company challenge gets."],
  ["Take real challenges", "Companies publish phased challenges. You see who is asking, what is expected and how it will be judged before you start — and what they can see of your work."],
  ["Keep the setbacks private", "A phase that isn't passed yet is not a mark against you. Employers see skills you have demonstrated; the attempts you are still working on are for you."],
  ["Improve with a plan", "Every gap is tied to something specific in your work, with checked learning links, a short lesson and an exercise."],
  ["Own your profile", "Your declared skills and your demonstrated skills are shown separately. You decide whether you are discoverable and which work employers can see."],
]

export default function ForStudents() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <PageHeader eyebrow="For students & graduates" title="Show what you can do — not just what you list" subtitle="No university sign-off, no gatekeepers: your work, your explanation, your evidence." />
      <div className="space-y-3">
        {POINTS.map(([title, text]) => (
          <div key={title} className="rounded-2xl border border-ink-200 bg-surface p-5">
            <h2 className="font-semibold text-ink-900">{title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-600">{text}</p>
          </div>
        ))}
      </div>
      <div className="mt-8 rounded-2xl border border-dashed border-ink-300 bg-ink-100 p-5 text-sm leading-relaxed text-ink-700">
        <strong>What to expect:</strong> after you submit, a review runs, then an interview — a handful of open questions about your own code, answered in your own words. Be ready to
        explain choices, not recite definitions. If you can't explain something you submitted, the interview will show it; that's the point.
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link to="/login" className="rounded-full bg-night px-6 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-teal-600">Try the demo</Link>
        <Link to="/how-it-works" className="rounded-full border border-ink-200 px-6 py-3 text-sm font-semibold text-ink-800 hover:border-teal-400">How judging works</Link>
      </div>
    </div>
  )
}
