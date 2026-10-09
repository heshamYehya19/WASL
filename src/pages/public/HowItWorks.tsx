import { Link } from "react-router-dom"
import { PageHeader } from "../../components/ui/PageHeader"
import { MIN_ANSWERED_QUESTIONS, MAX_QUESTIONS, PASS_RULE } from "../../types"

const ENGINE = [
  { title: "1 · Validate", text: "The submission is checked for the basics: it has real content, it isn't a copy of the task, a linked repository can be read. If not, you are asked to revise — nothing is judged yet." },
  { title: "2 · Deterministic checks", text: "Software, not AI, parses what it can (JavaScript and JSON syntax, bracket balance), looks for tests, placeholders and credentials, and removes secrets before anything is stored or shown to a model. Code is never run." },
  { title: "3 · AI review", text: "A language model reads the work as untrusted data and reports findings. Every line it quotes is checked against your submission; quotes that aren't there are discarded." },
  { title: "4 · Adaptive interview", text: `You are asked ${MIN_ANSWERED_QUESTIONS}–${MAX_QUESTIONS} open-ended questions about your own work, each tied to a finding, a criterion or a line of your code. Vague answer? You get a follow-up. No multiple choice, no repeats.` },
  { title: "5 · Assessment", text: "Correctness, code quality and demonstrated understanding are rated 0–3 separately, with evidence the server verifies. A fixed rule — not the model — turns the ratings into pass or not-yet." },
  { title: "6 · Improvement", text: "Gaps become a plan: curated resources whose links are checked, a short AI lesson and a practice exercise. These are practice only — they never change a result." },
]

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <PageHeader eyebrow="How it works" title="From a challenge to evidence an employer can trust" subtitle="The Proof Engine is the same for company challenges and for practice." />

      <h2 className="text-lg font-bold text-ink-950">The phases</h2>
      <p className="mt-2 text-ink-600">
        A challenge is split into ordered phases. A phase opens once you have <em>submitted</em> the one before it — it doesn't have to pass first, so you can keep
        going while a phase is being reviewed, or after one isn't passed yet. If a phase isn't passed yet, you get feedback and an improvement plan and can submit it
        again at any time. The whole solution can be submitted as complete only when every phase has passed.
      </p>

      <h2 className="mt-10 text-lg font-bold text-ink-950">The Proof Engine</h2>
      <ol className="mt-4 space-y-3">
        {ENGINE.map((s) => (
          <li key={s.title} className="rounded-2xl border border-ink-200 bg-surface p-5">
            <h3 className="font-semibold text-ink-900">{s.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-600">{s.text}</p>
          </li>
        ))}
      </ol>

      <h2 className="mt-10 text-lg font-bold text-ink-950">What it takes to pass a phase</h2>
      <p className="mt-2 text-ink-600">All of these, on the 0–3 scale, each backed by evidence the server could verify:</p>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-ink-700">
        <li>Correctness of at least {PASS_RULE.correctness}</li>
        <li>Code quality of at least {PASS_RULE.codeQuality}</li>
        <li>Demonstrated understanding of at least {PASS_RULE.understanding}</li>
        <li>A completed interview with at least {MIN_ANSWERED_QUESTIONS} answered questions</li>
      </ul>

      <h2 className="mt-10 text-lg font-bold text-ink-950">When something goes wrong</h2>
      <p className="mt-2 text-ink-600">
        If the AI is unavailable or its answer can't be validated, the phase becomes <strong>assessment unavailable</strong>. Your work and your interview answers are kept, nothing
        is passed or failed, and you can retry. A phase that is <strong>not passed yet</strong> keeps every attempt, and you can submit again whenever you like.
      </p>

      <h2 className="mt-10 text-lg font-bold text-ink-950">Limits we state plainly</h2>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-ink-700">
        <li>Submitted code is analysed statically; it is not executed, so "it runs" is never claimed.</li>
        <li>An AI interview raises confidence that you understand your work. It does not prove you wrote it.</li>
        <li>Challenges and results produced by AI are labelled as such, and a company reviews its challenge before publishing.</li>
      </ul>

      <div className="mt-10">
        <Link to="/login" className="rounded-full bg-night px-6 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-teal-600">
          Try the demo
        </Link>
      </div>
    </div>
  )
}
