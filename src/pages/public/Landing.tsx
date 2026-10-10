import { Link } from "react-router-dom"
import { Reveal } from "../../components/ui/Reveal"

const LOOP = [
  { n: 1, title: "Challenge", text: "A company's real problem — or a practice challenge you design for yourself — becomes a phased piece of work." },
  { n: 2, title: "Submit evidence", text: "Paste your code or link a public GitHub repository. Each phase is submitted on its own." },
  { n: 3, title: "Demonstrate understanding", text: "The Proof Engine reviews the work, then interviews you about it. Passing needs both." },
  { n: 4, title: "Improve", text: "Every gap becomes a plan: verified resources, a short AI lesson, and an exercise to try." },
  { n: 5, title: "Build a stronger profile", text: "Skills you have demonstrated sit apart from skills you only declared — and you choose who sees what." },
  { n: 6, title: "Connect with employers", text: "Companies search by evidence, see why a candidate matches, and express interest directly." },
]

const MODULES = [
  {
    title: "Company Challenges",
    audience: "For companies",
    text: "Describe a problem in five fields. Qudra drafts a multi-phase challenge with acceptance criteria and rubrics; you review, edit and publish it.",
    to: "/for-companies",
  },
  {
    title: "Student Practice Lab",
    audience: "For students & graduates",
    text: "Pick skills and a difficulty and get a private, phased challenge to practise on — assessed by the same engine, shared with nobody unless you choose.",
    to: "/for-students",
  },
  {
    title: "Talent Discovery",
    audience: "For companies",
    text: "Search candidates by demonstrated skills. Every match shows its evidence, and declared skills are never dressed up as proven ones.",
    to: "/for-companies",
  },
]

const HONEST = [
  ["Code is read, not run.", "The platform never executes submitted code. It runs static checks and an AI review, and says so on every result."],
  ["Three separate judgements.", "Correctness, code quality and demonstrated understanding are rated separately, each with cited evidence — never blended into one score."],
  ["No decision without the interview.", "A phase can only pass or fail after you have been interviewed about your own work. If the AI is unavailable, the phase says so — it never guesses."],
  ["We don't claim to prove authorship.", "The interview raises confidence that you understand your work. It is evidence, not a lie detector."],
  ["You control what employers see.", "Practice work is private by default. Companies see only what you choose to share, and only skills that were actually assessed."],
]

export default function Landing() {
  return (
    <div>
      <section className="relative overflow-hidden border-b border-ink-100 bg-night">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
        <div className="pointer-events-none absolute -top-40 right-0 h-96 w-96 rounded-full bg-teal-500/10 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-3xl">
            <div className="mb-4 flex items-center gap-3">
              <span className="text-3xl font-extrabold tracking-tight text-white">Qudra</span>
              <span lang="ar" className="font-arabic text-3xl font-bold text-teal-300">قدرة</span>
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-balance text-white sm:text-6xl">
              Where Ability <span className="text-teal-300">Meets Opportunity.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-300">
              Students and graduates prove what they can do on real challenges. An AI Proof Engine inspects the work and interviews the person behind it. Companies find talent
              through evidence — directly, with nobody in between.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link to="/login" className="rounded-full bg-teal-500 px-6 py-3 text-sm font-semibold text-ink-950 transition-all duration-200 hover:-translate-y-0.5 hover:bg-teal-400 hover:shadow-lg hover:shadow-teal-500/25">
                Try the demo
              </Link>
              <Link to="/how-it-works" className="rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-300 hover:text-teal-300">
                See how it works
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6" aria-labelledby="loop-title">
        <Reveal>
          <h2 id="loop-title" className="text-2xl font-bold tracking-tight text-ink-950 sm:text-3xl">One loop, from challenge to connection</h2>
          <p className="mt-2 max-w-2xl text-ink-600">Every step leaves evidence behind, and every step can be repeated until you are ready.</p>
        </Reveal>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LOOP.map((s, i) => (
            <Reveal key={s.n} delay={i * 60}>
              <li className="h-full rounded-2xl border border-ink-200 bg-surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-400">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-night text-sm font-bold text-teal-300">{s.n}</span>
                <h3 className="mt-3 font-semibold text-ink-900">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{s.text}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </section>

      <section className="border-y border-ink-100 bg-surface/60" aria-labelledby="modules-title">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h2 id="modules-title" className="text-2xl font-bold tracking-tight text-ink-950 sm:text-3xl">Three modules, one engine</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {MODULES.map((m) => (
              <Link key={m.title} to={m.to} className="group rounded-2xl border border-ink-200 bg-surface p-6 transition-all duration-200 hover:-translate-y-1 hover:border-teal-400 hover:shadow-lg hover:shadow-teal-500/5">
                <div className="text-xs font-semibold tracking-wide text-teal-700 uppercase">{m.audience}</div>
                <h3 className="mt-1 text-lg font-bold text-ink-950">{m.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{m.text}</p>
                <span className="mt-4 inline-block text-sm font-semibold text-teal-700 transition-transform group-hover:translate-x-1">Learn more →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6" aria-labelledby="honest-title">
        <h2 id="honest-title" className="text-2xl font-bold tracking-tight text-ink-950 sm:text-3xl">Honest by design</h2>
        <p className="mt-2 max-w-2xl text-ink-600">A tool that decides things about people has to be clear about what it is and isn't.</p>
        <dl className="mt-8 grid gap-4 md:grid-cols-2">
          {HONEST.map(([term, text]) => (
            <div key={term} className="rounded-2xl border border-ink-200 bg-surface p-5">
              <dt className="font-semibold text-ink-900">{term}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-ink-600">{text}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-10 rounded-3xl bg-night p-8 text-center">
          <h2 className="text-2xl font-bold text-white">See it from both sides</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-white/70">The demo lets you switch between a candidate and a company in one click — no sign-up needed.</p>
          <Link to="/login" className="mt-5 inline-block rounded-full bg-teal-500 px-6 py-3 text-sm font-semibold text-ink-950 transition-all hover:-translate-y-0.5 hover:bg-teal-400">
            Choose an account
          </Link>
        </div>
      </section>
    </div>
  )
}
