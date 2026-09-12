import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"

export type { ExcalidrawElement }

/** Axis-aligned box in scene pixels. */
export type Box = { x: number; y: number; w: number; h: number }

/** Coarse 0–100 box relative to the enclosing container (frame or root). */
export type GridBox = { x: number; y: number; w: number; h: number }

export type NodeKind =
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "text"
  | "note"
  | "image"
  | "embed"
  | "scribble"

export type GraphNode = {
  id: string
  sourceId: string
  kind: NodeKind
  label: string | null
  /** Short id of the frame this node lives in, or null for root. */
  frame: string | null
  /** Short id of the nearest geometric container (non-frame) or null. */
  parent: string | null
  box: GridBox
  /** One relative-position hint against a sibling, e.g. "below r3". */
  relation: string | null
  /** Scribble-only: short id of the node the stroke crosses or sits near. */
  touches: { id: string; through: boolean } | null
}

export type GraphFrame = {
  id: string
  sourceId: string
  label: string | null
  /** Box on the root grid. */
  box: GridBox
}

export type GraphArrow = {
  id: string
  sourceId: string
  from: string | null
  to: string | null
  /** Root-grid position of an unbound endpoint, for "loose end at". */
  looseStart: GridBox | null
  looseEnd: GridBox | null
  label: string | null
  bidirectional: boolean
  /** Plain line with no arrowheads — an undirected connector. */
  undirected: boolean
  elbowed: boolean
}

export type GraphGroup = {
  id: string
  sourceId: string
  members: string[]
}

export type SceneGraph = {
  frames: GraphFrame[]
  nodes: GraphNode[]
  arrows: GraphArrow[]
  groups: GraphGroup[]
}

export type SerializedScene = {
  /** The compact text the model reads. */
  text: string
  /** Short id → Excalidraw element id (groups map to group ids). */
  idMap: Record<string, string>
  graph: SceneGraph
}
