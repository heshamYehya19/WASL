import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
// @ts-expect-error -- a plain ES module script, deliberately not TypeScript
import { checkRepo } from "../../scripts/verify-repo-safety.mjs"

// The repository-safety script, run against throw-away repositories: it must pass a clean one and catch each way of leaking.

interface Result {
  name: string
  ok: boolean
  detail: string
}
const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" })
const write = (dir: string, path: string, content: string) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), content)
}
const failures = (results: Result[]) => results.filter((r) => !r.ok).map((r) => r.name)

function cleanRepo() {
  const dir = mkdtempSync(join(tmpdir(), "wasl-safety-"))
  git(dir, "init", "-q")
  write(dir, ".gitignore", "node_modules\ndist\n.env\ndata/\n*.db\n")
  write(dir, ".env.example", "GROQ_API_KEY=\nPORT=3000\n")
  write(dir, "package.json", JSON.stringify({ name: "wasl" }))
  write(dir, "src/index.ts", "export const hello = 'world'\n")
  return dir
}

describe("verify-repo-safety", () => {
  it("passes a clean, independent, remote-less repository", () => {
    expect(failures(checkRepo(cleanRepo()))).toEqual([])
  })

  it("fails a repository that has a remote", () => {
    const dir = cleanRepo()
    git(dir, "remote", "add", "origin", "https://example.com/some/repo.git")
    expect(failures(checkRepo(dir))).toEqual(["has no remote configured"])
  })

  it("fails when a real .env, a database, a key or node_modules is tracked or would be committed", () => {
    const dir = cleanRepo()
    write(dir, "server/.env", "GROQ_API_KEY=x\n")
    write(dir, "cert.pem", "-")
    write(dir, "backup.sqlite", "sqlite")
    git(dir, "add", "-f", "server/.env") // someone forced an ignored file in
    const bad = checkRepo(dir) as Result[]
    expect(failures(bad)).toContain("no forbidden files are tracked or unignored")
    const detail = bad.find((r) => r.name.startsWith("no forbidden"))?.detail ?? ""
    expect(detail).toMatch(/server\/\.env/)
    expect(detail).toMatch(/cert\.pem/)
    expect(detail).toMatch(/backup\.sqlite/)
  })

  it("ignores files that .gitignore keeps out", () => {
    const dir = cleanRepo()
    write(dir, ".env", "GROQ_API_KEY=anything\n")
    write(dir, "node_modules/x/index.js", "x")
    write(dir, "data/wasl.db", "sqlite")
    expect(failures(checkRepo(dir))).toEqual([])
  })

  it("finds a credential in a source file, and in .env.example", () => {
    const dir = cleanRepo()
    write(dir, "src/config.ts", `export const key = "${["gsk_", "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"].join("")}"\n`)
    write(dir, ".env.example", `GROQ_API_KEY=${["gsk_", "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"].join("")}\n`)
    const bad = failures(checkRepo(dir))
    expect(bad).toContain("no credentials in files that would be committed")
    expect(bad).toContain(".env.example exists and holds no real values")
  })

  it("requires the ignore rules and the example file", () => {
    const dir = cleanRepo()
    write(dir, ".gitignore", "node_modules\n")
    expect(failures(checkRepo(dir))).toEqual([".gitignore covers node_modules, build output, .env, data and databases"])
  })

  it("is not fooled by a repository nested inside another one", () => {
    const outer = cleanRepo()
    const inner = join(outer, "child")
    mkdirSync(inner)
    expect(failures(checkRepo(inner))).toContain("is its own repository (not nested in another one)")
  })

  it("can confirm that an original repository was left alone", () => {
    const original = cleanRepo()
    git(original, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init")
    const head = execFileSync("git", ["-C", original, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()
    const copy = cleanRepo()
    const ok = checkRepo(copy, { original, expectHead: head, allowNoOriginalRemote: true }) as Result[]
    expect(failures(ok)).toEqual([])
    const changed = checkRepo(copy, { original, expectHead: "deadbee", allowNoOriginalRemote: true }) as Result[]
    expect(failures(changed)).toContain("original repository HEAD is unchanged")
  })
})
