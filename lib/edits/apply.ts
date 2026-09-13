import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { convertToExcalidrawElements } from "@excalidraw/excalidraw"

import type { EditOp } from "@/lib/llm/interview"
import type { Box } from "@/lib/serializer"

type Convert = typeof convertToExcalidrawElements
type Skeleton = Parameters<Convert>[0] extends (infer S)[] | null ? S : never
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

export type ApplyInput = {
  elements: readonly ExcalidrawElement[]
  ops: EditOp[]
  /** Short id → Excalidraw id, from the serializer. */
  idMap: Record<string, string>
  /** Short id → scene-pixel box, from the serializer. */
  boxes: Record<string, Box>
  convert: Convert
}

export type ApplyResult = {
  elements: ExcalidrawElement[]
  /** Excalidraw ids of everything added or changed — for highlighting. */
  changedIds: string[]
  /** Ops that could not be applied, in plain words. */
  skipped: string[]
}

const GAP = 60
const DEFAULT_W = 180
const DEFAULT_H = 80

/**
 * Turn an edit turn's ops into a new element list. Existing elements are
 * cloned with bumped versions; new ones come from convertToExcalidrawElements
 * with ids we choose, so refs inside the edit resolve. Arrows are bound by
 * hand (the converter only binds to elements from the same call).
 */
