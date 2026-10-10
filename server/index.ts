import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, normalize, resolve } from "node:path"
import { AI_MOCK_BLOCKED_MESSAGE, aiMockState } from "./ai/provider.ts"
import { handleApi } from "./api.ts"
import { DB_PATH, getDb } from "./db.ts"

// Production server: serves the built app from dist/ and the WASL API from the
// same origin. In development, Vite mounts the same API (see vite.config.ts).
const PORT = Number(process.env.PORT ?? 3000)
const DIST = resolve(process.cwd(), "dist")
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
}

// Demo mock AI must never run anywhere but a local rehearsal. Asked for where it isn't allowed, refuse to start rather than
// guess: neither quietly mock nor quietly spend real provider quota.
if (aiMockState() === "blocked") {
  console.error(AI_MOCK_BLOCKED_MESSAGE)
  process.exit(1)
}

if (!existsSync(join(DIST, "index.html"))) {
  console.error("No build found in dist/. Run `npm run build` first.")
  process.exit(1)
}

getDb()

createServer(async (req, res) => {
  if (await handleApi(req, res)) return

  const urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname)
  let file = normalize(join(DIST, urlPath))
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(DIST, "index.html") // client-side routing fallback
  }
  res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream")
  createReadStream(file).pipe(res)
}).listen(PORT, () => {
  console.log(`WASL running at http://localhost:${PORT} (database: ${DB_PATH})`)
  if (aiMockState() === "on") console.log("DEMO MOCK AI is ON: no AI provider will be contacted; every review, interview and assessment is scripted and labelled as demo data.")
})
