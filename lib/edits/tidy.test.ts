import { describe, expect, it } from "vitest"

import { fitLabel, tidy, type Measure } from "./tidy"

// 0.6em per character, like the fallback measurer.
const measure: Measure = (text, fontSize) => {
  const lines = text.split("\n")
  return {
    w: Math.max(...lines.map((l) => l.length)) * fontSize * 0.6,
    h: lines.length * fontSize * 1.25,
  }
}

type Any = Record<string, unknown>
let n = 0
const base = (over: Any): Any => ({
  id: `e${++n}`,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  index: null,
  roundness: null,
  seed: 1,
  version: 1,
  versionNonce: 0,
  isDeleted: false,
  boundElements: [],
  updated: 0,
  link: null,
  locked: false,
  ...over,
})

/** A labelled box; returns [shape, text]. */
function shape(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string
) {
  const text = base({
    id: `${id}-t`,
    type: "text",
    x: x + 10,
    y: y + 10,
    width: label.length * 12,
    height: 25,
    text: label,
    originalText: label,
    fontSize: 20,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: id,
    lineHeight: 1.25,
    autoResize: true,
  })
  const s = base({
    id,
    type: "rectangle",
    x,
    y,
    width: w,
    height: h,
    boundElements: [{ type: "text", id: text.id }],
  })
  return [s, text]
}

function arrow(id: string, from: Any, to: Any, label?: string) {
  const fx = (from.x as number) + (from.width as number)
  const fy = (from.y as number) + (from.height as number) / 2
  const tx = to.x as number
  const ty = (to.y as number) + (to.height as number) / 2
  const a = base({
    id,
    type: "arrow",
    x: fx,
    y: fy,
    width: Math.abs(tx - fx),
    height: Math.abs(ty - fy),
    points: [
      [0, 0],
      [tx - fx, ty - fy],
    ],
    startBinding: { elementId: from.id, fixedPoint: [1, 0.5], mode: "orbit" },
    endBinding: { elementId: to.id, fixedPoint: [0, 0.5], mode: "orbit" },
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  })
  const out = [a]
  if (label) {
    const t = base({
      id: `${id}-t`,
      type: "text",
      x: 0,
      y: 0,
      width: label.length * 12,
      height: 25,
      text: label,
      originalText: label,
      fontSize: 20,
      fontFamily: 5,
      containerId: id,
      lineHeight: 1.25,
    })
    ;(a.boundElements as Any[]).push({ type: "text", id: t.id })
    out.push(t)
  }
  ;(from.boundElements as Any[]).push({ type: "arrow", id })
  ;(to.boundElements as Any[]).push({ type: "arrow", id })
  return out
}

const run = (els: Any[], changed: string[]) =>
  tidy(els as unknown as Parameters<typeof tidy>[0], new Set(changed), measure)

describe("fitLabel", () => {
  it("keeps a short label on one line", () => {
    const fit = fitLabel(
      {
        originalText: "API",
        text: "API",
        fontSize: 20,
        fontFamily: 5,
        lineHeight: 1.25 as never,
      },
      measure
    )
    expect(fit.text).toBe("API")
    expect(fit.h).toBe(25)
  })
  it("wraps a long label into a few lines under the width cap", () => {
    const long =
      "Order service (Node) — checkout, payments via Stripe webhooks, and refunds"
    const fit = fitLabel(
      {
        originalText: long,
        text: long,
        fontSize: 20,
        fontFamily: 5,
        lineHeight: 1.25 as never,
      },
      measure
    )
    const lines = fit.text.split("\n")
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.length).toBeLessThanOrEqual(4)
    expect(fit.w).toBeLessThanOrEqual(320 - 28)
  })
})

