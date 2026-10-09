// A local stand-in for an AI provider, for tests and for trying WASL without a key. It is NOT part of the product and is never
// used unless you point a provider at it:
//
//   node scripts/mock-ai-server.ts                       # listens on http://127.0.0.1:4010
//   GROQ_API_KEY=mock WASL_GROQ_BASE_URL=http://127.0.0.1:4010/v1 npm start
//
// It answers the same JSON shapes a provider would, built from the actual submission text (see server/testing/fake-ai.ts), so the
// real pipeline — prompts, schema validation, grounding, the decision rule — runs end to end. What it "decides" is scripted, so
// nothing it returns is evidence of anything: do not use it for anything but development and tests.
//
// Control (tests): POST /__behavior with a JSON patch of the behaviour, POST /__reset, GET /__calls.

import { createServer } from "node:http"
import type { Server } from "node:http"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { FakeAi } from "../server/testing/fake-ai.ts"

export interface MockAi {
  url: string
  server: Server
  ai: FakeAi
  close: () => Promise<void>
}

export async function startMockAi(port = 0): Promise<MockAi> {
  const ai = new FakeAi()
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => chunks.push(c))
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.statusCode = status
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify(body))
      }
      let body: unknown = {}
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}
      } catch {
        return send(400, { error: { message: "bad json" } })
      }
      const path = new URL(req.url ?? "/", "http://localhost").pathname
      if (path === "/__behavior" && req.method === "POST") {
        Object.assign(ai.behavior, body)
        return send(200, ai.behavior)
      }
      if (path === "/__reset" && req.method === "POST") {
        ai.reset()
        return send(200, { ok: true })
      }
      if (path === "/__calls") return send(200, ai.calls.map((c) => ({ name: c.name })))
      if (path.endsWith("/chat/completions") && req.method === "POST") {
        const out = ai.respond(body)
        return send(out.status, out.body)
      }
      send(404, { error: { message: "not found" } })
    })
  })
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r))
  const address = server.address()
  const actual = typeof address === "object" && address ? address.port : port
  return {
    url: `http://127.0.0.1:${actual}`,
    server,
    ai,
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mock = await startMockAi(Number(process.env.MOCK_AI_PORT ?? 4010))
  console.log(`Mock AI provider listening at ${mock.url}/v1  (for development and tests only)`)
}
