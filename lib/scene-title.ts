import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"

const MAX = 40

/**
 * A name for the project read off the drawing: the largest free-standing text
 * (a title, usually), first line only. Null when there is no such text.
 */
export function sceneTitle(
  elements: readonly ExcalidrawElement[]
): string | null {
  let best: { size: number; y: number; text: string } | null = null
  for (const el of elements) {
    if (el.isDeleted || el.type !== "text" || el.containerId) continue
    const line = el.text.split("\n")[0]?.trim() ?? ""
    if (line.length < 2) continue
    const cand = { size: el.fontSize, y: el.y, text: line }
    if (
      !best ||
      cand.size > best.size ||
      (cand.size === best.size && cand.y < best.y)
    ) {
      best = cand
    }
  }
  if (!best) return null
  return best.text.length > MAX
    ? best.text.slice(0, MAX - 1).trimEnd() + "…"
    : best.text
}
