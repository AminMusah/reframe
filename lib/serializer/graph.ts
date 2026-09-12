import {
  area,
  boxGap,
  coverage,
  distanceToBox,
  intersection,
  overlapX,
  overlapY,
  pointToGrid,
  toGrid,
  union,
} from "./geometry"
import type {
  Box,
  ExcalidrawElement,
  GraphArrow,
  GraphFrame,
  GraphGroup,
  GraphNode,
  NodeKind,
  SceneGraph,
} from "./types"

/** A node counts as inside a container when this much of its box is covered. */
const CONTAINMENT = 0.9
/** Unbound arrow endpoints snap to a node within this fraction of the scene's larger side. */
const SNAP_FRACTION = 0.05
const SNAP_MIN_PX = 40
/** Two siblings share a reading row when their vertical overlap is at least this share of the shorter one. */
const ROW_OVERLAP = 0.5
const LABEL_MAX = 80

type Linear = Extract<ExcalidrawElement, { type: "arrow" | "line" }>
type ExcalidrawArrowElement = Extract<ExcalidrawElement, { type: "arrow" }>
type FreeDraw = Extract<ExcalidrawElement, { type: "freedraw" }>
type TextEl = Extract<ExcalidrawElement, { type: "text" }>

type Entry = {
  el: ExcalidrawElement
  box: Box
  kind: NodeKind
  frame: string | null
  parent: string | null
}

const PREFIX: Record<NodeKind, string> = {
  rectangle: "r",
  diamond: "d",
  ellipse: "e",
  text: "t",
  note: "n",
  image: "i",
  embed: "i",
  scribble: "s",
}

