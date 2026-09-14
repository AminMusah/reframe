import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"

import type { Box } from "@/lib/serializer"

/**
 * Breathing room after an edit. The converter wraps a label to whatever width
 * the box had and grows it downward, and nothing else moves — so a renamed
 * box lands on its neighbour, a long arrow label hides under a shape, and a
 * new arrow runs straight through whatever is in between. This pass is pure
 * geometry, runs after every edit, and only touches what the edit disturbed:
 *
 *  1. boxes are sized for their label (one line up to MAX_W, else a few lines),
 *     keeping their centre;
 *  2. labelled arrows get enough length for the label;
 *  3. anything a grown or moved box now overlaps is pushed away, cascading;
 *     containers grow to keep their children;
 *  4. arrows bound to moved boxes are re-anchored, and a straight arrow that
 *     would cross another box is routed around it.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
type El = Mutable<ExcalidrawElement>
type Text = Mutable<Extract<ExcalidrawElement, { type: "text" }>>
type Arrow = Mutable<Extract<ExcalidrawElement, { type: "arrow" | "line" }>>

export type Measure = (
  text: string,
  fontSize: number,
  fontFamily: number
) => { w: number; h: number }

const PAD = 14 // inside a box, around its label
const MAX_W = 320 // a label wraps beyond this box width
const MIN_W = 100
const MIN_H = 56
const GAP = 28 // between neighbouring boxes
const ARROW_MARGIN = 16 // between an arrow label and the boxes it joins
const ARROW_LABEL_W = 200 // an arrow label wraps beyond this
const MAX_SHOVE = 260 // a box is never moved further than this to make room
const ROUTE_CLEAR = 36 // how far a rerouted arrow passes an obstacle
const MAX_PUSHES = 200

const SHAPES = new Set(["rectangle", "ellipse", "diamond"])

const box = (el: {
  x: number
  y: number
  width: number
  height: number
}): Box => ({ x: el.x, y: el.y, w: el.width, h: el.height })
const cx = (b: Box) => b.x + b.w / 2
const cy = (b: Box) => b.y + b.h / 2

export function tidy(
  elements: El[],
  changedIds: Set<string>,
  measure: Measure
): void {
  const live = elements.filter((e) => !e.isDeleted)
  const byId = new Map(live.map((e) => [e.id, e]))
  const shapes = live.filter((e) => SHAPES.has(e.type))
  const labelOf = (el: El): Text | undefined => {
    const b = el.boundElements?.find((x) => x.type === "text")
    return b ? (byId.get(b.id) as Text | undefined) : undefined
  }
  const arrows = live.filter(
    (e): e is Arrow => e.type === "arrow" || e.type === "line"
  )

  // Containers: shapes that hold other shapes. They are not pushed and they
  // do not push; at the end they grow to keep what they held.
  const children = new Map<string, Set<string>>()
  for (const outer of shapes) {
    for (const inner of shapes) {
      if (outer !== inner && contains(box(outer), box(inner))) {
        if (!children.has(outer.id)) children.set(outer.id, new Set())
        children.get(outer.id)!.add(inner.id)
      }
    }
  }
  for (const f of live.filter(
    (e) => e.type === "frame" || e.type === "magicframe"
  )) {
    const kids = live.filter((e) => e.frameId === f.id && SHAPES.has(e.type))
    if (kids.length) children.set(f.id, new Set(kids.map((k) => k.id)))
  }
  const isContainer = (id: string) => children.has(id)
  const moved = new Set<string>()
  // How far each box has been displaced, so pushes continue in that direction.
  const disp = new Map<string, { dx: number; dy: number }>()
  const nudge = (el: El, dx: number, dy: number) => {
    el.x += dx
    el.y += dy
    shiftLabel(el, labelOf(el), dx, dy)
    const d = disp.get(el.id) ?? { dx: 0, dy: 0 }
    disp.set(el.id, { dx: d.dx + dx, dy: d.dy + dy })
    moved.add(el.id)
  }
  const before = new Map(shapes.map((s) => [s.id, box(s)]))
  // Boxes step 1 sized for their label: neighbours make room for them, not
  // the other way round.
  const resized = new Set<string>()

  // 1. Size changed boxes for their labels.
  for (const s of shapes) {
    if (!changedIds.has(s.id) || isContainer(s.id)) continue
    const label = labelOf(s)
    if (!label) continue
    const fit = fitLabel(label, measure)
    const w = Math.max(MIN_W, fit.w + 2 * PAD)
    const h = Math.max(MIN_H, fit.h + 2 * PAD)
    if (Math.abs(w - s.width) < 1 && Math.abs(h - s.height) < 1) continue
    const c = { x: cx(box(s)), y: cy(box(s)) }
    s.x = c.x - w / 2
    s.y = c.y - h / 2
    s.width = w
    s.height = h
    label.text = fit.text
    label.width = fit.w
    label.height = fit.h
    label.x = c.x - fit.w / 2
    label.y = c.y - fit.h / 2
    moved.add(s.id)
    resized.add(s.id)
  }

  // Steps 2 and 3 run twice: making room for one arrow can be undone by a
  // push in step 3, and the second pass settles it.
  for (let pass = 0; pass < 2; pass++) {
    // 2. Labelled arrows need room for the label between their boxes.
    for (const a of arrows) {
      const from = a.startBinding && byId.get(a.startBinding.elementId)
      const to = a.endBinding && byId.get(a.endBinding.elementId)
      const label = labelOf(a)
      if (!from || !to || !label) continue
      if (!SHAPES.has(from.type) || !SHAPES.has(to.type)) continue
      const touched =
        changedIds.has(a.id) || changedIds.has(from.id) || changedIds.has(to.id)
      if (!touched) continue
      // Long arrow labels wrap rather than demanding a very long arrow.
      if (changedIds.has(a.id) || changedIds.has(label.id)) {
        const fit = fitLabel(label, measure, ARROW_LABEL_W)
        label.text = fit.text
        label.width = fit.w
        label.height = fit.h
      }
      // Measured, not stored: hand-drawn labels often carry generous widths.
      const m = measure(label.text, label.fontSize, label.fontFamily)
      const fb = box(from)
      const tb = box(to)
      const horizontal = Math.abs(cx(tb) - cx(fb)) >= Math.abs(cy(tb) - cy(fb))
      const gap = horizontal
        ? Math.max(tb.x - (fb.x + fb.w), fb.x - (tb.x + tb.w))
        : Math.max(tb.y - (fb.y + fb.h), fb.y - (tb.y + tb.h))
      const need = (horizontal ? m.w : m.h) + 2 * ARROW_MARGIN
      if (gap >= need) continue
      // Never move a box that just grew for its label; prefer the end the edit
      // brought in, then the arrow's target.
      const candidates = [to, from].filter((e) => !resized.has(e.id))
      const mover =
        candidates.find((e) => changedIds.has(e.id)) ?? candidates[0]
      if (!mover) continue
      const other = mover === from ? to : from
      if (isContainer(mover.id)) continue
      const dir = horizontal
        ? Math.sign(cx(box(mover)) - cx(box(other))) || 1
        : Math.sign(cy(box(mover)) - cy(box(other))) || 1
      const delta = Math.min(need - gap, MAX_SHOVE)
      nudge(mover, horizontal ? dir * delta : 0, horizontal ? 0 : dir * delta)
    }

    // 3. Push whatever the grown or moved boxes now sit on, cascading.
    const queue = [
      ...new Set([
        ...moved,
        ...[...changedIds].filter((id) => shapes.some((s) => s.id === id)),
      ]),
    ]
    let pushes = 0
    while (queue.length && pushes < MAX_PUSHES) {
      const n = byId.get(queue.shift()!)
      if (!n || !SHAPES.has(n.type) || isContainer(n.id)) continue
      for (const m of shapes) {
        if (m === n || isContainer(m.id)) continue
        const nb = box(n)
        const mb = box(m)
        if (!overlapsWithGap(nb, mb, GAP)) continue
        // Push the way the pusher itself travelled; a box that only grew
        // pushes along the axis where the two centres are furthest apart.
        const d = disp.get(n.id)
        const dx = d && (d.dx || d.dy) ? d.dx : cx(mb) - cx(nb)
        const dy = d && (d.dx || d.dy) ? d.dy : cy(mb) - cy(nb)
        let mx = 0
        let my = 0
        if (Math.abs(dx) >= Math.abs(dy)) {
          const dir = Math.sign(dx) || 1
          mx = dir > 0 ? nb.x + nb.w + GAP - mb.x : nb.x - GAP - (mb.x + mb.w)
        } else {
          const dir = Math.sign(dy) || 1
          my = dir > 0 ? nb.y + nb.h + GAP - mb.y : nb.y - GAP - (mb.y + mb.h)
        }
        nudge(m, mx, my)
        queue.push(m.id)
        pushes++
      }
      // A box that is not one of a container's children must not sit on its
      // border: push it fully outside.
      for (const [cid, kids] of children) {
        if (kids.has(n.id) || n.id === cid) continue
        const c = byId.get(cid)
        if (!c) continue
        const cb = box(c)
        const nb = box(n)
        if (!overlapsWithGap(cb, nb, 0) || contains(cb, nb)) continue
        const outRight = cb.x + cb.w + GAP - nb.x
        const outLeft = nb.x + nb.w + GAP - cb.x
        const outDown = cb.y + cb.h + GAP - nb.y
        const outUp = nb.y + nb.h + GAP - cb.y
        const least = Math.min(outRight, outLeft, outDown, outUp)
        if (least === outRight) nudge(n, outRight, 0)
        else if (least === outLeft) nudge(n, -outLeft, 0)
        else if (least === outDown) nudge(n, 0, outDown)
        else nudge(n, 0, -outUp)
        queue.push(n.id)
      }
    }
  }

  // Containers grow to keep their children (with a margin), never shrink.
  for (const [id, kids] of children) {
    const c = byId.get(id)
    if (!c) continue
    const { w, h } = box(c)
    let { x, y } = box(c)
    let x2 = x + w
    let y2 = y + h
    for (const kid of kids) {
      const k = byId.get(kid)
      if (!k) continue
      x = Math.min(x, k.x - GAP)
      y = Math.min(y, k.y - GAP)
      x2 = Math.max(x2, k.x + k.width + GAP)
      y2 = Math.max(y2, k.y + k.height + GAP)
    }
    if (x !== c.x || y !== c.y || x2 - x !== c.width || y2 - y !== c.height) {
      const label = labelOf(c)
      const labelTop = label ? label.y - c.y : 0
      c.x = x
      c.y = y
      c.width = x2 - x
      c.height = y2 - y
      if (label) {
        // A container's label lives near its top edge; keep it there.
        label.x = cx(box(c)) - label.width / 2
        label.y = y + labelTop
      }
      moved.add(c.id)
    }
  }

  // 4. Arrows follow their boxes; new straight arrows route around obstacles.
  for (const a of arrows) {
    const from = a.startBinding && byId.get(a.startBinding.elementId)
    const to = a.endBinding && byId.get(a.endBinding.elementId)
    if (!from || !to || !SHAPES.has(from.type) || !SHAPES.has(to.type)) continue
    const endsMoved = moved.has(from.id) || moved.has(to.id)
    if (!endsMoved && !changedIds.has(a.id)) continue
    const straight = a.points.length === 2 || changedIds.has(a.id)
    if (!straight) {
      // A hand-drawn multi-point arrow: only its ends follow the boxes.
      const fb = before.get(from.id)
      const tb = before.get(to.id)
      if (fb && moved.has(from.id)) {
        a.x += from.x - fb.x
        a.y += from.y - fb.y
      }
      if (tb && moved.has(to.id)) {
        const last = a.points.length - 1
        const ddx = to.x - tb.x - (fb && moved.has(from.id) ? from.x - fb.x : 0)
        const ddy = to.y - tb.y - (fb && moved.has(from.id) ? from.y - fb.y : 0)
        a.points = a.points.map((p, i) =>
          i === last ? [p[0] + ddx, p[1] + ddy] : p
        ) as unknown as typeof a.points
      }
      continue
    }
    const fb = box(from)
    const tb = box(to)
    const obstacles = shapes.filter(
      (s) => s !== from && s !== to && !isContainer(s.id)
    )
    const [start, end, sp, ep] = anchors(
      fb,
      tb,
      tOf(a.startBinding?.fixedPoint)
    )
    const crossing = obstacles.filter((o) => segmentHitsBox(start, end, box(o)))
    let points: [number, number][]
    let origin = start
    if (crossing.length === 0) {
      points = [
        [0, 0],
        [end.x - start.x, end.y - start.y],
      ]
      a.startBinding = { ...a.startBinding!, fixedPoint: sp }
      a.endBinding = { ...a.endBinding!, fixedPoint: ep }
    } else {
      // Go over or under the obstacles, whichever is the shorter detour.
      const yTop = Math.min(
        Math.min(...crossing.map((o) => o.y)) - ROUTE_CLEAR,
        fb.y - ROUTE_CLEAR / 2,
        tb.y - ROUTE_CLEAR / 2
      )
      const yBottom = Math.max(
        Math.max(...crossing.map((o) => o.y + o.height)) + ROUTE_CLEAR,
        fb.y + fb.h + ROUTE_CLEAR / 2,
        tb.y + tb.h + ROUTE_CLEAR / 2
      )
      const costTop = fb.y - yTop + (tb.y - yTop)
      const costBottom = yBottom - (fb.y + fb.h) + (yBottom - (tb.y + tb.h))
      const above = costTop <= costBottom
      const yClear = above ? yTop : yBottom
      const s0 = { x: cx(fb), y: above ? fb.y : fb.y + fb.h }
      const e0 = { x: cx(tb), y: above ? tb.y : tb.y + tb.h }
      origin = s0
      points = [
        [0, 0],
        [0, yClear - s0.y],
        [e0.x - s0.x, yClear - s0.y],
        [e0.x - s0.x, e0.y - s0.y],
      ]
      a.startBinding = { ...a.startBinding!, fixedPoint: [0.5, above ? 0 : 1] }
      a.endBinding = { ...a.endBinding!, fixedPoint: [0.5, above ? 0 : 1] }
    }
    a.x = origin.x
    a.y = origin.y
    a.points = points as unknown as typeof a.points
    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    a.width = Math.max(...xs) - Math.min(...xs)
    a.height = Math.max(...ys) - Math.min(...ys)
    const label = labelOf(a)
    if (label) {
      const mid = midpoint(origin, points)
      label.x = mid.x - label.width / 2
      label.y = mid.y - label.height / 2
    }
  }

  // Everything that moved needs a version bump so the scene picks it up.
  for (const id of moved) {
    const el = byId.get(id)
    if (!el) continue
    bump(el)
    const label = labelOf(el)
    if (label) bump(label)
  }
  for (const a of arrows) {
    const from = a.startBinding?.elementId
    const to = a.endBinding?.elementId
    if (
      (from && moved.has(from)) ||
      (to && moved.has(to)) ||
      changedIds.has(a.id)
    ) {
      bump(a)
      const label = labelOf(a)
      if (label) bump(label)
    }
  }
}

/** Wrap a label into lines no wider than MAX_W (minus padding). */
export function fitLabel(
  label: Pick<
    Text,
    "originalText" | "text" | "fontSize" | "fontFamily" | "lineHeight"
  >,
  measure: Measure,
  maxLine = MAX_W - 2 * PAD
): { text: string; w: number; h: number } {
  const raw = (label.originalText || label.text).replace(/\s+/g, " ").trim()
  const lineH = label.fontSize * (label.lineHeight ?? 1.25)
  const words = raw.split(" ")
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (
      measure(candidate, label.fontSize, label.fontFamily).w <= maxLine ||
      !current
    ) {
      current = candidate
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  const w = Math.max(
    ...lines.map((l) => measure(l, label.fontSize, label.fontFamily).w)
  )
  return { text: lines.join("\n"), w, h: lines.length * lineH }
}

/** The offset along an edge stored in a fixedPoint (the component that is not 0 or 1). */
function tOf(fp: readonly [number, number] | null | undefined): number {
  if (!fp) return 0.5
  const t = fp.find((v) => v > 0 && v < 1)
  return t ?? 0.5
}

function shiftLabel(el: El, label: Text | undefined, dx: number, dy: number) {
  if (!label) return
  label.x += dx
  label.y += dy
}

function bump(el: El) {
  el.version += 1
  el.versionNonce = Math.floor(Math.random() * 2 ** 31)
  el.updated = Date.now()
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

function overlapsWithGap(a: Box, b: Box, gap: number): boolean {
  return (
    a.x < b.x + b.w + gap &&
    b.x < a.x + a.w + gap &&
    a.y < b.y + b.h + gap &&
    b.y < a.y + a.h + gap
  )
}

/** Same rule as buildArrow: facing edge midpoints, `t` slides along the edge. */
function anchors(
  a: Box,
  b: Box,
  t = 0.5
): [
  { x: number; y: number },
  { x: number; y: number },
  [number, number],
  [number, number],
] {
  const dx = cx(b) - cx(a)
  const dy = cy(b) - cy(a)
  if (Math.abs(dx) >= Math.abs(dy)) {
    const right = dx >= 0
    return [
      { x: right ? a.x + a.w : a.x, y: a.y + a.h * t },
      { x: right ? b.x : b.x + b.w, y: b.y + b.h * t },
      [right ? 1 : 0, t],
      [right ? 0 : 1, t],
    ]
  }
  const down = dy >= 0
  return [
    { x: a.x + a.w * t, y: down ? a.y + a.h : a.y },
    { x: b.x + b.w * t, y: down ? b.y : b.y + b.h },
    [t, down ? 1 : 0],
    [t, down ? 0 : 1],
  ]
}

/** Does the open segment p→q pass through the box (shrunk a little)? */
function segmentHitsBox(
  p: { x: number; y: number },
  q: { x: number; y: number },
  b: Box
): boolean {
  const inset = 4
  const x1 = b.x + inset
  const y1 = b.y + inset
  const x2 = b.x + b.w - inset
  const y2 = b.y + b.h - inset
  // Liang–Barsky clipping.
  let t0 = 0
  let t1 = 1
  const dx = q.x - p.x
  const dy = q.y - p.y
  const checks: [number, number][] = [
    [-dx, p.x - x1],
    [dx, x2 - p.x],
    [-dy, p.y - y1],
    [dy, y2 - p.y],
  ]
  for (const [pp, qq] of checks) {
    if (pp === 0) {
      if (qq < 0) return false
      continue
    }
    const r = qq / pp
    if (pp < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
  }
  return t1 - t0 > 0.02
}

function midpoint(
  origin: { x: number; y: number },
  points: [number, number][]
): { x: number; y: number } {
  // The middle of the middle segment (a straight arrow has one segment).
  const i = Math.floor((points.length - 1) / 2)
  const a = points[i]
  const b = points[Math.min(i + 1, points.length - 1)]
  return { x: origin.x + (a[0] + b[0]) / 2, y: origin.y + (a[1] + b[1]) / 2 }
}
