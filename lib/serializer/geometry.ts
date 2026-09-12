import type { Box, GridBox } from "./types"

export const GRID = 100

export function union(boxes: readonly Box[]): Box {
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const b of boxes) {
    x1 = Math.min(x1, b.x)
    y1 = Math.min(y1, b.y)
    x2 = Math.max(x2, b.x + b.w)
    y2 = Math.max(y2, b.y + b.h)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export function area(b: Box): number {
  return Math.max(0, b.w) * Math.max(0, b.h)
}

export function intersection(a: Box, b: Box): Box {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) }
}

/** Fraction of `inner`'s area that lies within `outer`. Zero-area inner boxes use point containment. */
export function coverage(inner: Box, outer: Box): number {
  const ia = area(inner)
  if (ia === 0) {
    return containsPoint(outer, inner.x, inner.y) ? 1 : 0
  }
  return area(intersection(inner, outer)) / ia
}

export function containsPoint(b: Box, px: number, py: number): boolean {
  return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h
}

/** Euclidean distance from a point to a box; 0 when inside. */
export function distanceToBox(b: Box, px: number, py: number): number {
  const dx = Math.max(b.x - px, 0, px - (b.x + b.w))
  const dy = Math.max(b.y - py, 0, py - (b.y + b.h))
  return Math.hypot(dx, dy)
}

/** Shortest gap between two boxes; 0 when they overlap. */
export function boxGap(a: Box, b: Box): number {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0)
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0)
  return Math.hypot(dx, dy)
}

export function overlapX(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
}

export function overlapY(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
}

/** Map a scene box onto the 0–100 grid of `container`. Sizes are at least 1 unit. */
export function toGrid(b: Box, container: Box): GridBox {
  const sx = container.w > 0 ? GRID / container.w : 0
  const sy = container.h > 0 ? GRID / container.h : 0
  return {
    x: Math.round((b.x - container.x) * sx),
    y: Math.round((b.y - container.y) * sy),
    w: Math.max(1, Math.round(b.w * sx)),
    h: Math.max(1, Math.round(b.h * sy)),
  }
}

export function pointToGrid(px: number, py: number, container: Box): GridBox {
  return toGrid({ x: px, y: py, w: 0, h: 0 }, container)
}
