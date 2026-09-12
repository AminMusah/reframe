import fs from "node:fs"
import { serializeScene } from "../lib/serializer"

// Usage: pnpm dump-graph fixtures/login-screen.excalidraw [...]
for (const file of process.argv.slice(2)) {
  const doc = JSON.parse(fs.readFileSync(file, "utf8"))
  console.log(`=== ${file}`)
  console.log(serializeScene(doc.elements).text)
  console.log()
}
