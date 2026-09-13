import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { hashScene, serializeScene } from "./index"
import type {
  ExcalidrawElement,
  GraphArrow,
  GraphNode,
  SerializedScene,
} from "./types"

const FIXTURES = path.resolve(__dirname, "../../fixtures")

function load(name: string): ExcalidrawElement[] {
  const doc = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, `${name}.excalidraw`), "utf8")
  )
  return doc.elements
}

function node(scene: SerializedScene, label: string): GraphNode {
  const n = scene.graph.nodes.find((n) => n.label === label)
  if (!n) throw new Error(`no node labelled ${label}`)
  return n
}

function arrowsFrom(scene: SerializedScene, id: string): GraphArrow[] {
  return scene.graph.arrows.filter((a) => a.from === id)
}

describe("empty canvas", () => {
  it("serializes to a sentinel with no ids", () => {
    const scene = serializeScene(load("empty"))
    expect(scene.text).toBe("scene: empty")
    expect(scene.idMap).toEqual({})
    expect(scene.graph.nodes).toHaveLength(0)
  })
})

describe("login screen", () => {
  const scene = serializeScene(load("login-screen"))

  it("uses the frame as a named container", () => {
    expect(scene.graph.frames).toHaveLength(1)
    expect(scene.graph.frames[0]).toMatchObject({ id: "f1", label: "Login" })
    const inFrame = scene.graph.nodes.filter((n) => n.frame === "f1")
    expect(inFrame.map((n) => n.label)).toEqual([
      "Welcome back",
      "Email",
      "Password",
      "Sign in",
      "Forgot password?",
      "Continue with Google",
    ])
  })

  it("turns bound text into labels and keeps loose text as nodes", () => {
    expect(node(scene, "Email").kind).toBe("rectangle")
    expect(node(scene, "Forgot password?").kind).toBe("text")
    expect(scene.text).not.toMatch(/text "Email"/)
  })

  it("assigns short ids in reading order and maps them back", () => {
    const email = node(scene, "Email")
    expect(email.id).toBe("r1")
    expect(node(scene, "Password").id).toBe("r2")
    const source = load("login-screen").find((e) => e.id === scene.idMap.r1)
    expect(source?.type).toBe("rectangle")
    expect(source?.boundElements?.some((b) => b.type === "text")).toBe(true)
  })

  it("describes vertical stacking", () => {
    expect(node(scene, "Password").relation).toBe("below r1")
    expect(node(scene, "Sign in").relation).toBe("below r2")
  })

  it("emits groups and sticky notes", () => {
    expect(scene.graph.groups).toEqual([
      { id: "g1", sourceId: expect.any(String), members: ["r1", "r2"] },
    ])
    const note = node(scene, "Must work on mobile")
    expect(note.kind).toBe("note")
    expect(note.frame).toBeNull()
    expect(scene.text).toContain('n1 note "Must work on mobile"')
  })
})

describe("three-tier architecture", () => {
  const scene = serializeScene(load("three-tier"))

  it("nests nodes inside a geometric container", () => {
    const vpc = node(scene, "VPC")
    expect(node(scene, "API (Node)").parent).toBe(vpc.id)
    expect(node(scene, "Postgres").parent).toBe(vpc.id)
    expect(node(scene, "Redis cache").parent).toBe(vpc.id)
    expect(node(scene, "Client (Next.js)").parent).toBeNull()
    expect(scene.text).toContain(
      `\n    ${node(scene, "API (Node)").id} rectangle "API (Node)"`
    )
    expect(scene.text).toMatch(
      new RegExp(`"API \\(Node\\)" \\[[^\\]]+\\] inside ${vpc.id}`)
    )
  })

  it("resolves bound arrows with labels and flags elbowed ones", () => {
    const client = node(scene, "Client (Next.js)")
    const api = node(scene, "API (Node)")
    const [https] = arrowsFrom(scene, client.id)
    expect(https).toMatchObject({
      to: api.id,
      label: "HTTPS",
      elbowed: true,
      bidirectional: false,
    })
    expect(scene.text).toContain(
      `${https.id} ${client.id} -> ${api.id} "HTTPS" (elbowed)`
    )
  })

  it("marks two-headed arrows as bidirectional", () => {
    const api = node(scene, "API (Node)")
    const cache = node(scene, "Redis cache")
    const link = scene.graph.arrows.find((a) => a.to === cache.id)
    expect(link).toMatchObject({ from: api.id, bidirectional: true })
    expect(scene.text).toContain(`${api.id} <-> ${cache.id}`)
  })
})

