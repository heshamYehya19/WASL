#!/usr/bin/env node
// Verifies that this repository is safe to hand over: it is its own repository, it has no remote, and nothing that must not be
// shared (real .env files, keys, databases, build output, node_modules) is tracked or about to be committed.
//
//   node scripts/verify-repo-safety.mjs                  # check the repository in the current directory
//   node scripts/verify-repo-safety.mjs --original ../WSL --expect-head 199b492
//                                                         # also confirm the original repository was left alone
//
// Exit code 0 = every check passed. It never changes anything.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

const SECRET_PATTERNS = [
  ["Groq/OpenAI-style key", /\b(?:gsk_|sk-(?:proj-)?)[A-Za-z0-9_-]{20,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
]
const FORBIDDEN_PATH = [
  [/(^|\/)node_modules\//, "node_modules"],
  [/(^|\/)dist\//, "build output (dist/)"],
  [/(^|\/)\.env($|\.(?!example$))/, "a real .env file"],
  [/(^|\/)data\//, "a data/ directory"],
  [/\.(db|sqlite|sqlite3)(-wal|-shm)?$/, "a database file"],
  [/\.(pem|key|p12|pfx)$/, "a certificate or key file"],
  [/\.pre-wasl\.bak$/, "a database backup"],
  [/(^|\/)\.claude\//, "local assistant settings"],
]
const REQUIRED_IGNORES = ["node_modules", "dist", ".env", "data/", "*.db"]
const TEXT_LIMIT = 2_000_000

/** @returns {{ name: string, ok: boolean, detail: string }[]} */
export function checkRepo(dir, options = {}) {
  const results = []
  const add = (name, ok, detail = "") => results.push({ name, ok, detail })
  const root = resolve(dir)

  let top = ""
  try {
    top = resolve(git(root, "rev-parse", "--show-toplevel"))
  } catch {
    add("is a git repository", false, `${root} is not inside a git repository`)
    return results
  }
  add("is its own repository (not nested in another one)", top.toLowerCase() === root.toLowerCase(), `top level is ${top}`)

  const remotes = git(root, "remote", "-v")
  add("has no remote configured", remotes === "", remotes ? `remotes: ${remotes.replace(/\s+/g, " ")}` : "")

  // Everything git knows about, plus everything that would be added by `git add .`.
  const listed = (args) => git(root, ...args).split("\n").filter(Boolean)
  const files = [...new Set([...listed(["ls-files"]), ...listed(["ls-files", "--others", "--exclude-standard"])])]

  const forbidden = []
  for (const f of files) for (const [pattern, label] of FORBIDDEN_PATH) if (pattern.test(f)) forbidden.push(`${f} (${label})`)
  add("no forbidden files are tracked or unignored", forbidden.length === 0, forbidden.slice(0, 8).join("; "))

  const leaks = []
  for (const f of files) {
    const full = join(root, f)
    let text
    try {
      if (!existsSync(full) || statSync(full).size > TEXT_LIMIT) continue
      text = readFileSync(full, "utf8")
    } catch {
      continue
    }
    if (text.includes("\u0000")) continue
    for (const [label, pattern] of SECRET_PATTERNS) {
      // Test files and docs deliberately contain fake keys for redaction tests; those are not real credentials.
      if (pattern.test(text) && !/(^|\/)server\/test\//.test(f) && !/(^|\/)scripts\/verify-repo-safety/.test(f)) leaks.push(`${f} (${label})`)
    }
  }
  add("no credentials in files that would be committed", leaks.length === 0, leaks.slice(0, 8).join("; "))

  const ignore = existsSync(join(root, ".gitignore")) ? readFileSync(join(root, ".gitignore"), "utf8") : ""
  const missing = REQUIRED_IGNORES.filter((p) => !ignore.split("\n").some((line) => line.trim() === p || line.trim() === `/${p}`))
  add(".gitignore covers node_modules, build output, .env, data and databases", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "")

  const example = join(root, ".env.example")
  if (!existsSync(example)) add(".env.example exists", false, "missing")
  else {
    const values = readFileSync(example, "utf8")
      .split("\n")
      .filter((l) => /^[A-Z_]+=./.test(l) && !l.startsWith("#"))
    const real = values.filter((l) => SECRET_PATTERNS.some(([, p]) => p.test(l)))
    add(".env.example exists and holds no real values", real.length === 0, real.map((l) => l.split("=")[0]).join(", "))
  }

  if (existsSync(join(root, "package.json"))) {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    add("package name is its own", pkg.name === "wasl", `name is "${pkg.name}"`)
  }

  if (options.original) {
    const orig = resolve(options.original)
    try {
      add("original repository is a different repository", orig.toLowerCase() !== root.toLowerCase(), orig)
      if (options.expectHead) {
        const head = git(orig, "rev-parse", "--short", "HEAD")
        add("original repository HEAD is unchanged", head.startsWith(options.expectHead) || options.expectHead.startsWith(head), `HEAD is ${head}, expected ${options.expectHead}`)
      }
      const originalRemote = git(orig, "remote", "-v")
      add("original repository still has its remote", originalRemote !== "" || options.allowNoOriginalRemote === true, originalRemote ? "" : "no remote found")
    } catch (err) {
      add("original repository can be inspected", false, err instanceof Error ? err.message : String(err))
    }
  }
  return results
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
  const results = checkRepo(process.cwd(), { original: value("--original"), expectHead: value("--expect-head") })
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`)
  const failed = results.filter((r) => !r.ok)
  console.log(failed.length === 0 ? `\nAll ${results.length} checks passed.` : `\n${failed.length} of ${results.length} checks failed.`)
  process.exit(failed.length === 0 ? 0 : 1)
}
