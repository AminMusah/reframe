import fs from "node:fs"
import path from "node:path"

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import { describe, expect, it } from "vitest"

import { audit, layoutScene } from "./layout"
import type { Measure } from "./tidy"

// 0.6em per character, like the fallback measurer.
const measure: Measure = (text, fontSize) => {
  const lines = text.split("\n")
  return {
    w: Math.max(...lines.map((l) => l.length)) * fontSize * 0.6,
    h: lines.length * fontSize * 1.25,
  }
}

type El = { -readonly [K in keyof ExcalidrawElement]: ExcalidrawElement[K] }

// A sign-up flow after several agent edits: arrows through boxes, labels on
// shapes, a box dropped onto an arrow.
const load = (): El[] =>
  JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../../fixtures/messy-signup.excalidraw"),
      "utf8"
    )
  ).elements

describe("audit", () => {
  it("finds the mess", () => {
    const problems = audit(load())
    expect(problems.some((p) => p.kind === "arrow-through")).toBe(true)
    expect(problems.some((p) => p.kind === "label-over")).toBe(true)
  })
})

describe("layoutScene", () => {
  it("leaves nothing for the audit to find", () => {
    const els = load()
    const moved = layoutScene(els, measure)
    expect(moved.length).toBeGreaterThan(0)
    expect(audit(els)).toEqual([])
  })

  it("keeps the flow going down and the corner where it was", () => {
    const els = load()
    const shape = (id: string) => els.find((e) => e.id === id)!
    const before = els
      .filter((e) => e.type === "rectangle" || e.type === "diamond")
      .map((e) => ({ x: e.x, y: e.y }))
    const minX = Math.min(...before.map((b) => b.x))
    const minY = Math.min(...before.map((b) => b.y))
    layoutScene(els, measure)
    const shapes = els.filter(
      (e) => e.type === "rectangle" || e.type === "diamond"
    )
    expect(Math.min(...shapes.map((s) => s.x))).toBeCloseTo(minX, 0)
    expect(Math.min(...shapes.map((s) => s.y))).toBeCloseTo(minY, 0)
    // Visitor → Sign up → Verify email link: each below the last.
    const arrow = els.find(
      (e) => e.type === "arrow" && e.startBinding && e.endBinding
    ) as Extract<ExcalidrawElement, { type: "arrow" }>
    const from = shape(arrow.startBinding!.elementId)
    const to = shape(arrow.endBinding!.elementId)
    expect(Math.abs(to.y - from.y)).toBeGreaterThan(Math.abs(to.x - from.x))
  })

  it("moves labels with their boxes and arrows with their ends", () => {
    const els = load()
    layoutScene(els, measure)
    for (const el of els) {
      if (el.type !== "text" || !el.containerId) continue
      const c = els.find((e) => e.id === el.containerId)!
      if (c.type === "arrow") continue
      expect(el.x + el.width / 2).toBeCloseTo(c.x + c.width / 2, 0)
      expect(el.y + el.height / 2).toBeCloseTo(c.y + c.height / 2, 0)
    }
    for (const a of els) {
      if (a.type !== "arrow" || !a.startBinding || !a.endBinding) continue
      const from = els.find((e) => e.id === a.startBinding!.elementId)!
      const onBorder = (p: { x: number; y: number }, b: typeof from) =>
        Math.abs(p.x - b.x) < 1 ||
        Math.abs(p.x - (b.x + b.width)) < 1 ||
        Math.abs(p.y - b.y) < 1 ||
        Math.abs(p.y - (b.y + b.height)) < 1
      expect(onBorder({ x: a.x, y: a.y }, from)).toBe(true)
    }
  })

  it("leaves a drawing with frames alone", () => {
    const els = load()
    els.push({
      ...els[0],
      id: "frame",
      type: "frame",
      boundElements: [],
    } as unknown as El)
    expect(layoutScene(els, measure)).toEqual([])
  })
})
