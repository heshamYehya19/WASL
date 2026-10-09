import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { handleApi } from './server/api.ts'

/** Serves the WASL database API at /api from the Vite dev and preview servers. */
function waslApi(): Plugin {
  const middleware = (req: Parameters<typeof handleApi>[0], res: Parameters<typeof handleApi>[1], next: () => void) => {
    handleApi(req, res).then((handled) => {
      if (!handled) next()
    })
  }
  return {
    name: 'wasl-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), waslApi()],
  server: {
    // Don't reload the page when SQLite writes to the database file.
    watch: { ignored: ['**/data/**'] },
  },
})