describe("tidy", () => {
  it("grows a renamed box around its label and keeps its centre", () => {
    const [s, t] = shape(
      "a",
      100,
      100,
      140,
      60,
      "Order service (Node) — checkout, payments via Stripe webhooks"
    )
    const els = [s, t]
    run(els, ["a"])
    expect(s.width as number).toBeGreaterThan(140)
    expect((s.x as number) + (s.width as number) / 2).toBeCloseTo(170, 5)
    expect((s.y as number) + (s.height as number) / 2).toBeCloseTo(130, 5)
    // The label sits inside the box.
    expect(t.x as number).toBeGreaterThanOrEqual(s.x as number)
    expect((t.y as number) + (t.height as number)).toBeLessThanOrEqual(
      (s.y as number) + (s.height as number)
    )
  })

  it("pushes a neighbour out of the way when a box grows, and cascades", () => {
    const [a, at] = shape(
      "a",
      100,
      100,
      140,
      60,
      "Order service (Node) — checkout, payments via Stripe webhooks"
    )
    const [b, bt] = shape("b", 100, 200, 140, 60, "Redis")
    const [c, ct] = shape("c", 100, 300, 140, 60, "Queue")
    const els = [a, at, b, bt, c, ct]
    run(els, ["a"])
    const bottom = (a.y as number) + (a.height as number)
    expect(b.y as number).toBeGreaterThanOrEqual(bottom + 28)
    expect(c.y as number).toBeGreaterThanOrEqual(
      (b.y as number) + (b.height as number) + 28
    )
    // Labels travelled with their boxes.
    expect(bt.y as number).toBeGreaterThan(200)
  })

  it("lengthens a labelled arrow so the label fits between the boxes", () => {
    const [a, at] = shape("a", 0, 0, 120, 60, "Client")
    const [b, bt] = shape("b", 160, 0, 120, 60, "API")
    const els = [
      a,
      at,
      b,
      bt,
      ...arrow("x", a, b, "REST + JSON over HTTPS, short-lived JWT"),
    ]
    run(els, ["x"])
    const gap = (b.x as number) - ((a.x as number) + (a.width as number))
    // The label wrapped to the arrow-label width cap, and the gap fits it.
    const label = els.find((e) => e.id === "x-t")!
    expect((label.text as string).split("\n").length).toBeGreaterThan(1)
    expect(label.width as number).toBeLessThanOrEqual(200)
    expect(gap).toBeGreaterThanOrEqual((label.width as number) + 32)
    // The arrow was re-anchored to the moved box.
    const ar = els.find((e) => e.id === "x")!
    expect((ar.points as number[][])[1][0]).toBeCloseTo(gap, 5)
  })

  it("routes a new arrow around a box in its way", () => {
    const [a, at] = shape("a", 0, 0, 120, 60, "A")
    const [mid, mt] = shape("m", 200, 0, 120, 60, "M")
    const [b, bt] = shape("b", 400, 0, 120, 60, "B")
    const els = [a, at, mid, mt, b, bt, ...arrow("x", a, b, "reserve")]
    run(els, ["x"])
    const ar = els.find((e) => e.id === "x")!
    const pts = ar.points as number[][]
    expect(pts.length).toBe(4)
    // The clear segment runs outside the obstacle's vertical extent.
    const yClear = (ar.y as number) + pts[1][1]
    expect(
      yClear < (mid.y as number) ||
        yClear > (mid.y as number) + (mid.height as number)
    ).toBe(true)
    expect(ar.startBinding).toMatchObject({
      fixedPoint: [0.5, expect.any(Number)],
    })
  })

  it("grows a container to keep a child that was pushed", () => {
    const [box, boxT] = shape("vpc", 0, 0, 400, 300, "VPC")
    const [a, at] = shape(
      "a",
      40,
      40,
      140,
      60,
      "Order service (Node) — checkout, payments via Stripe webhooks"
    )
    const [b, bt] = shape("b", 40, 200, 140, 60, "Redis")
    const els = [box, boxT, a, at, b, bt]
    run(els, ["a"])
    const bBottom = (b.y as number) + (b.height as number)
    expect((box.y as number) + (box.height as number)).toBeGreaterThanOrEqual(
      bBottom + 28
    )
    // The grown child is still inside too (the container widened for it).
    expect(box.x as number).toBeLessThanOrEqual((a.x as number) - 28)
    expect((box.x as number) + (box.width as number)).toBeGreaterThanOrEqual(
      (a.x as number) + (a.width as number) + 28
    )
  })

  it("leaves untouched drawings alone", () => {
    const [a, at] = shape("a", 0, 0, 120, 60, "A")
    const [b, bt] = shape("b", 200, 0, 120, 60, "B")
    const els = [a, at, b, bt, ...arrow("x", a, b, "go")]
    const snapshot = JSON.stringify(els)
    run(els, [])
    expect(JSON.stringify(els)).toBe(snapshot)
  })
})

describe("tidy with moves", () => {
  it("moves a box where the edit asks, its label and arrow with it", () => {
    const [a, at] = shape("a", 0, 0, 160, 80, "A")
    const [b, bt] = shape("b", 300, 0, 160, 80, "B")
    const [c, ct] = shape("c", 0, 300, 160, 80, "C")
    const ab = arrow("ab", a, b)
    const els = [a, at, b, bt, c, ct, ...ab]
    // Put B below A instead of beside it.
    tidy(
      els as unknown as Parameters<typeof tidy>[0],
      new Set(["b"]),
      measure,
      new Map([["b", { dx: 0, dy: 1 }]]),
      new Map([["b", { x: 0, y: 108 }]])
    )
    expect(b.x).toBe(0)
    expect(b.y).toBe(108)
    // The label went along, and the arrow now leaves A's bottom for B's top.
    expect(bt.x).toBe(10)
    expect(bt.y).toBe(118)
    const arr = ab[0]
    const start = { x: arr.x as number, y: arr.y as number }
    expect(start.y).toBeCloseTo(80, 0)
    expect((arr.startBinding as { fixedPoint: number[] }).fixedPoint[1]).toBe(1)
    // C, which sat where B landed near, is pushed further down, not overlapped.
    expect((c.y as number) >= 108 + 80).toBe(true)
  })
})
