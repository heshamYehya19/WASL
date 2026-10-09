// A small, curated catalog of well-known learning resources. Titles, providers and URLs here are written by hand and point at
// the publishers' own pages; nothing is generated. Each link is also checked at runtime (see services/learning.ts) before it is
// shown as verified, and a skill with no catalog match gets a clearly labelled search link instead of an invented course.

export type ResourceKind = "docs" | "tutorial" | "interactive" | "book" | "course"

export interface CatalogEntry {
  id: string
  title: string
  provider: string
  url: string
  kind: ResourceKind
  level: "beginner" | "intermediate" | "advanced" | "all"
  /** Canonical skill names (lowercase) and keywords this resource helps with. */
  topics: string[]
  summary: string
}

export const CATALOG: CatalogEntry[] = [
  { id: "py-tutorial", title: "The Python Tutorial", provider: "Python Software Foundation", url: "https://docs.python.org/3/tutorial/", kind: "tutorial", level: "beginner", topics: ["python"], summary: "The official walk-through of the language: data structures, functions, modules, errors and classes." },
  { id: "py-howto", title: "Python HOWTOs", provider: "Python Software Foundation", url: "https://docs.python.org/3/howto/index.html", kind: "docs", level: "intermediate", topics: ["python", "regular expressions", "logging", "sorting"], summary: "In-depth guides on single topics such as logging, sorting, functional programming and argparse." },
  { id: "mdn-js", title: "JavaScript — Learn web development", provider: "MDN Web Docs", url: "https://developer.mozilla.org/en-US/docs/Learn/JavaScript", kind: "tutorial", level: "beginner", topics: ["javascript", "web development", "frontend development"], summary: "Structured lessons from first steps to objects, asynchronous code and client-side APIs." },
  { id: "mdn-html", title: "Structuring content with HTML", provider: "MDN Web Docs", url: "https://developer.mozilla.org/en-US/docs/Learn/HTML", kind: "tutorial", level: "beginner", topics: ["html", "web development", "frontend development", "accessibility"], summary: "Semantic HTML, forms, tables and accessibility basics." },
  { id: "mdn-css", title: "CSS — Learn web development", provider: "MDN Web Docs", url: "https://developer.mozilla.org/en-US/docs/Learn/CSS", kind: "tutorial", level: "beginner", topics: ["css", "web development", "frontend development", "ui/ux design"], summary: "Styling, layout, responsive design and modern CSS." },
  { id: "ts-handbook", title: "The TypeScript Handbook", provider: "Microsoft", url: "https://www.typescriptlang.org/docs/handbook/intro.html", kind: "docs", level: "beginner", topics: ["typescript"], summary: "The official guide to types, interfaces, generics and the type system." },
  { id: "react-learn", title: "Learn React", provider: "React", url: "https://react.dev/learn", kind: "tutorial", level: "beginner", topics: ["react", "frontend development", "web development"], summary: "The official guide to components, state, effects and thinking in React." },
  { id: "node-learn", title: "Learn Node.js", provider: "OpenJS Foundation", url: "https://nodejs.org/en/learn/getting-started/introduction-to-nodejs", kind: "tutorial", level: "beginner", topics: ["node.js", "backend development", "javascript"], summary: "Getting started with Node.js, its runtime model and core modules." },
  { id: "sqlbolt", title: "SQLBolt — Learn SQL with simple, interactive exercises", provider: "SQLBolt", url: "https://sqlbolt.com/", kind: "interactive", level: "beginner", topics: ["sql", "database design", "data analysis"], summary: "Short interactive lessons covering queries, joins, aggregates and schema changes." },
  { id: "pg-tutorial", title: "PostgreSQL Tutorial", provider: "The PostgreSQL Global Development Group", url: "https://www.postgresql.org/docs/current/tutorial.html", kind: "docs", level: "intermediate", topics: ["sql", "postgresql", "database design"], summary: "The official tutorial: tables, queries, joins, views, transactions and inheritance." },
  { id: "git-book", title: "Pro Git", provider: "Scott Chacon and Ben Straub (git-scm.com)", url: "https://git-scm.com/book/en/v2", kind: "book", level: "beginner", topics: ["git", "version control"], summary: "The free, complete book on Git: branching, collaboration and internals." },
  { id: "java-learn", title: "Learn Java", provider: "Oracle (dev.java)", url: "https://dev.java/learn/", kind: "tutorial", level: "beginner", topics: ["java", "object-oriented programming"], summary: "Official lessons on the language, the standard library and tooling." },
  { id: "go-tour", title: "A Tour of Go", provider: "The Go Authors", url: "https://go.dev/tour/", kind: "interactive", level: "beginner", topics: ["go", "concurrency"], summary: "An interactive introduction to Go's syntax, types, methods, interfaces and concurrency." },
  { id: "rust-book", title: "The Rust Programming Language", provider: "The Rust Project", url: "https://doc.rust-lang.org/book/", kind: "book", level: "beginner", topics: ["rust", "memory management"], summary: "The official book: ownership, borrowing, error handling and concurrency." },
  { id: "csharp-tour", title: "A tour of C#", provider: "Microsoft Learn", url: "https://learn.microsoft.com/en-us/dotnet/csharp/tour-of-csharp/", kind: "tutorial", level: "beginner", topics: ["c#", ".net"], summary: "An overview of the language's features with runnable examples." },
  { id: "learncpp", title: "Learn C++", provider: "LearnCpp.com", url: "https://www.learncpp.com/", kind: "tutorial", level: "beginner", topics: ["c++", "c", "memory management", "object-oriented programming"], summary: "A thorough free tutorial from first program to advanced topics." },
  { id: "ml-crash", title: "Machine Learning Crash Course", provider: "Google for Developers", url: "https://developers.google.com/machine-learning/crash-course", kind: "course", level: "beginner", topics: ["machine learning", "deep learning", "data analysis"], summary: "Fundamentals of ML with practical exercises, from regression to neural networks." },
  { id: "sklearn-guide", title: "scikit-learn User Guide", provider: "scikit-learn", url: "https://scikit-learn.org/stable/user_guide.html", kind: "docs", level: "intermediate", topics: ["machine learning", "python", "data analysis", "classification"], summary: "Reference and explanations for classification, regression, clustering and model evaluation." },
  { id: "pandas-intro", title: "Getting started tutorials", provider: "pandas", url: "https://pandas.pydata.org/docs/getting_started/intro_tutorials/index.html", kind: "tutorial", level: "beginner", topics: ["data analysis", "python", "pandas"], summary: "Short tutorials on loading, selecting, cleaning and summarising tabular data." },
  { id: "mpl-tutorials", title: "Matplotlib tutorials", provider: "Matplotlib", url: "https://matplotlib.org/stable/tutorials/index.html", kind: "tutorial", level: "beginner", topics: ["data visualization", "python"], summary: "Learn to build clear plots and customise them." },
  { id: "hf-nlp", title: "NLP Course", provider: "Hugging Face", url: "https://huggingface.co/learn/nlp-course", kind: "course", level: "intermediate", topics: ["natural language processing", "nlp", "machine learning", "deep learning"], summary: "A free course on transformers and modern NLP with hands-on notebooks." },
  { id: "d2l", title: "Dive into Deep Learning", provider: "d2l.ai", url: "https://d2l.ai/", kind: "book", level: "intermediate", topics: ["deep learning", "machine learning"], summary: "An interactive book that combines explanation, maths and runnable code." },
  { id: "docker-start", title: "Get started with Docker", provider: "Docker", url: "https://docs.docker.com/get-started/", kind: "tutorial", level: "beginner", topics: ["docker", "devops", "containers"], summary: "Build, run and share containers; the concepts behind images and volumes." },
  { id: "k8s-basics", title: "Learn Kubernetes Basics", provider: "The Kubernetes Authors", url: "https://kubernetes.io/docs/tutorials/kubernetes-basics/", kind: "interactive", level: "intermediate", topics: ["kubernetes", "devops", "containers"], summary: "Deploy, scale, update and debug a containerised app." },
  { id: "linux-journey", title: "Linux Journey", provider: "Linux Journey", url: "https://linuxjourney.com/", kind: "tutorial", level: "beginner", topics: ["linux", "shell", "devops"], summary: "Beginner-friendly lessons on the command line, files, permissions and processes." },
  { id: "ms-api-design", title: "Web API design best practices", provider: "Microsoft Azure Architecture Center", url: "https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design", kind: "docs", level: "intermediate", topics: ["rest api design", "api design", "backend development"], summary: "Guidance on resources, HTTP methods, status codes, versioning and error handling." },
  { id: "pytest-start", title: "Get Started with pytest", provider: "pytest", url: "https://docs.pytest.org/en/stable/getting-started.html", kind: "docs", level: "beginner", topics: ["software testing", "unit testing", "python", "testing"], summary: "Write and run your first tests, with fixtures and assertions." },
  { id: "jest-start", title: "Getting Started with Jest", provider: "Jest", url: "https://jestjs.io/docs/getting-started", kind: "docs", level: "beginner", topics: ["software testing", "unit testing", "javascript", "typescript", "testing"], summary: "Set up Jest, write assertions and run tests for JavaScript projects." },
  { id: "vitest-guide", title: "Getting Started with Vitest", provider: "Vitest", url: "https://vitest.dev/guide/", kind: "docs", level: "beginner", topics: ["software testing", "unit testing", "typescript", "javascript", "testing"], summary: "A fast test runner for TypeScript and JavaScript projects." },
  { id: "owasp-top10", title: "OWASP Top Ten", provider: "OWASP Foundation", url: "https://owasp.org/www-project-top-ten/", kind: "docs", level: "intermediate", topics: ["security awareness", "cybersecurity", "network security", "access control", "web security"], summary: "The most critical web application security risks, with explanations of each." },
  { id: "portswigger", title: "Web Security Academy", provider: "PortSwigger", url: "https://portswigger.net/web-security", kind: "course", level: "intermediate", topics: ["cybersecurity", "security awareness", "web security", "access control"], summary: "Free, hands-on labs on how common web vulnerabilities work and are prevented." },
  { id: "refactoring-guru", title: "Design Patterns", provider: "Refactoring.Guru", url: "https://refactoring.guru/design-patterns", kind: "tutorial", level: "intermediate", topics: ["system design", "object-oriented programming", "design patterns", "code review"], summary: "A catalogue of classic design patterns with diagrams and examples." },
  { id: "google-tech-writing", title: "Technical Writing courses", provider: "Google for Developers", url: "https://developers.google.com/tech-writing", kind: "course", level: "beginner", topics: ["technical writing", "documentation"], summary: "Two short courses on writing clear technical documentation." },
  { id: "cses-handbook", title: "Competitive Programmer's Handbook", provider: "Antti Laaksonen (CSES)", url: "https://cses.fi/book/book.pdf", kind: "book", level: "intermediate", topics: ["algorithms", "data structures", "complexity"], summary: "A compact introduction to algorithms and data structures with worked analysis." },
  { id: "visualgo", title: "VisuAlgo", provider: "VisuAlgo (National University of Singapore)", url: "https://visualgo.net/", kind: "interactive", level: "beginner", topics: ["algorithms", "data structures", "sorting"], summary: "Animated visualisations of data structures and algorithms." },
  { id: "aws-start", title: "Getting started with AWS", provider: "Amazon Web Services", url: "https://aws.amazon.com/getting-started/", kind: "tutorial", level: "beginner", topics: ["aws", "cloud computing"], summary: "Hands-on tutorials and guides for the core AWS services." },
]

