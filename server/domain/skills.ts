// One canonical casing for a skill name, used everywhere a skill is stored or compared, so "python" and "Python" are
// never two separate skills across a profile, a challenge, an evidence record and Talent Discovery search.

// Display casing for the known vocabulary, keyed by lowercase. Anything outside the list falls back to a generic
// capitalization in canonicalSkillName rather than silently staying however it was typed.
const SKILL_DISPLAY_NAMES: Record<string, string> = {
  python: "Python",
  java: "Java",
  sql: "SQL",
  javascript: "JavaScript",
  typescript: "TypeScript",
  react: "React",
  "node.js": "Node.js",
  nodejs: "Node.js",
  "web development": "Web Development",
  "frontend development": "Frontend Development",
  "backend development": "Backend Development",
  "mobile development": "Mobile Development",
  "machine learning": "Machine Learning",
  "natural language processing": "Natural Language Processing",
  nlp: "NLP",
  "data analysis": "Data Analysis",
  "data visualization": "Data Visualization",
  "data engineering": "Data Engineering",
  "power bi": "Power BI",
  "time-series forecasting": "Time-Series Forecasting",
  "network security": "Network Security",
  linux: "Linux",
  "risk assessment": "Risk Assessment",
  "technical writing": "Technical Writing",
  "rest api design": "REST API Design",
  "rest api": "REST API Design",
  "api design": "API Design",
  "software testing": "Software Testing",
  "security awareness": "Security Awareness",
  "access control": "Access Control",
  "business analysis": "Business Analysis",
  "process modeling": "Process Modeling",
  "ui/ux design": "UI/UX Design",
  go: "Go",
  golang: "Go",
  rust: "Rust",
  kotlin: "Kotlin",
  swift: "Swift",
  php: "PHP",
  html: "HTML",
  css: "CSS",
  git: "Git",
  docker: "Docker",
  kubernetes: "Kubernetes",
  aws: "AWS",
  azure: "Azure",
  gcp: "GCP",
  "ci/cd": "CI/CD",
  graphql: "GraphQL",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  sqlite: "SQLite",
  redis: "Redis",
  "c++": "C++",
  "c#": "C#",
  c: "C",
  ".net": ".NET",
  "deep learning": "Deep Learning",
  "data structures": "Data Structures",
  algorithms: "Algorithms",
  "system design": "System Design",
  "database design": "Database Design",
  "cloud computing": "Cloud Computing",
  cybersecurity: "Cybersecurity",
  devops: "DevOps",
  "unit testing": "Unit Testing",
  "code review": "Code Review",
}

export function canonicalSkillName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ")
  if (!trimmed) return trimmed
  const known = SKILL_DISPLAY_NAMES[trimmed.toLowerCase()]
  if (known) return known
  return trimmed
    .split(" ")
    .map((word) => (word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ")
}

/** Canonicalizes a list, dropping empties and duplicates (case-insensitively), preserving first-seen order. */
export function canonicalSkillList(raw: unknown, max = 12): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\n;]/) : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of list) {
    const name = canonicalSkillName(String(item ?? "")).slice(0, 60)
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length >= max) break
  }
  return out
}
