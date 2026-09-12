import type { GraphArrow, GraphNode, GridBox, SceneGraph } from "./types"

export function formatGraph(graph: SceneGraph): string {
  const { frames, nodes, arrows, groups } = graph
  if (frames.length === 0 && nodes.length === 0 && arrows.length === 0) {
    return "scene: empty"
  }

  const out: string[] = []
  out.push(
    `scene: ${count(frames.length, "frame")}, ${count(nodes.length, "node")}, ${count(arrows.length, "arrow")}, ${count(groups.length, "group")}. ` +
      "coords [x,y w×h] on a 0–100 grid of the enclosing frame (root otherwise); y grows down."
  )

  for (const f of frames) {
    out.push("")
    out.push(`${f.id} frame${quote(f.label)} ${box(f.box)}`)
    out.push(...nodeTree(nodes.filter((n) => n.frame === f.id)))
  }

  const rootNodes = nodes.filter((n) => n.frame === null)
  if (rootNodes.length > 0) {
    out.push("")
    out.push("root")
    out.push(...nodeTree(rootNodes))
  }

  if (arrows.length > 0) {
    out.push("")
    out.push("arrows")
    for (const a of arrows) out.push(`  ${arrowLine(a)}`)
  }

  if (groups.length > 0) {
    out.push("")
    out.push("groups")
    for (const g of groups) out.push(`  ${g.id}: ${g.members.join(" ")}`)
  }

  return out.join("\n")
}

function nodeTree(nodes: GraphNode[]): string[] {
  const lines: string[] = []
  const children = new Map<string | null, GraphNode[]>()
  for (const n of nodes) {
    const list = children.get(n.parent) ?? []
    list.push(n)
    children.set(n.parent, list)
  }
  const walk = (parent: string | null, depth: number) => {
    for (const n of children.get(parent) ?? []) {
      lines.push("  ".repeat(depth + 1) + nodeLine(n))
      walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  return lines
}

function nodeLine(n: GraphNode): string {
  if (n.kind === "scribble") {
    const where = n.touches
      ? ` ${n.touches.through ? "through" : "near"} ${n.touches.id}`
      : ""
    return `${n.id} scribble${where} ${box(n.box)}`
  }
  const parts = [`${n.id} ${n.kind}${quote(n.label)}`, box(n.box)]
  if (n.parent) parts.push(`inside ${n.parent}`)
  if (n.relation) parts.push(n.relation)
  return parts.join(" ")
}

function arrowLine(a: GraphArrow): string {
  const end = (id: string | null, loose: GridBox | null) =>
    id ?? (loose ? `? loose end at [${loose.x},${loose.y}]` : "?")
  const connector = a.undirected ? "--" : a.bidirectional ? "<->" : "->"
  const parts = [
    `${a.id} ${end(a.from, a.looseStart)} ${connector} ${end(a.to, a.looseEnd)}`,
  ]
  if (a.label) parts.push(`"${a.label}"`)
  if (a.elbowed) parts.push("(elbowed)")
  return parts.join(" ")
}

function box(b: GridBox): string {
  return `[${b.x},${b.y} ${b.w}×${b.h}]`
}

function quote(label: string | null): string {
  return label ? ` "${label.replace(/"/g, '\\"')}"` : ""
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}
