import dagre from "@dagrejs/dagre"
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"

import type { Box } from "@/lib/serializer"

import {
  bump,
  fitLabel,
  overlapsWithGap,
  segmentHitsBox,
  SHAPES,
  type Measure,
} from "./tidy"

/**
 * The tidy pass makes room locally; after enough edits a drawing can still
 * end up with arrows through boxes and labels over shapes. This is the
 * heavier answer: lay the whole drawing out again as a layered graph (dagre),
 * keeping its flow direction and its place on the canvas, then check the
 * result. `audit` lists what is wrong with a drawing; `layoutScene` fixes it.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
type El = Mutable<ExcalidrawElement>
type Text = Mutable<Extract<ExcalidrawElement, { type: "text" }>>
type Arrow = Mutable<Extract<ExcalidrawElement, { type: "arrow" | "line" }>>

const NODE_SEP = 48 // between boxes in a rank
const RANK_SEP = 64 // between ranks
const EDGE_SEP = 24
const LABEL_PAD = 8 // around an arrow label, reserved in the layout
const ARROW_LABEL_W = 200
const GAP = 8 // the least space two boxes may keep and still count as clean

const box = (el: {
  x: number
  y: number
  width: number
  height: number
}): Box => ({ x: el.x, y: el.y, w: el.width, h: el.height })

export type Problem =
  | { kind: "overlap"; a: string; b: string }
  | { kind: "arrow-through"; arrow: string; box: string }
  | { kind: "label-over"; label: string; box: string }

/** What is wrong with the drawing, as the tidy pass would judge it. */
export function audit(elements: readonly ExcalidrawElement[]): Problem[] {
  const live = elements.filter((e) => !e.isDeleted)
  const byId = new Map(live.map((e) => [e.id, e]))
  const nodes = live.filter((e) => isNode(e))
  const arrows = live.filter(
    (e): e is Arrow => e.type === "arrow" || e.type === "line"
  )
  const problems: Problem[] = []
  const containers = new Set<string>()
  for (const outer of nodes) {
    for (const inner of nodes) {
      if (outer !== inner && contains(box(outer), box(inner))) {
        containers.add(outer.id)
      }
    }
  }
  const plain = nodes.filter((n) => !containers.has(n.id))
  for (let i = 0; i < plain.length; i++) {
    for (let j = i + 1; j < plain.length; j++) {
      if (overlapsWithGap(box(plain[i]), box(plain[j]), GAP)) {
        problems.push({ kind: "overlap", a: plain[i].id, b: plain[j].id })
      }
    }
  }
  for (const a of arrows) {
    const ends = new Set([a.startBinding?.elementId, a.endBinding?.elementId])
    const pts = a.points.map(([px, py]) => ({ x: a.x + px, y: a.y + py }))
    for (const n of plain) {
      if (ends.has(n.id)) continue
      for (let i = 0; i + 1 < pts.length; i++) {
        if (segmentHitsBox(pts[i], pts[i + 1], box(n))) {
          problems.push({ kind: "arrow-through", arrow: a.id, box: n.id })
          break
        }
      }
    }
    const lb = a.boundElements?.find((b) => b.type === "text")
    const label = lb ? (byId.get(lb.id) as Text | undefined) : undefined
    if (label) {
      for (const n of plain) {
        if (overlapsWithGap(box(label), box(n), 0)) {
          problems.push({ kind: "label-over", label: label.id, box: n.id })
        }
      }
    }
  }
  return problems
}

/**
 * The audit's findings in words for the model, using the graph's short ids
 * (`idMap` is short → Excalidraw id, from the serializer). Empty when clean.
 */
