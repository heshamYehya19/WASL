// Grounding: a model's claim about a submission only counts if it can be found in the submission. These helpers check quotes,
// file paths and identifiers against the exact text the model was shown (the stored, redacted artifacts).

export interface Artifact {
  path: string
  content: string
}

export const normalize = (s: string) => s.replace(/\s+/g, " ").trim()

export interface QuoteMatch {
  path: string
  /** 1-based line of the first line of the quote, when it can be located. */
  line: number | null
  text: string
}

const MIN_QUOTE = 6

/** Finds `quote` (whitespace-insensitive) in one of the artifacts. Null when it is not there or is too short to mean anything. */
export function verifyQuote(quote: string, artifacts: Artifact[]): QuoteMatch | null {
  const q = normalize(quote)
  if (q.length < MIN_QUOTE) return null
  for (const a of artifacts) {
    if (!normalize(a.content).includes(q)) continue
    const firstLine = normalize(quote.split("\n").find((l) => normalize(l).length >= 3) ?? q)
    const lines = a.content.split("\n")
    const idx = lines.findIndex((l) => normalize(l).includes(firstLine))
    return { path: a.path, line: idx >= 0 ? idx + 1 : null, text: q.length > 240 ? `${q.slice(0, 239)}…` : q }
  }
  return null
}

/** Finds `quote` in free text (an interview answer). */
export function quoteInText(quote: string, text: string): boolean {
  const q = normalize(quote)
  return q.length >= MIN_QUOTE && normalize(text).includes(q)
}

/** Identifiers and paths a question or note refers to in backticks, e.g. `parse_rows()` or `src/app.py`. */
export function backtickTokens(text: string): string[] {
  return [...text.matchAll(/`([^`\n]{2,80})`/g)].map((m) => m[1].trim()).filter(Boolean)
}

/** Whether a token (identifier, call, or path) appears in the submission — in its content or as a file path. */
export function tokenInArtifacts(token: string, artifacts: Artifact[]): boolean {
  const bare = token.replace(/\(.*\)$/, "").trim()
  if (!bare) return true
  return artifacts.some((a) => a.path.includes(bare) || a.content.includes(bare))
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "for", "with", "is", "are", "that", "this", "it", "as", "on", "be", "by", "at", "from", "your", "you", "should", "must", "can", "will"])

const words = (s: string) =>
  normalize(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))

/** Jaccard similarity of two texts' word sets — a cheap "is this the same question again" test. */
export function similarity(a: string, b: string): number {
  const A = new Set(words(a))
  const B = new Set(words(b))
  if (A.size === 0 || B.size === 0) return 0
  let shared = 0
  for (const w of A) if (B.has(w)) shared++
  return shared / (A.size + B.size - shared)
}

/** Share of `text`'s six-word runs that also occur in `source` — high when the text is mostly a copy of it. */
export function copiedShare(text: string, source: string): number {
  const t = words(text)
  if (t.length < 12) return 0
  const s = words(source)
  const grams = new Set<string>()
  for (let i = 0; i + 6 <= s.length; i++) grams.add(s.slice(i, i + 6).join(" "))
  let total = 0
  let hit = 0
  for (let i = 0; i + 6 <= t.length; i++) {
    total++
    if (grams.has(t.slice(i, i + 6).join(" "))) hit++
  }
  return total === 0 ? 0 : hit / total
}
