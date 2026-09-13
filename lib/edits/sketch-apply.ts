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
  const scale = placement.width / Math.max(sketch.canvas.w, sketch.canvas.h)
  const px = (v: number) => v * scale

  const byRef = new Map<string, { id: string; box: Box }>()
  const elements: Mutable<ExcalidrawElement>[] = []

  for (const n of sketch.nodes) {
    const id = randomElementId()
    const box: Box = {
      x: placement.x + px(n.x),
      y: placement.y + px(n.y),
      w: Math.max(40, px(n.w)),
      h: Math.max(24, px(n.h)),
    }
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
  if (live.length === 0) return { x: 0, y: 0, width: 900 }
  const bounds = (els: readonly ExcalidrawElement[]) => ({
    x1: Math.min(...els.map((el) => el.x)),
    y1: Math.min(...els.map((el) => el.y)),
    x2: Math.max(...els.map((el) => el.x + el.width)),
    y2: Math.max(...els.map((el) => el.y + el.height)),
  })
  const all = bounds(live)
  const width = Math.max(900, all.x2 - all.x1)
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
    width: Math.max(900, keep.x2 - keep.x1),
  }
}
