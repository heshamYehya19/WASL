import { PageHeader } from "../../components/ui/PageHeader"

export default function About() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <PageHeader eyebrow="About" title="WASL | وصل" subtitle="Where Ability Meets Opportunity." />
      <div className="space-y-5 leading-relaxed text-ink-700">
        <p>
          <em lang="ar">وصل</em> means “connection”. WASL exists to connect two people who usually struggle to find each other: someone who can do the work but has little to show
          for it, and a company that needs the work done but can't tell who can do it.
        </p>
        <p>
          It does that without intermediaries. Companies publish challenges; students and graduates take them on — or practise on their own; an AI Proof Engine reviews what they
          submit and interviews them about it; employers search by what was actually demonstrated.
        </p>
        <h2 className="pt-2 text-lg font-bold text-ink-950">What WASL is not</h2>
        <ul className="list-disc space-y-1.5 pl-6">
          <li>It is not a degree verifier and has no role for universities.</li>
          <li>It does not run submitted code, and does not claim to prove who wrote it.</li>
          <li>It does not turn people into one score. Three judgements are kept apart, and failed attempts are not held against anyone.</li>
          <li>It does not show fake activity: counts you see are counts of real records, and sample data is labelled.</li>
        </ul>
        <h2 className="pt-2 text-lg font-bold text-ink-950">This demo</h2>
        <p>
          This is a working prototype. Sign-in is an account switcher for exploring both sides — not authentication. Review, interview and assessment need an AI provider configured on
          the server; without one they say so rather than pretending.
        </p>
      </div>
    </div>
  )
}
