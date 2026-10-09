import { DB_PATH, resetDatabase } from "./db.ts"

resetDatabase()
console.log(`WASL database reset and re-seeded at ${DB_PATH}`)
