import { formatGraph } from "./format"
import { buildGraph } from "./graph"
import type { ExcalidrawElement, SerializedScene } from "./types"

export type * from "./types"

/**
 * Turn an Excalidraw scene into the compact graph the interviewer reads.
 * Deterministic: the same elements always produce the same text and id map.
 */
export function serializeScene(
  elements: readonly ExcalidrawElement[]
): SerializedScene {
  const { graph, idMap } = buildGraph(elements)
  return { text: formatGraph(graph), idMap, graph }
}

/** Stable hash of the serialized text — the interview's `sceneHash`. */
export async function hashScene(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("")
}
