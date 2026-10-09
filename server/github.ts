// Reads a public GitHub repository so its work can be reviewed, not just linked: the README plus the most relevant source and
// test files, each kept as its own file. Nothing is cloned or executed — the files are fetched as text from GitHub's own API
// and raw-content hosts, and only those two hosts are ever contacted (the owner/repo come from a strictly parsed link).
//
// Uses the public GitHub API without a token. Set GITHUB_TOKEN on the server for a higher rate limit; it is only ever sent
// to api.github.com.

/** Swappable for tests, so they never reach the network. */
export const githubDeps = {
  fetch: (input: string, init?: RequestInit): Promise<Response> => fetch(input, init),
}

const TIMEOUT_MS = 8_000
const MAX_SOURCE_FILES = 8
const MAX_FILE_BYTES = 120_000
export const MAX_CHARS_PER_FILE = 8_000
export const MAX_TOTAL_REPO_CHARS = 36_000
const API_HOST = "https://api.github.com"
const RAW_HOST = "https://raw.githubusercontent.com"

const SOURCE_EXTENSIONS = new Set([
  "py", "ipynb", "js", "jsx", "mjs", "ts", "tsx", "java", "kt", "go", "rs", "cs", "cpp", "cc", "c", "h", "rb", "php",
  "swift", "dart", "sql", "sh", "r", "scala", "vue", "svelte", "html", "css",
])
const SKIP_PATH = /(^|\/)(node_modules|dist|build|vendor|\.git|\.github|__pycache__|venv|\.venv|target|out|coverage|migrations\/versions)\//i
const SKIP_FILE = /(\.min\.(js|css)$|\.lock$|package-lock\.json$|\.d\.ts$|setup\.py$|conftest\.py$|__init__\.py$)/i

export interface RepoRef {
  owner: string
  repo: string
  ref?: string
  path?: string
}

/** Parses a GitHub repository link. Anything that is not exactly github.com/owner/repo[/tree|blob/ref[/path]] is rejected. */
export function parseGithubLink(link: string): RepoRef | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/?#]+)(?:\/([^?#]*))?)?\/?(?:[?#].*)?$/i.exec(link.trim())
  if (!m) return null
  if (m[1] === "." || m[1] === ".." || m[2] === "." || m[2] === "..") return null
  let path: string | undefined
  if (m[4]) {
    try {
      path = decodeURIComponent(m[4])
    } catch {
      return null
    }
  }
  return { owner: m[1], repo: m[2], ...(m[3] ? { ref: m[3] } : {}), ...(path ? { path } : {}) }
}

export interface RepoFile {
  path: string
  content: string
  size: number
  truncated: boolean
}

export type RepoFailure = "not_github" | "not_found" | "rate_limited" | "empty" | "network"

export type RepoRead = { ok: true; owner: string; repo: string; ref: string; files: RepoFile[] } | { ok: false; reason: RepoFailure; message: string }

export const REPO_FAILURE_MESSAGES: Record<RepoFailure, string> = {
  not_github: "That doesn't look like a GitHub repository link. Use a link such as https://github.com/owner/repository.",
  not_found: "We couldn't find a public repository at that link. Check the address, and make sure the repository is public.",
  rate_limited: "GitHub is limiting requests from this server right now. Try again in a few minutes, or paste your code instead.",
  empty: "We found the repository but couldn't read any source files from it. Make sure it contains code, or paste your code instead.",
  network: "We couldn't reach GitHub just now. Try again, or paste your code instead.",
}

class HttpFailure extends Error {
  status: number
  rateLimited: boolean
  constructor(status: number, rateLimited: boolean) {
    super(`GitHub returned HTTP ${status}`)
    this.status = status
    this.rateLimited = rateLimited
  }
}

