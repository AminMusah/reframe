"use node"

import { ConvexError, v } from "convex/values"

import {
  InterviewError,
  interviewTurn,
  type HistoryEntry,
} from "../lib/llm/interview"
import { isModelId } from "../lib/llm/models"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { action, type ActionCtx } from "./_generated/server"

/**
 * Run one interview turn. With `answer`, records it first (phase 1); without,
 * runs the model for a fresh or errored interview. The key is used for this
 * call only and never written anywhere.
 */
export const step = action({
  args: {
    interviewId: v.id("interviews"),
    apiKey: v.string(),
    answer: v.optional(v.string()),
  },
  handler: async (ctx, { interviewId, apiKey, answer }) => {
    if (answer !== undefined) {
      await ctx.runMutation(api.interviews.submitAnswer, {
        id: interviewId,
        answer,
      })
    }
    // Ownership is enforced by the query; the action never touches the DB directly.
    const interview = await ctx.runQuery(api.interviews.get, {
      id: interviewId,
    })
    if (interview.status === "error") {
      await ctx.runMutation(api.interviews.retry, { id: interviewId })
    } else if (interview.status !== "thinking") {
      throw new ConvexError({
        code: "not_thinking",
        message: "Interview is not waiting on the model",
      })
    }

    const png = interview.pngFileId
      ? await loadPng(ctx, interview.pngFileId)
      : null
    const history: HistoryEntry[] = interview.turns.map((t) => {
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

    try {
      const turn = await interviewTurn({
        apiKey,
        model: isModelId(interview.model) ? interview.model : undefined,
        graph: interview.graph,
        png,
        history,
        validIds: graphIds(interview.graph),
      })
      await ctx.runMutation(internal.interviews.appendAssistantTurn, {
        id: interviewId,
        turn: { role: "assistant", ...turn },
      })
      return turn
    } catch (err) {
      const code = err instanceof InterviewError ? err.code : "network"
      await ctx.runMutation(internal.interviews.setError, {
        id: interviewId,
        code,
      })
      return { kind: "error" as const, code }
    }
  },
})

async function loadPng(ctx: ActionCtx, id: Id<"_storage">) {
  const blob = await ctx.storage.get(id)
  if (!blob) return null
  const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64")
  return { base64, mediaType: blob.type || "image/png" }
}

/** Every short id the serializer emitted, so cited ids can be validated. */
function graphIds(graph: string): string[] {
  return Array.from(graph.matchAll(/^\s*([a-z]\d+)\b/gm), (m) => m[1])
}