export const CATALOG_HOSTS = new Set(CATALOG.map((e) => new URL(e.url).hostname))

/** The host used for the labelled search fallback. */
export const SEARCH_HOST = "duckduckgo.com"
export const searchUrl = (query: string) => `https://${SEARCH_HOST}/?q=${encodeURIComponent(query)}`

const levelRank = { beginner: 0, intermediate: 1, advanced: 2, all: 0 } as const

/** Catalog entries that fit a skill gap, best first. Matches on the canonical skill and on keywords in the gap's own words. */
export function matchCatalog(skill: string, gapText: string, difficulty: "beginner" | "intermediate" | "advanced", limit = 3): CatalogEntry[] {
  const skillKey = skill.toLowerCase()
  const text = gapText.toLowerCase()
  const scored = CATALOG.map((entry) => {
    let score = 0
    if (entry.topics.includes(skillKey)) score += 10
    for (const topic of entry.topics) if (topic !== skillKey && topic.length > 3 && new RegExp(`\\b${topic.replace(/[.+*?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) score += 4
    if (score === 0) return { entry, score: 0 }
    // Prefer resources at the learner's level; a gentler resource beats a harder one.
    const gap = levelRank[entry.level] - levelRank[difficulty]
    score -= gap > 0 ? gap * 2 : 0
    return { entry, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry)
}
