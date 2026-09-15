import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { convertToExcalidrawElements } from "@excalidraw/excalidraw"

import type { EditOp } from "@/lib/llm/interview"
import type { Box } from "@/lib/serializer"

import { audit, layoutScene } from "./layout"
import { tidy, type Measure } from "./tidy"

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
  /** Text metrics for the tidy pass; defaults to a canvas measurement. */
  measure?: Measure
}

export type ApplyResult = {
  elements: ExcalidrawElement[]
  /** Excalidraw ids of everything added or changed — for highlighting. */
  changedIds: string[]
  /** Ops that could not be applied, in plain words. */
  skipped: string[]
  /** The tidy pass was not enough and the whole drawing was laid out again. */
  relaid: boolean
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
  // Which way each added box was placed, so the tidy pass pushes neighbours that way.
  const seeds = new Map<string, { dx: number; dy: number }>()

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
        const box = placeNextTo(anchor.box, op.place.relative)
        const id = randomId()
        seeds.set(id, DIRECTION[op.place.relative])
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
        const { arrow, created } = buildArrow(convert, from, to, {
          label: op.label,
          bidirectional: op.bidirectional,
        })
        if (!arrow) break
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
        // Already gone with something deleted earlier in this batch (an
        // arrow follows its node): nothing to report.
        if (old.isDeleted) break
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
            // An arrow that loses an end is junk in a diagram: it goes too, label and all.
            if (
              arrow.startBinding?.elementId === old.id ||
              arrow.endBinding?.elementId === old.id
            ) {
              touch(arrow).isDeleted = true
              const arrowLabel = boundText(arrow.id)
              if (arrowLabel) touch(arrowLabel).isDeleted = true
            }
          }
          if (el.frameId === old.id) touch(el).frameId = null
        }
        break
      }
    }
  }

  // Breathing room: size boxes for their labels, push neighbours, route arrows.
  const all = [...byId.values(), ...added]
  const measure = input.measure ?? measureText
  tidy(all, changed, measure, seeds)
  // Check the work: if arrows still cut through boxes or labels sit on
  // shapes, lay the whole drawing out again rather than leave it messy.
  let relaid = false
  if (audit(all).length > 0) {
    relaid = layoutScene(all, measure).length > 0
  }

  return {
    elements: all,
    changedIds: [...changed].filter((id) => !byId.get(id)?.isDeleted),
    skipped,
    relaid,
  }
}

// Excalidraw's font family ids → the faces it registers.
const FONT_NAMES: Record<number, string> = {
  1: "Virgil",
  2: "Helvetica",
  3: "Cascadia",
  5: "Excalifont",
  6: "Nunito",
  7: "Lilita One",
  8: "Comic Shanns",
  9: "Liberation Sans",
}

let canvasCtx: CanvasRenderingContext2D | null | undefined

/** Text metrics from a canvas when there is one; a width estimate otherwise. */
export const measureText: Measure = (text, fontSize, fontFamily) => {
  const lineH = fontSize * 1.25
  if (canvasCtx === undefined) {
    canvasCtx =
      typeof document === "undefined"
        ? null
        : document.createElement("canvas").getContext("2d")
  }
  if (canvasCtx) {
    canvasCtx.font = `${fontSize}px ${FONT_NAMES[fontFamily] ?? "Excalifont"}, sans-serif`
    const w = Math.max(
      ...text.split("\n").map((line) => canvasCtx!.measureText(line).width)
    )
    return { w: Math.ceil(w), h: lineH * text.split("\n").length }
  }
  const longest = Math.max(...text.split("\n").map((l) => l.length))
  return {
    w: Math.ceil(longest * fontSize * 0.6),
    h: lineH * text.split("\n").length,
  }
}

type Relative = Extract<EditOp, { op: "add" }>["place"]["relative"]

/** Next to `of` in the given direction, stepping further out until nothing overlaps. */
const DIRECTION: Record<Relative, { dx: number; dy: number }> = {
  right: { dx: 1, dy: 0 },
  left: { dx: -1, dy: 0 },
  above: { dx: 0, dy: -1 },
  below: { dx: 0, dy: 1 },
  inside: { dx: 0, dy: 0 },
}

/**
 * The spot right next to `of`. Whatever is already there gets pushed out of
 * the way by the tidy pass, in the same direction — so "below X" inserts a
 * row rather than skipping to the bottom of the drawing.
 */
function placeNextTo(of: Box, relative: Relative): Box {
  const w = Math.min(Math.max(of.w, 120), 260)
  const h = Math.min(Math.max(of.h, 50), 120)
  if (relative === "inside") {
    const iw = Math.max(100, Math.min(of.w * 0.6, DEFAULT_W))
    const ih = Math.max(40, Math.min(of.h * 0.35, DEFAULT_H))
    return { x: of.x + (of.w - iw) / 2, y: of.y + of.h * 0.3, w: iw, h: ih }
  }
  const { dx, dy } = DIRECTION[relative]
  return {
    x:
      dx === 0
        ? of.x + (of.w - w) / 2
        : of.x + dx * (dx > 0 ? of.w + GAP : GAP + w),
    y:
      dy === 0
        ? of.y + (of.h - h) / 2
        : of.y + dy * (dy > 0 ? of.h + GAP : GAP + h),
    w,
    h,
  }
}

/** Edge midpoints facing each other, plus the matching fixedPoint for each binding. */
/**
 * `t` slides the attachment along the facing edges (0.5 = centre), so two
 * arrows between the same boxes can run side by side instead of on top of
 * each other.
 */
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
  const dx = b.x + b.w / 2 - (a.x + a.w / 2)
  const dy = b.y + b.h / 2 - (a.y + a.h / 2)
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

/**
 * A bound arrow between two boxes, made by hand because the converter only
 * binds to elements created in the same call. Callers add the arrow to the
 * endpoints' `boundElements` themselves.
 */
export function buildArrow(
  convert: Convert,
  from: { id: string; box: Box },
  to: { id: string; box: Box },
  opts: { label: string | null; bidirectional: boolean; offset?: number }
): {
  arrow: Mutable<Extract<ExcalidrawElement, { type: "arrow" }>> | undefined
  created: Mutable<ExcalidrawElement>[]
} {
  const [start, end, startPoint, endPoint] = anchors(
    from.box,
    to.box,
    opts.offset ?? 0.5
  )
  const id = randomId()
  const created = convert(
    [
      {
        type: "arrow",
        id,
        x: start.x,
        y: start.y,
        points: [
          [0, 0],
          [end.x - start.x, end.y - start.y],
        ],
        startArrowhead: opts.bidirectional ? "arrow" : null,
        endArrowhead: "arrow",
        ...(opts.label ? { label: { text: opts.label } } : {}),
      } as unknown as Skeleton,
    ],
    { regenerateIds: false }
  ).map((el) => ({ ...el, index: null })) as Mutable<ExcalidrawElement>[]
  const arrow = created.find((el) => el.id === id) as
    Mutable<Extract<ExcalidrawElement, { type: "arrow" }>> | undefined
  if (arrow) {
    arrow.startBinding = {
      elementId: from.id,
      fixedPoint: startPoint,
      mode: "orbit",
    }
    arrow.endBinding = { elementId: to.id, fixedPoint: endPoint, mode: "orbit" }
  }
  return { arrow, created }
}

export function randomElementId(): string {
  return randomId()
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