export function buildGraph(elements: readonly ExcalidrawElement[]): {
  graph: SceneGraph
  idMap: Record<string, string>
} {
  const live = elements.filter((e) => !e.isDeleted && e.type !== "selection")
  const byId = new Map(live.map((e) => [e.id, e]))

  // Bound text becomes its container's label; everything else keeps its own row.
  const labelOf = new Map<string, string>()
  for (const e of live) {
    if (e.type === "text" && e.containerId && byId.has(e.containerId)) {
      const text = cleanLabel(e)
      if (text) labelOf.set(e.containerId, text)
    }
  }

  const frameEls = live.filter(
    (e) => e.type === "frame" || e.type === "magicframe"
  )
  const frameBoxes = new Map(frameEls.map((f) => [f.id, boxOf(f)]))

  const nodeEntries: Entry[] = []
  const arrowEls: Linear[] = []
  for (const e of live) {
    if (e.type === "frame" || e.type === "magicframe") continue
    if (e.type === "text" && e.containerId && byId.has(e.containerId)) continue
    if (e.type === "arrow" || e.type === "line") {
      arrowEls.push(e)
      continue
    }
    const box = boxOf(e)
    nodeEntries.push({
      el: e,
      box,
      kind: kindOf(e),
      frame: frameFor(e, box, frameBoxes),
      parent: null,
    })
  }

  // Geometric containment: parent is the smallest container-capable sibling that covers ≥ 90 %.
  const containers = nodeEntries.filter((n) => canContain(n.kind))
  for (const n of nodeEntries) {
    if (n.kind === "scribble") continue
    let best: Entry | null = null
    for (const c of containers) {
      if (c === n || c.frame !== n.frame || area(c.box) <= area(n.box)) continue
      if (coverage(n.box, c.box) < CONTAINMENT) continue
      if (!best || area(c.box) < area(best.box)) best = c
    }
    n.parent = best?.el.id ?? null
  }

  const sceneBox = union([
    ...frameBoxes.values(),
    ...nodeEntries.map((e) => e.box),
    ...arrowEls.map(boxOf),
  ])
  const snap = Math.max(
    SNAP_MIN_PX,
    SNAP_FRACTION * Math.max(sceneBox.w, sceneBox.h)
  )

  const idMap: Record<string, string> = {}
  const shortOf = new Map<string, string>()
  const counters = new Map<string, number>()
  const assign = (prefix: string, sourceId: string) => {
    const n = (counters.get(prefix) ?? 0) + 1
    counters.set(prefix, n)
    const id = `${prefix}${n}`
    idMap[id] = sourceId
    shortOf.set(sourceId, id)
    return id
  }

  // Ids follow a tree walk in reading order, so a container always precedes its contents.
  const frames: GraphFrame[] = readingOrder(frameEls, boxOf).map((f) => ({
    id: assign("f", f.id),
    sourceId: f.id,
    label: f.name?.trim() || null,
    box: toGrid(frameBoxes.get(f.id)!, sceneBox),
  }))

  const nodes: GraphNode[] = []
  const boxOfNode = new Map<string, Box>()
  const walk = (frame: string | null, parent: string | null) => {
    const children = nodeEntries.filter(
      (n) => n.frame === frame && n.parent === parent
    )
    for (const entry of readingOrder(children, (n) => n.box)) {
      const id = assign(PREFIX[entry.kind], entry.el.id)
      boxOfNode.set(id, entry.box)
      nodes.push({
        id,
        sourceId: entry.el.id,
        kind: entry.kind,
        label:
          entry.kind === "text"
            ? cleanLabel(entry.el as TextEl)
            : (labelOf.get(entry.el.id) ?? null),
        frame: frame ? shortOf.get(frame)! : null,
        parent: parent ? shortOf.get(parent)! : null,
        box: toGrid(entry.box, frame ? frameBoxes.get(frame)! : sceneBox),
        relation: null,
        touches: null,
      })
      walk(frame, entry.el.id)
    }
  }
  for (const f of frameEls) walk(f.id, null)
  walk(null, null)

  // One relative hint per node against siblings (same frame, same parent).
  for (const n of nodes) {
    if (n.kind === "scribble") continue
    const siblings = nodes.filter(
      (s) =>
        s.id !== n.id &&
        s.kind !== "scribble" &&
        s.frame === n.frame &&
        s.parent === n.parent
    )
    n.relation = relationTo(boxOfNode.get(n.id)!, siblings, boxOfNode)
  }

  // Scribbles: "through X" when the stroke's box overlaps a node, else "near X" within snap range.
  for (const n of nodes) {
    if (n.kind !== "scribble") continue
    const box = boxOfNode.get(n.id)!
    let through: GraphNode | null = null
    let throughScore = 0
    let near: GraphNode | null = null
    let nearGap = Infinity
    for (const other of nodes) {
      if (other.id === n.id || other.kind === "scribble") continue
      const obox = boxOfNode.get(other.id)!
      const overlap = area(intersection(box, obox))
      if (overlap > 0) {
        const score = overlap / Math.max(1, Math.min(area(box), area(obox)))
        if (score > throughScore) {
          through = other
          throughScore = score
        }
        continue
      }
      const gap = boxGap(box, obox)
      if (gap < nearGap) {
        near = other
        nearGap = gap
      }
    }
    if (through) n.touches = { id: through.id, through: true }
    else if (near && nearGap <= snap)
      n.touches = { id: near.id, through: false }
  }

  const resolveEnd = (
    binding: { elementId: string } | null,
    p: { x: number; y: number }
  ) => {
    if (binding && shortOf.has(binding.elementId))
      return shortOf.get(binding.elementId)!
    let best: string | null = null
    let bestDist = snap
    for (const n of nodes) {
      if (n.kind === "scribble") continue
      const d = distanceToBox(boxOfNode.get(n.id)!, p.x, p.y)
      if (d < bestDist) {
        best = n.id
        bestDist = d
      }
    }
    return best
  }

  const arrows: GraphArrow[] = readingOrder(arrowEls, boxOf).map((el) => {
    const id = assign("a", el.id)
    const pts = el.points
    const start = { x: el.x + pts[0][0], y: el.y + pts[0][1] }
    const last = pts[pts.length - 1]
    const end = { x: el.x + last[0], y: el.y + last[1] }

    let from = resolveEnd(el.startBinding, start)
    let to = resolveEnd(el.endBinding, end)
    let looseStart = from ? null : pointToGrid(start.x, start.y, sceneBox)
    let looseEnd = to ? null : pointToGrid(end.x, end.y, sceneBox)

    const heads = (el.startArrowhead ? 1 : 0) + (el.endArrowhead ? 1 : 0)
    if (el.startArrowhead && !el.endArrowhead) {
      ;[from, to] = [to, from]
      ;[looseStart, looseEnd] = [looseEnd, looseStart]
    }

    return {
      id,
      sourceId: el.id,
      from,
      to,
      looseStart,
      looseEnd,
      label: labelOf.get(el.id) ?? null,
      bidirectional: heads === 2,
      undirected: heads === 0,
      elbowed:
        el.type === "arrow" && (el as ExcalidrawArrowElement).elbowed === true,
    }
  })

  // Groups: any groupId shared by ≥ 2 serialized elements.
  const members = new Map<string, string[]>()
  for (const e of live) {
    const short = shortOf.get(e.id)
    if (!short) continue
    for (const g of e.groupIds ?? []) {
      const list = members.get(g) ?? []
      list.push(short)
      members.set(g, list)
    }
  }
  const nodeIds = new Set(nodes.map((n) => n.id))
  const groups: GraphGroup[] = [...members.entries()]
    .filter(([, m]) => m.length >= 2)
    .map(([sourceId, m]) => ({ sourceId, members: sortIds(m, nodeIds) }))
    .sort((a, b) => compareIds(a.members[0], b.members[0]))
    .map((g) => ({ id: assign("g", g.sourceId), ...g }))

  return { graph: { frames, nodes, arrows, groups }, idMap }
}

/**
 * Reading order: cluster boxes into rows (sorted by top edge, joining the current row when the
 * vertical overlap is large enough), then left-to-right within a row. Ties fall back to the
 * source id so the result does not depend on input order.
 */