export function applyEdit(input: ApplyInput): ApplyResult {
  const { ops, idMap, boxes, convert } = input
  const byId = new Map<string, Mutable<ExcalidrawElement>>(
    input.elements.map((el) => [el.id, { ...el } as Mutable<ExcalidrawElement>])
  )
  const added: Mutable<ExcalidrawElement>[] = []
  const refs = new Map<string, { id: string; box: Box }>()
  const changed = new Set<string>()
  const skipped: string[] = []

  const touch = (el: Mutable<ExcalidrawElement>) => {
    el.version += 1
    el.versionNonce = Math.floor(Math.random() * 2 ** 31)
    el.updated = Date.now()
    changed.add(el.id)
    return el
  }
  const resolve = (ref: string): { id: string; box: Box } | null => {
    const fresh = refs.get(ref)
    if (fresh) return fresh
    const id = idMap[ref]
    const box = boxes[ref]
    return id && box && byId.has(id) ? { id, box } : null
  }
  const boundText = (containerId: string) =>
    [...byId.values()].find(
      (el) =>
        el.type === "text" && el.containerId === containerId && !el.isDeleted
    )
  const create = (skeleton: Skeleton) =>
    convert([skeleton], { regenerateIds: false }).map((el) => ({
      ...el,
      index: null,
    })) as Mutable<ExcalidrawElement>[]

  for (const op of ops) {
    switch (op.op) {
      case "add": {
        const anchor = resolve(op.place.of)
        if (!anchor) {
          skipped.push(`add "${op.label}": ${op.place.of} not found`)
          break
        }
        const occupied = [
          ...Object.values(boxes),
          ...[...refs.values()].map((r) => r.box),
        ]
        const box = placeNextTo(anchor.box, op.place.relative, occupied)
        const id = randomId()
        const skeleton: Skeleton =
          op.type === "text"
            ? { type: "text", id, text: op.label, x: box.x, y: box.y }
            : {
                type: op.type,
                id,
                x: box.x,
                y: box.y,
                width: box.w,
                height: box.h,
                label: { text: op.label },
              }
        const created = create(skeleton)
        added.push(...created)
        for (const el of created) changed.add(el.id)
        const main = created.find((el) => el.id === id) ?? created[0]
        refs.set(op.ref, {
          id: main.id,
          box: { x: main.x, y: main.y, w: main.width, h: main.height },
        })
        break
      }
      case "connect": {
        const from = resolve(op.from)
        const to = resolve(op.to)
        if (!from || !to) {
          skipped.push(`connect ${op.from} → ${op.to}: element not found`)
          break
        }
        if (isLinear(byId.get(from.id)) || isLinear(byId.get(to.id))) {
          skipped.push(
            `connect ${op.from} → ${op.to}: arrows can only join shapes`
          )
          break
        }
        const [start, end, startPoint, endPoint] = anchors(from.box, to.box)
        const id = randomId()
        const created = create({
          type: "arrow",
          id,
          x: start.x,
          y: start.y,
          points: [
            [0, 0],
            [end.x - start.x, end.y - start.y],
          ],
          startArrowhead: op.bidirectional ? "arrow" : null,
          endArrowhead: "arrow",
          ...(op.label ? { label: { text: op.label } } : {}),
        } as unknown as Skeleton)
        const arrow = created.find((el) => el.id === id) as
          Mutable<Extract<ExcalidrawElement, { type: "arrow" }>> | undefined
        if (!arrow) break
        arrow.startBinding = {
          elementId: from.id,
          fixedPoint: startPoint,
          mode: "orbit",
        }
        arrow.endBinding = {
          elementId: to.id,
          fixedPoint: endPoint,
          mode: "orbit",
        }
        for (const endId of [from.id, to.id]) {
          const target = byId.get(endId) ?? added.find((el) => el.id === endId)
          if (!target) continue
          target.boundElements = [
            ...(target.boundElements ?? []).filter((b) => b.id !== arrow.id),
            { id: arrow.id, type: "arrow" },
          ]
          if (byId.has(endId)) touch(target)
        }
        added.push(...created)
        for (const el of created) changed.add(el.id)
        break
      }
      case "update": {
        const target = resolve(op.id)
        const old = target && byId.get(target.id)
        if (!old) {
          skipped.push(`rename ${op.id}: not found`)
          break
        }
        if (old.type === "frame" || old.type === "magicframe") {
          ;(
            touch(old) as Mutable<Extract<ExcalidrawElement, { type: "frame" }>>
          ).name = op.label
          break
        }
        if (old.type === "text") {
          const t = touch(old) as Mutable<
            Extract<ExcalidrawElement, { type: "text" }>
          >
          t.text = op.label
          t.originalText = op.label
          break
        }
        if (isLinear(old)) {
          const label = boundText(old.id) as
            Mutable<Extract<ExcalidrawElement, { type: "text" }>> | undefined
          if (!label) {
            skipped.push(`rename ${op.id}: this arrow has no label to change`)
            break
          }
          touch(label)
          label.text = op.label
          label.originalText = op.label
          break
        }
        if (
          old.type !== "rectangle" &&
          old.type !== "ellipse" &&
          old.type !== "diamond"
        ) {
          skipped.push(
            `rename ${op.id}: only shapes, text and frames can be renamed`
          )
          break
        }
        // Rebuild the shape with the same id so bound arrows keep pointing at it;
        // the converter measures and centres the new label for us.
        const created = create({
          type: old.type,
          id: old.id,
          x: old.x,
          y: old.y,
          width: old.width,
          height: old.height,
          strokeColor: old.strokeColor,
          backgroundColor: old.backgroundColor,
          fillStyle: old.fillStyle,
          strokeWidth: old.strokeWidth,
          strokeStyle: old.strokeStyle,
          roughness: old.roughness,
          roundness: old.roundness,
          label: { text: op.label },
        } as Skeleton)
        const shape = created.find((el) => el.id === old.id)
        const text = created.find((el) => el.type === "text")
        if (!shape) break
        const prevText = boundText(old.id)
        if (prevText) touch(prevText).isDeleted = true
        Object.assign(shape, {
          version: old.version + 1,
          versionNonce: Math.floor(Math.random() * 2 ** 31),
          groupIds: old.groupIds,
          frameId: old.frameId,
          index: old.index,
          boundElements: [
            ...(old.boundElements ?? []).filter((b) => b.type !== "text"),
            ...(text ? [{ id: text.id, type: "text" as const }] : []),
          ],
        })
        byId.set(old.id, shape)
        if (text) {
          ;(text as Mutable<ExcalidrawElement>).frameId = old.frameId
          added.push(text as Mutable<ExcalidrawElement>)
        }
        changed.add(old.id)
        break
      }
      case "delete": {
        const target = resolve(op.id)
        const old = target && byId.get(target.id)
        if (!old) {
          skipped.push(`delete ${op.id}: not found`)
          break
        }
        touch(old).isDeleted = true
        const label = boundText(old.id)
        if (label) touch(label).isDeleted = true
        for (const el of byId.values()) {
          if (el.isDeleted) continue
          if (el.boundElements?.some((b) => b.id === old.id)) {
            touch(el).boundElements = el.boundElements!.filter(
              (b) => b.id !== old.id
            )
          }
          if ((el.type === "arrow" || el.type === "line") && !el.isDeleted) {
            const arrow = el as Mutable<
              Extract<ExcalidrawElement, { type: "arrow" }>
            >
            let hit = false
            if (arrow.startBinding?.elementId === old.id) {
              arrow.startBinding = null
              hit = true
            }
            if (arrow.endBinding?.elementId === old.id) {
              arrow.endBinding = null
              hit = true
            }
            if (hit) touch(arrow)
          }
          if (el.frameId === old.id) touch(el).frameId = null
        }
        break
      }
    }
  }

  return {
    elements: [...byId.values(), ...added],
    changedIds: [...changed].filter((id) => !byId.get(id)?.isDeleted),
    skipped,
  }
}

