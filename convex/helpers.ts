// Shared by the "use node" actions only (Buffer is Node-specific).
import type { HistoryEntry } from "../lib/llm/interview"
import type { Doc, Id } from "./_generated/dataModel"
import type { ActionCtx } from "./_generated/server"

export async function loadPng(ctx: ActionCtx, id: Id<"_storage">) {
  const blob = await ctx.storage.get(id)
  if (!blob) return null
  const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64")
  return { base64, mediaType: blob.type || "image/png" }
}

/** Interview turns as the LLM modules expect them (role/kind flattened back out). */
export function toHistory(turns: Doc<"interviews">["turns"]): HistoryEntry[] {
  return turns.map((t) => {
    if (t.role === "user") return { role: "user", answer: t.answer }
    if (t.kind === "question") {
      const { text, options, reason, elementIds } = t
      return {
        role: "assistant",
        turn: { kind: "question", text, options, reason, elementIds },
      }
    }
    return { role: "assistant", turn: { kind: "done", summary: t.summary } }
  })
}

/** Every short id the serializer emitted, so cited ids can be validated. */
export function graphIds(graph: string): string[] {
  return Array.from(graph.matchAll(/^\s*([a-z]\d+)\b/gm), (m) => m[1])
}