describe("checkout flow", () => {
  const scene = serializeScene(load("checkout-flow"))

  it("keeps diamonds and ellipses as their own kinds", () => {
    expect(node(scene, "Logged in?")).toMatchObject({
      id: "d1",
      kind: "diamond",
    })
    expect(node(scene, "Done").kind).toBe("ellipse")
  })

  it("snaps an unbound arrow to the nearest shapes", () => {
    const decision = node(scene, "Logged in?")
    const login = node(scene, "Login")
    const no = scene.graph.arrows.find((a) => a.label === "no")
    expect(no).toMatchObject({ from: decision.id, to: login.id })
  })

  it("reports a dangling end with its position", () => {
    const fail = scene.graph.arrows.find((a) => a.label === "fail?")
    expect(fail?.from).toBe(node(scene, "Payment").id)
    expect(fail?.to).toBeNull()
    expect(fail?.looseEnd).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
      w: 1,
      h: 1,
    })
    expect(scene.text).toMatch(/-> \? loose end at \[\d+,\d+\] "fail\?"/)
  })

  it("orders shapes on the same row left to right", () => {
    const ids = ["Cart", "Logged in?", "Payment", "Done"].map((l) =>
      scene.graph.nodes.indexOf(node(scene, l))
    )
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
  })
})

describe("scribbles and media", () => {
  const scene = serializeScene(load("scribble"))
  const scribbles = scene.graph.nodes.filter((n) => n.kind === "scribble")

  it("says which node a stroke crosses or sits near", () => {
    expect(scribbles).toHaveLength(3)
    expect(scribbles[0].touches).toEqual({
      id: node(scene, "Dashboard").id,
      through: true,
    })
    expect(scribbles[1].touches).toEqual({
      id: node(scene, "Settings").id,
      through: false,
    })
    expect(scribbles[2].touches).toBeNull()
    expect(scene.text).toContain("s1 scribble through r1")
    expect(scene.text).toContain("s2 scribble near r2")
  })

  it("notes images by type and position only", () => {
    const img = scene.graph.nodes.find((n) => n.kind === "image")
    expect(img).toMatchObject({ id: "i1", label: null })
    expect(scene.text).toMatch(/i1 image \[\d+,\d+ \d+×\d+\]/)
  })
})

describe("determinism", () => {
  const elements = load("three-tier")
  const baseline = serializeScene(elements).text

  it("is independent of input order", () => {
    const shuffled = [...elements].reverse()
    expect(serializeScene(shuffled).text).toBe(baseline)
  })

  it("ignores cosmetic edits", () => {
    const tweaked = elements.map((e) => ({
      ...e,
      x: e.x + 2,
      strokeColor: "#ff0000",
      version: e.version + 5,
      versionNonce: 12345,
      updated: 999,
    })) as ExcalidrawElement[]
    expect(serializeScene(tweaked).text).toBe(baseline)
  })

  it("changes when a label changes", () => {
    const renamed = elements.map((e) =>
      e.type === "text" && e.text === "Postgres"
        ? { ...e, text: "MySQL", originalText: "MySQL" }
        : e
    ) as ExcalidrawElement[]
    expect(serializeScene(renamed).text).not.toBe(baseline)
  })

  it("skips deleted elements and orphaned bound text becomes loose text", () => {
    const withoutDb = elements.map((e) =>
      e.type === "ellipse" ? { ...e, isDeleted: true } : e
    ) as ExcalidrawElement[]
    const scene = serializeScene(withoutDb)
    expect(scene.graph.nodes.some((n) => n.kind === "ellipse")).toBe(false)
    expect(node(scene, "Postgres").kind).toBe("text")
  })

  it("does not turn an orphaned arrow into a self-loop", () => {
    // Delete Postgres: the SQL arrow keeps its geometry but loses its target, and
    // both ends are now nearest to the API box.
    const orphaned = elements.map((e) =>
      e.type === "ellipse"
        ? { ...e, isDeleted: true }
        : e.type === "arrow" && e.endBinding?.elementId === "ellipse-5"
          ? {
              ...e,
              endBinding: null,
              points: [
                [0, 0],
                [30, 0],
              ],
            }
          : e
    ) as ExcalidrawElement[]
    const scene = serializeScene(orphaned)
    const sql = scene.graph.arrows.find((a) => a.label === "SQL")
    expect(sql).toBeDefined()
    expect(sql!.from).not.toBe(sql!.to)
    expect(sql!.to === null || sql!.from === null).toBe(true)
  })

  it("exposes pixel boxes for nodes, frames, and arrows", () => {
    const scene = serializeScene(elements)
    for (const a of scene.graph.arrows) expect(scene.boxes[a.id]).toBeDefined()
    for (const n of scene.graph.nodes) expect(scene.boxes[n.id]).toBeDefined()
  })

  it("hashes to a stable sha-256 hex", async () => {
    const a = await hashScene(baseline)
    const b = await hashScene(baseline)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashScene(baseline + " ")).not.toBe(a)
  })
})