type Relative = Extract<EditOp, { op: "add" }>["place"]["relative"]

/** Next to `of` in the given direction, stepping further out until nothing overlaps. */
function placeNextTo(of: Box, relative: Relative, occupied: Box[]): Box {
  const w = Math.min(Math.max(of.w, 120), 260)
  const h = Math.min(Math.max(of.h, 50), 120)
  if (relative === "inside") {
    const iw = Math.max(100, Math.min(of.w * 0.6, DEFAULT_W))
    const ih = Math.max(40, Math.min(of.h * 0.35, DEFAULT_H))
    return { x: of.x + (of.w - iw) / 2, y: of.y + of.h * 0.3, w: iw, h: ih }
  }
  const step: Record<Exclude<Relative, "inside">, [number, number]> = {
    right: [1, 0],
    left: [-1, 0],
    above: [0, -1],
    below: [0, 1],
  }
  const [sx, sy] = step[relative]
  let box: Box = {
    x: of.x + sx * (sx > 0 ? of.w + GAP : GAP + w),
    y: of.y + sy * (sy > 0 ? of.h + GAP : GAP + h),
    w,
    h,
  }
  // Containers legitimately overlap what they contain; only dodge boxes that
  // are not much bigger than the new one.
  const blockers = occupied.filter((b) => b.w * b.h < box.w * box.h * 4)
  for (let i = 0; i < 6 && blockers.some((b) => overlaps(b, box)); i++) {
    box = { ...box, x: box.x + sx * (w + GAP), y: box.y + sy * (h + GAP) }
  }
  return box
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  )
}

/** Edge midpoints facing each other, plus the matching fixedPoint for each binding. */
function anchors(
  a: Box,
  b: Box
): [
  { x: number; y: number },
  { x: number; y: number },
  [number, number],
  [number, number],
] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2)
  const dy = b.y + b.h / 2 - (a.y + a.h / 2)
  if (Math.abs(dx) >= Math.abs(dy)) {
    const right = dx >= 0
    return [
      { x: right ? a.x + a.w : a.x, y: a.y + a.h / 2 },
      { x: right ? b.x : b.x + b.w, y: b.y + b.h / 2 },
      [right ? 1 : 0, 0.5],
      [right ? 0 : 1, 0.5],
    ]
  }
  const down = dy >= 0
  return [
    { x: a.x + a.w / 2, y: down ? a.y + a.h : a.y },
    { x: b.x + b.w / 2, y: down ? b.y : b.y + b.h },
    [0.5, down ? 1 : 0],
    [0.5, down ? 0 : 1],
  ]
}

function isLinear(el: ExcalidrawElement | undefined): boolean {
  return el?.type === "arrow" || el?.type === "line"
}

function randomId(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  )
}

/** Plain-words summary of an op for the Accept/Undo card. */
export function describeOp(op: EditOp): string {
  switch (op.op) {
    case "add":
      return `Add ${op.type === "text" ? "text" : `a ${op.type}`} "${op.label}" ${op.place.relative === "inside" ? "inside" : `${op.place.relative} of`} ${op.place.of}`
    case "connect":
      return `Connect ${op.from} ${op.bidirectional ? "↔" : "→"} ${op.to}${op.label ? ` "${op.label}"` : ""}`
    case "update":
      return `Rename ${op.id} to "${op.label}"`
    case "delete":
      return `Delete ${op.id}`
  }
}
