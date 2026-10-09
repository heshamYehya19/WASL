import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, normalize, resolve } from "node:path"
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
})