function readingOrder<T extends { id: string } | { el: { id: string } }>(
  items: readonly T[],
  box: (t: T) => Box
): T[] {
  const idOf = (t: T) => ("el" in t ? t.el.id : t.id)
  const sorted = [...items].sort(
    (a, b) =>
      box(a).y - box(b).y ||
      box(a).x - box(b).x ||
      idOf(a).localeCompare(idOf(b))
  )
  const rows: { span: Box; items: T[] }[] = []
  for (const item of sorted) {
    const b = box(item)
    const row = rows[rows.length - 1]
    if (
      row &&
      overlapY(row.span, b) >= ROW_OVERLAP * Math.min(row.span.h, b.h)
    ) {
      row.items.push(item)
      row.span = union([row.span, b])
    } else {
      rows.push({ span: { ...b }, items: [item] })
    }
  }
  return rows.flatMap((r) =>
    r.items.sort(
      (a, b) =>
        box(a).x - box(b).x ||
        box(a).y - box(b).y ||
        idOf(a).localeCompare(idOf(b))
    )
  )
}

function kindOf(el: ExcalidrawElement): NodeKind {
  switch (el.type) {
    case "rectangle":
    case "diamond":
    case "ellipse":
    case "text":
      return el.type
    case "stickynote":
      return "note"
    case "image":
      return "image"
    case "embeddable":
    case "iframe":
      return "embed"
    case "freedraw":
      return "scribble"
    default:
      return "rectangle"
  }
}

function canContain(kind: NodeKind): boolean {
  return (
    kind === "rectangle" ||
    kind === "diamond" ||
    kind === "ellipse" ||
    kind === "image" ||
    kind === "embed"
  )
}

function frameFor(
  el: ExcalidrawElement,
  box: Box,
  frameBoxes: Map<string, Box>
): string | null {
  if (el.frameId && frameBoxes.has(el.frameId)) return el.frameId
  let best: string | null = null
  let bestArea = Infinity
  for (const [id, fbox] of frameBoxes) {
    if (coverage(box, fbox) >= CONTAINMENT && area(fbox) < bestArea) {
      best = id
      bestArea = area(fbox)
    }
  }
  return best
}

/** Bounding box in scene pixels. Linear and freedraw elements are measured from their points. */
export function boxOf(el: ExcalidrawElement): Box {
  if (el.type === "arrow" || el.type === "line" || el.type === "freedraw") {
    const pts = (el as Linear | FreeDraw).points
    if (pts.length === 0) return { x: el.x, y: el.y, w: 0, h: 0 }
    let x1 = Infinity
    let y1 = Infinity
    let x2 = -Infinity
    let y2 = -Infinity
    for (const [px, py] of pts) {
      x1 = Math.min(x1, px)
      y1 = Math.min(y1, py)
      x2 = Math.max(x2, px)
      y2 = Math.max(y2, py)
    }
    return { x: el.x + x1, y: el.y + y1, w: x2 - x1, h: y2 - y1 }
  }
  return { x: el.x, y: el.y, w: el.width, h: el.height }
}

function cleanLabel(el: TextEl): string | null {
  const raw = (el.originalText || el.text || "").replace(/\s+/g, " ").trim()
  if (!raw) return null
  return raw.length > LABEL_MAX ? raw.slice(0, LABEL_MAX - 1) + "…" : raw
}

function relationTo(
  box: Box,
  siblings: GraphNode[],
  boxOfNode: Map<string, Box>
): string | null {
  const tolY = box.h * 0.1
  const tolX = box.w * 0.1
  let above: GraphNode | null = null
  let aboveBottom = -Infinity
  let left: GraphNode | null = null
  let leftRight = -Infinity
  for (const s of siblings) {
    const sb = boxOfNode.get(s.id)!
    if (
      sb.y + sb.h <= box.y + tolY &&
      overlapX(sb, box) > 0 &&
      sb.y + sb.h > aboveBottom
    ) {
      above = s
      aboveBottom = sb.y + sb.h
    }
    if (
      sb.x + sb.w <= box.x + tolX &&
      overlapY(sb, box) > 0 &&
      sb.x + sb.w > leftRight
    ) {
      left = s
      leftRight = sb.x + sb.w
    }
  }
  if (above) return `below ${above.id}`
  if (left) return `right of ${left.id}`
  return null
}

function sortIds(ids: string[], nodeIds: Set<string>): string[] {
  return [...new Set(ids)].sort((a, b) => {
    const an = nodeIds.has(a) ? 0 : 1
    const bn = nodeIds.has(b) ? 0 : 1
    return an - bn || compareIds(a, b)
  })
}

function compareIds(a: string, b: string): number {
  const [, ap, an] = /^([a-z]+)(\d+)$/.exec(a) ?? [, a, "0"]
  const [, bp, bn] = /^([a-z]+)(\d+)$/.exec(b) ?? [, b, "0"]
  return ap!.localeCompare(bp!) || Number(an) - Number(bn)
}