export function describeProblems(
  elements: readonly ExcalidrawElement[],
  idMap: Record<string, string>
): string[] {
  const short = new Map(Object.entries(idMap).map(([k, v]) => [v, k]))
  const byId = new Map(elements.map((e) => [e.id, e]))
  const name = (id: string) => {
    const el = byId.get(id)
    const sid =
      short.get(id) ??
      (el?.type === "text"
        ? short.get((el as Text).containerId ?? "")
        : undefined)
    const label =
      el?.type === "text"
        ? (el as Text).text
        : (
            byId.get(
              el?.boundElements?.find((b) => b.type === "text")?.id ?? ""
            ) as Text | undefined
          )?.text
    const quoted = label ? ` "${label.replace(/\n/g, " ")}"` : ""
    return `${sid ?? el?.type ?? id}${quoted}`
  }
  return audit(elements).map((p) => {
    switch (p.kind) {
      case "overlap":
        return `${name(p.a)} overlaps ${name(p.b)}`
      case "arrow-through":
        return `arrow ${name(p.arrow)} runs through ${name(p.box)}`
      case "label-over":
        return `the label ${name(p.label)} sits on ${name(p.box)}`
    }
  })
}

/**
 * Lay the drawing out again. Boxes keep their sizes; the flow keeps its
 * direction (down or right, whichever the arrows mostly do); the whole thing
 * keeps its top-left corner, so free text such as a title stays where it was
 * relative to the drawing. Returns the ids of everything that moved.
 * Drawings with frames or boxes inside boxes are left alone (returns []).
 */
