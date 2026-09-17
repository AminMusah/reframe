// loadPng and toHistory are for the "use node" actions (Buffer); deleteFile is for mutations too.
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
        turn: {
          kind: "question",
          text,
          options,
          reason,
          elementIds,
          ops: t.ops ?? [],
          change: t.change ?? null,
        },
      }
    }
    if (t.kind === "edit") {
      return {
        role: "assistant",
        turn: { kind: "edit", text: t.text, ops: t.ops },
      }
    }
    if (t.kind === "sketch") {
      const { text, instruction, mode } = t
      return {
        role: "assistant",
        turn: { kind: "sketch", text, instruction, mode },
      }
    }
    return { role: "assistant", turn: { kind: "done", summary: t.summary } }
  })
}

/** Every short id the serializer emitted, so cited ids can be validated. */
export function graphIds(graph: string): string[] {
  return Array.from(graph.matchAll(/^\s*([a-z]\d+)\b/gm), (m) => m[1])
}

/**
 * Delete a stored file if it still exists. A reference can outlive its file
 * (an interview PNG replaced on rebase, an old scene), and `storage.delete`
 * throws on a missing id — which must not sink the mutation around it.
 */
export async function deleteFile(
  ctx: { storage: { delete: (id: Id<"_storage">) => Promise<void> } },
  id: Id<"_storage">
): Promise<void> {
  try {
    await ctx.storage.delete(id)
  } catch {
    // Already gone.
  }
}
