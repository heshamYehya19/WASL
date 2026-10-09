// Secret detection and redaction. Anything that looks like a credential is replaced before the text is stored, shown to a
// reviewer, or sent to a model — the original value is never kept.

const RULES: { kind: string; pattern: RegExp }[] = [
  { kind: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { kind: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { kind: "Groq/OpenAI-style key", pattern: /\b(?:gsk_|sk-(?:proj-)?)[A-Za-z0-9_-]{20,}\b/g },
  { kind: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "JSON web token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
  // name = "value": a secret-looking name assigned a literal that is not obviously a placeholder
  {
    kind: "hard-coded credential",
    pattern: /\b((?:[A-Za-z0-9_]*?)(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)[A-Za-z0-9_]*)\s*[:=]\s*(["'])(?!\s*\2)(?!.*(?:your|example|changeme|placeholder|xxx|\*{3}|<|\$\{|process\.env|os\.environ|getenv))([^"'\n]{6,})\2/gi,
  },
]

export interface Redaction {
  text: string
  /** Number of values replaced. */
  count: number
  /** The kinds found (never the values). */
  kinds: string[]
}

export function redactSecrets(text: string): Redaction {
  let count = 0
  const kinds = new Set<string>()
  let out = text
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (_match, ...groups) => {
      count++
      kinds.add(rule.kind)
      // Keep the variable name for credential assignments so the reviewer still sees what was assigned.
      if (rule.kind === "hard-coded credential") return `${String(groups[0])} = "[REDACTED]"`
      return `[REDACTED ${rule.kind}]`
    })
  }
  return { text: out, count, kinds: [...kinds] }
}