export function layoutScene(elements: El[], measure: Measure): string[] {
  const live = elements.filter((e) => !e.isDeleted)
  if (live.some((e) => e.type === "frame" || e.type === "magicframe")) {
    return []
  }
  const byId = new Map(live.map((e) => [e.id, e]))
  const nodes = live.filter((e) => isNode(e))
  if (nodes.length < 2) return []
  for (const outer of nodes) {
    for (const inner of nodes) {
      if (outer !== inner && contains(box(outer), box(inner))) return []
    }
  }
  const labelOf = (el: El): Text | undefined => {
    const b = el.boundElements?.find((x) => x.type === "text")
    return b ? (byId.get(b.id) as Text | undefined) : undefined
  }
  const arrows = live.filter(
    (e): e is Arrow => e.type === "arrow" || e.type === "line"
  )
  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = arrows.filter(
    (a) =>
      a.startBinding &&
      a.endBinding &&
      nodeIds.has(a.startBinding.elementId) &&
      nodeIds.has(a.endBinding.elementId) &&
      a.startBinding.elementId !== a.endBinding.elementId
  )

  // Which way does the drawing flow? Count arrows by their main direction.
  let down = 0
  let right = 0
  for (const a of edges) {
    const from = byId.get(a.startBinding!.elementId)!
    const to = byId.get(a.endBinding!.elementId)!
    const dx = cx(box(to)) - cx(box(from))
    const dy = cy(box(to)) - cy(box(from))
    if (Math.abs(dy) >= Math.abs(dx)) down += 1
    else right += 1
  }
  const rankdir = right > down ? "LR" : "TB"

  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setGraph({
    rankdir,
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    edgesep: EDGE_SEP,
    marginx: 0,
    marginy: 0,
  })
  g.setDefaultEdgeLabel(() => ({}))
  // Keep the author's left-to-right (or top-to-bottom) order where the
  // layout has a choice: nodes are added in that order.
  const ordered = [...nodes].sort((a, b) =>
    rankdir === "TB" ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x
  )
  for (const n of ordered) {
    g.setNode(n.id, { width: n.width, height: n.height })
  }
  for (const a of edges) {
    const label = labelOf(a)
    const size = label
      ? fitLabel(label, measure, ARROW_LABEL_W)
      : { w: 0, h: 0 }
    g.setEdge(
      a.startBinding!.elementId,
      a.endBinding!.elementId,
      {
        width: size.w ? size.w + 2 * LABEL_PAD : 0,
        height: size.h ? size.h + 2 * LABEL_PAD : 0,
        labelpos: "c",
      },
      a.id
    )
  }
  dagre.layout(g)

  // Pin the new drawing's top-left corner to the old one's.
  const oldBox = union(nodes.map(box))
  let minX = Infinity
  let minY = Infinity
  for (const n of nodes) {
    const p = g.node(n.id)
    minX = Math.min(minX, p.x - n.width / 2)
    minY = Math.min(minY, p.y - n.height / 2)
  }
  const ox = oldBox.x - minX
  const oy = oldBox.y - minY

  const moved = new Set<string>()
  const delta = new Map<string, { dx: number; dy: number }>()
  for (const n of nodes) {
    const p = g.node(n.id)
    const x = p.x - n.width / 2 + ox
    const y = p.y - n.height / 2 + oy
    if (Math.abs(x - n.x) < 0.5 && Math.abs(y - n.y) < 0.5) continue
    delta.set(n.id, { dx: x - n.x, dy: y - n.y })
    n.x = x
    n.y = y
    const label = labelOf(n)
    if (label) {
      label.x = x + (n.width - label.width) / 2
      label.y = y + (n.height - label.height) / 2
      moved.add(label.id)
    }
    moved.add(n.id)
  }

  for (const a of arrows) {
    const from = a.startBinding && byId.get(a.startBinding.elementId)
    const to = a.endBinding && byId.get(a.endBinding.elementId)
    if (edges.includes(a)) {
      const e = g.edge(a.startBinding!.elementId, a.endBinding!.elementId, a.id)
      const raw = (e.points ?? []).map((p: { x: number; y: number }) => ({
        x: p.x + ox,
        y: p.y + oy,
      }))
      if (raw.length < 2) continue
      // Straight where it can be: drop points that lie on the line between
      // their neighbours.
      const fb = box(from!)
      const tb = box(to!)
      const start = clampToBorder(raw[0], centre(tb), fb, from!.type)
      const end = clampToBorder(raw[raw.length - 1], centre(fb), tb, to!.type)
      raw[0] = start
      raw[raw.length - 1] = end
      const pts = simplify(squareEnds(raw, fb, tb))
      a.x = start.x
      a.y = start.y
      a.points = pts.map((p) => [
        p.x - start.x,
        p.y - start.y,
      ]) as unknown as typeof a.points
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      a.width = Math.max(...xs) - Math.min(...xs)
      a.height = Math.max(...ys) - Math.min(...ys)
      // Straight legs; a curved multi-point arrow would bow into things.
      if (pts.length > 2) a.roundness = null
      a.startBinding = {
        elementId: from!.id,
        fixedPoint: fixedPoint(start, fb),
        mode: "orbit",
      } as typeof a.startBinding
      a.endBinding = {
        elementId: to!.id,
        fixedPoint: fixedPoint(end, tb),
        mode: "orbit",
      } as typeof a.endBinding
      const label = labelOf(a)
      if (label) {
        const fit = fitLabel(label, measure, ARROW_LABEL_W)
        label.text = fit.text
        label.width = fit.w
        label.height = fit.h
        const lx = e.x !== undefined ? e.x + ox : (start.x + end.x) / 2
        const ly = e.y !== undefined ? e.y + oy : (start.y + end.y) / 2
        label.x = lx - fit.w / 2
        label.y = ly - fit.h / 2
        moved.add(label.id)
      }
      moved.add(a.id)
      continue
    }
    // An arrow bound at one end only (or to nothing) travels with its box.
    const d = delta.get(from?.id ?? "") ?? delta.get(to?.id ?? "")
    if (d) {
      a.x += d.dx
      a.y += d.dy
      const label = labelOf(a)
      if (label) {
        label.x += d.dx
        label.y += d.dy
        moved.add(label.id)
      }
      moved.add(a.id)
    }
  }

  // Free text keeps its offset from the drawing's corner (a title stays a
  // title); with the corner pinned that means it does not move at all, unless
  // it sat inside the old bounds, in which case it is pushed clear below.
  const newBox = union(nodes.map(box))
  for (const t of live) {
    if (t.type !== "text" || (t as Text).containerId) continue
    const tb = box(t)
    if (overlapsWithGap(tb, oldBox, 0) && !(tb.y + tb.h <= oldBox.y + 4)) {
      const clash = nodes.some((n) => overlapsWithGap(tb, box(n), GAP))
      if (clash) {
        t.y = newBox.y + newBox.h + NODE_SEP
        moved.add(t.id)
      }
    }
  }

  for (const id of moved) {
    const el = byId.get(id)
    if (el) bump(el)
  }
  return [...moved]
}

