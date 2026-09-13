import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { convertToExcalidrawElements } from "@excalidraw/excalidraw"

import type { Sketch } from "@/lib/llm/sketch"
import type { Box } from "@/lib/serializer"

import { buildArrow, randomElementId } from "./apply"

type Convert = typeof convertToExcalidrawElements
type Skeleton = Parameters<Convert>[0] extends (infer S)[] | null ? S : never
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** Where a sketch lands on the canvas. */
export type SketchPlacement = {
  /** Left/top in scene pixels and the pixel width the sketch's grid maps to. */
  x: number
  y: number
  width: number
}

/**
 * Turn a sketch into Excalidraw elements. The grid's longer side maps to
 * `placement.width` pixels; the other axis follows the sketch's aspect.
 */
export function applySketch(
  sketch: Sketch,
  placement: SketchPlacement,
  convert: Convert
): { elements: Mutable<ExcalidrawElement>[]; ids: string[] } {
  const boxes = layout(sketch, placement)
  const byRef = new Map<string, { id: string; box: Box }>()
  const elements: Mutable<ExcalidrawElement>[] = []

  for (const n of sketch.nodes) {
    const id = randomElementId()
    const box = boxes.get(n.ref)!
    const skeleton: Skeleton =
      n.type === "text"
        ? { type: "text", id, text: n.label || " ", x: box.x, y: box.y }
        : {
            type: n.type,
            id,
            x: box.x,
            y: box.y,
            width: box.w,
            height: box.h,
            ...(n.label ? { label: { text: n.label } } : {}),
          }
    const created = convert([skeleton], { regenerateIds: false }).map((el) => ({
      ...el,
      index: null,
    })) as Mutable<ExcalidrawElement>[]
    const main = created.find((el) => el.id === id) ?? created[0]
    if (!main) continue
    byRef.set(n.ref, {
      id: main.id,
      box: { x: main.x, y: main.y, w: main.width, h: main.height },
    })
    elements.push(...created)
  }

  for (const a of sketch.arrows) {
    const from = byRef.get(a.from)
    const to = byRef.get(a.to)
    if (!from || !to) continue
    const { arrow, created } = buildArrow(convert, from, to, {
      label: a.label,
      bidirectional: a.bidirectional,
    })
    if (!arrow) continue
    for (const end of [from, to]) {
      const target = elements.find((el) => el.id === end.id)
      if (!target) continue
      target.boundElements = [
        ...(target.boundElements ?? []),
        { id: arrow.id, type: "arrow" },
      ]
    }
    elements.push(...created)
  }

  return { elements, ids: elements.map((el) => el.id) }
}

const GAP = 32
/** Excalidraw's default label font is ~20 px; this is a rough advance width. */
const CHAR_W = 11

/**
 * Grid → pixels, then two corrections the model cannot be trusted with: every
 * box is at least big enough for its label, and the whole layout is spread
 * (positions scaled up, sizes kept) until no two boxes touch.
 */
function layout(sketch: Sketch, placement: SketchPlacement): Map<string, Box> {
  const base = placement.width / Math.max(sketch.canvas.w, sketch.canvas.h)
  const minSize = (n: Sketch["nodes"][number]) => {
    if (n.type === "text") return { w: 0, h: 0 }
    const longest = Math.max(
      ...n.label.split(String.fromCharCode(10)).map((l) => l.length),
      1
    )
    const lines = n.label.split(String.fromCharCode(10)).length
    return { w: longest * CHAR_W + 40, h: lines * 28 + 28 }
  }
  for (let spread = 1; ; spread *= 1.15) {
    const out = new Map<string, Box>()
    for (const n of sketch.nodes) {
      const min = minSize(n)
      const w = Math.max(min.w, n.w * base, 40)
      const h = Math.max(min.h, n.h * base, 24)
      // Grow around the centre the model chose, so alignment survives.
      const cx = placement.x + (n.x + n.w / 2) * base * spread
      const cy = placement.y + (n.y + n.h / 2) * base * spread
      out.set(n.ref, { x: cx - w / 2, y: cy - h / 2, w, h })
    }
    const list = [...out.values()]
    const crowded = list.some((a, i) =>
      list.some(
        (b, j) =>
          j > i &&
          a.x < b.x + b.w + GAP &&
          b.x < a.x + a.w + GAP &&
          a.y < b.y + b.h + GAP &&
          b.y < a.y + a.h + GAP
      )
    )
    if (!crowded || spread > 2.5) return out
  }
}

/**
 * Pick a spot. "add": below everything that exists. "replace": the shapes
 * are going away, so sit below whatever stays (pictures, frames) — or where
 * the shapes were when nothing stays. At least 900 px wide so it is legible.
 */
export function placeSketch(
  existing: readonly ExcalidrawElement[],
  mode: "add" | "replace"
): SketchPlacement {
  const live = existing.filter((el) => !el.isDeleted)
  if (live.length === 0) return { x: 0, y: 0, width: 1100 }
  const bounds = (els: readonly ExcalidrawElement[]) => ({
    x1: Math.min(...els.map((el) => el.x)),
    y1: Math.min(...els.map((el) => el.y)),
    x2: Math.max(...els.map((el) => el.x + el.width)),
    y2: Math.max(...els.map((el) => el.y + el.height)),
  })
  const all = bounds(live)
  const width = Math.max(1100, all.x2 - all.x1)
  if (mode === "add") return { x: all.x1, y: all.y2 + 120, width }
  const staying = live.filter(
    (el) =>
      el.type === "image" || el.type === "frame" || el.type === "magicframe"
  )
  if (staying.length === 0) return { x: all.x1, y: all.y1, width }
  const keep = bounds(staying)
  return {
    x: keep.x1,
    y: keep.y2 + 120,
    width: Math.max(1100, keep.x2 - keep.x1),
  }
}