async function getJson<T>(url: string): Promise<T> {
  const token = process.env.GITHUB_TOKEN?.trim()
  const res = await githubDeps.fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "wasl-evidence-reader", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new HttpFailure(res.status, res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0"))
  return (await res.json()) as T
}

async function getRaw(owner: string, repo: string, ref: string, path: string): Promise<string> {
  const url = `${RAW_HOST}/${owner}/${repo}/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`
  const res = await githubDeps.fetch(url, { headers: { "User-Agent": "wasl-evidence-reader" }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new HttpFailure(res.status, false)
  return res.text()
}

/** A notebook's code and markdown cells, without outputs or metadata. */
function notebookText(raw: string): string {
  try {
    const nb = JSON.parse(raw) as { cells?: { cell_type?: string; source?: string | string[] }[] }
    return (nb.cells ?? [])
      .filter((c) => c.cell_type === "code" || c.cell_type === "markdown")
      .map((c) => (Array.isArray(c.source) ? c.source.join("") : (c.source ?? "")))
      .join("\n\n")
  } catch {
    return ""
  }
}

const extension = (path: string) => path.split(".").pop()?.toLowerCase() ?? ""
export const isTestPath = (path: string) => /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.|(^|\/)test_[^/]*\.py$|_test\.(py|go)$/i.test(path)

/** Ranks likely "main" source files first: shallow, in src/ or the root, with telling names. Tests are kept but ranked after. */
function rankSource(path: string, size: number): number {
  const depth = path.split("/").length - 1
  const name = path.split("/").pop()!.toLowerCase()
  let score = 10 - Math.min(depth, 5) * 1.5
  if (/^(src|app|lib|server|notebooks?|backend|api)\//i.test(path)) score += 3
  if (/^(main|app|index|server|model|train|detect\w*|pipeline|features?|analysis|api)\./.test(name)) score += 3
  if (isTestPath(path)) score -= 2
  if (/^(config|settings|constants)\./.test(name)) score -= 3
  if (/\.(css|html)$/.test(name)) score -= 4
  score += Math.min(size, 20_000) / 10_000
  return score
}

/** Fetches the README and the most relevant source and test files from a GitHub link. */
export async function readGithubRepo(link: string): Promise<RepoRead> {
  const parsed = parseGithubLink(link)
  if (!parsed) return { ok: false, reason: "not_github", message: REPO_FAILURE_MESSAGES.not_github }
  const api = `${API_HOST}/repos/${parsed.owner}/${parsed.repo}`
  try {
    const ref = parsed.ref ?? (await getJson<{ default_branch: string }>(api)).default_branch
    const tree = await getJson<{ tree: { path: string; type: string; size?: number }[] }>(`${api}/git/trees/${encodeURIComponent(ref)}?recursive=1`)
    const blobs = tree.tree.filter((t) => t.type === "blob")

    const picks: string[] = []
    if (parsed.path && blobs.some((b) => b.path === parsed.path)) picks.push(parsed.path)
    const readme = blobs.find((b) => /^readme(\.(md|rst|txt))?$/i.test(b.path))
    if (readme && !picks.includes(readme.path)) picks.push(readme.path)
    const scope = parsed.path && !blobs.some((b) => b.path === parsed.path) ? `${parsed.path.replace(/\/$/, "")}/` : ""
    const sources = blobs
      .filter((b) => (!scope || b.path.startsWith(scope)) && SOURCE_EXTENSIONS.has(extension(b.path)))
      .filter((b) => !SKIP_PATH.test(b.path) && !SKIP_FILE.test(b.path) && (b.size ?? 0) > 0 && (b.size ?? 0) <= MAX_FILE_BYTES)
      .filter((b) => !picks.includes(b.path))
      .sort((a, b) => rankSource(b.path, b.size ?? 0) - rankSource(a.path, a.size ?? 0))
      .slice(0, MAX_SOURCE_FILES)
    picks.push(...sources.map((b) => b.path))

    const files: RepoFile[] = []
    let total = 0
    for (const path of picks) {
      if (total >= MAX_TOTAL_REPO_CHARS) break
      let body: string
      try {
        body = await getRaw(parsed.owner, parsed.repo, ref, path)
      } catch {
        continue
      }
      if (extension(path) === "ipynb") body = notebookText(body)
      body = body.replace(/\r\n/g, "\n").trim()
      if (!body) continue
      const room = Math.min(MAX_CHARS_PER_FILE, MAX_TOTAL_REPO_CHARS - total)
      const truncated = body.length > room
      files.push({ path, content: truncated ? body.slice(0, room) : body, size: body.length, truncated })
      total += Math.min(body.length, room)
    }
    if (files.length === 0) return { ok: false, reason: "empty", message: REPO_FAILURE_MESSAGES.empty }
    return { ok: true, owner: parsed.owner, repo: parsed.repo, ref, files }
  } catch (err) {
    if (err instanceof HttpFailure) {
      if (err.rateLimited) return { ok: false, reason: "rate_limited", message: REPO_FAILURE_MESSAGES.rate_limited }
      if (err.status === 404 || err.status === 403 || err.status === 451) return { ok: false, reason: "not_found", message: REPO_FAILURE_MESSAGES.not_found }
    }
    return { ok: false, reason: "network", message: REPO_FAILURE_MESSAGES.network }
  }
}