function isNode(e: ExcalidrawElement): boolean {
  return (SHAPES.has(e.type) || e.type === "image") && !e.frameId
}

const cx = (b: Box) => b.x + b.w / 2
const cy = (b: Box) => b.y + b.h / 2
const centre = (b: Box) => ({ x: cx(b), y: cy(b) })

function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  const x2 = Math.max(...boxes.map((b) => b.x + b.w))
  const y2 = Math.max(...boxes.map((b) => b.y + b.h))
  return { x, y, w: x2 - x, h: y2 - y }
}

function contains(outer: Box, inner: Box): boolean {
  if (outer.w * outer.h < inner.w * inner.h * 2.5) return false
  const x1 = Math.max(outer.x, inner.x)
  const y1 = Math.max(outer.y, inner.y)
  const x2 = Math.min(outer.x + outer.w, inner.x + inner.w)
  const y2 = Math.min(outer.y + outer.h, inner.y + inner.h)
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  return inner.w * inner.h > 0 && overlap / (inner.w * inner.h) >= 0.5
}

/** Drop interior points that sit (nearly) on the line between their neighbours. */
function simplify(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  const out = [pts[0]]
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = out[out.length - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    const len = Math.hypot(c.x - a.x, c.y - a.y) || 1
    if (Math.abs(cross) / len > 6) out.push(b)
  }
  out.push(pts[pts.length - 1])
  return out
}

/**
 * A route that reaches a box from above or below should arrive straight,
 * not on a slant: add a corner so the last (and first) leg is vertical
 * (horizontal for sideways entries).
 */
function squareEnds(
  pts: { x: number; y: number }[],
  fb: Box,
  tb: Box
): { x: number; y: number }[] {
  if (pts.length < 3) return pts
  const out = [...pts]
  const fix = (i: number, j: number, b: Box) => {
    const p = out[i] // on the border
    const q = out[j] // the leg before it
    const vertical = p.y <= b.y + 0.5 || p.y >= b.y + b.h - 0.5
    if (vertical ? Math.abs(q.x - p.x) > 8 : Math.abs(q.y - p.y) > 8) {
      const corner = vertical ? { x: p.x, y: q.y } : { x: q.x, y: p.y }
      out.splice(i < j ? j : i, 0, corner)
    }
  }
  fix(out.length - 1, out.length - 2, tb)
  fix(0, 1, fb)
  return out
}

/**
 * dagre ends an edge on the node's rectangle; snap to the nearest border
 * precisely. A diamond or ellipse only touches that rectangle at the side
 * midpoints, so those take the midpoint.
 */
function clampToBorder(
  p: { x: number; y: number },
  /** The other box's centre: a diamond picks the side facing it. */
  q: { x: number; y: number },
  b: Box,
  type: string
) {
  if (type === "diamond" || type === "ellipse") {
    const dx = q.x - cx(b)
    const dy = q.y - cy(b)
    if (Math.abs(dx) > Math.abs(dy)) {
      return { x: dx > 0 ? b.x + b.w : b.x, y: cy(b) }
    }
    return { x: cx(b), y: dy > 0 ? b.y + b.h : b.y }
  }
  const x = Math.min(Math.max(p.x, b.x), b.x + b.w)
  const y = Math.min(Math.max(p.y, b.y), b.y + b.h)
  const dl = p.x - b.x
  const dr = b.x + b.w - p.x
  const dt = p.y - b.y
  const db = b.y + b.h - p.y
  const m = Math.min(dl, dr, dt, db)
  if (m === dl) return { x: b.x, y }
  if (m === dr) return { x: b.x + b.w, y }
  if (m === dt) return { x, y: b.y }
  return { x, y: b.y + b.h }
}

function fixedPoint(p: { x: number; y: number }, b: Box): [number, number] {
  return [
    Math.min(1, Math.max(0, (p.x - b.x) / b.w)),
    Math.min(1, Math.max(0, (p.y - b.y) / b.h)),
  ]
}
