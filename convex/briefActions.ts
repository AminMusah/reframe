"use node"

import { v } from "convex/values"

import { briefAppendix, generateBrief } from "../lib/llm/brief"
import { LlmError, type ErrorCode } from "../lib/llm/errors"
import { isModelId } from "../lib/llm/models"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { action } from "./_generated/server"
import { briefTarget } from "./schema"
import { loadPng, toHistory } from "./helpers"

/** Flush the growing text to the doc at most this often. */
const FLUSH_MS = 250

/**
 * Stream a brief for a finished interview into a briefs doc. The client
 * calls this as soon as it sees the interview reach `done`; the key is used
 * for this call only.
 */
export const generate = action({
  args: {
    interviewId: v.id("interviews"),
    apiKey: v.string(),
    target: briefTarget,
    regenerate: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { interviewId, apiKey, target, regenerate }
  ): Promise<{ id: Id<"briefs">; error?: ErrorCode }> => {
    const { id, fresh } = await ctx.runMutation(api.briefs.create, {
      interviewId,
      target,
      regenerate,
    })
    if (!fresh) return { id }

    const interview = await ctx.runQuery(api.interviews.get, {
      id: interviewId,
    })
    const png = interview.pngFileId
      ? await loadPng(ctx, interview.pngFileId)
      : null

    let lastFlush = 0
    let flushing: Promise<void> = Promise.resolve()
    try {
      const body = await generateBrief({
        apiKey,
        model: isModelId(interview.model) ? interview.model : undefined,
        graph: interview.graph,
        png,
        target,
        transcript: toHistory(interview.turns),
        onProgress: (text) => {
          const now = Date.now()
          if (now - lastFlush < FLUSH_MS) return
          lastFlush = now
          // Serialize flushes so an earlier, larger write can't land after a later one.
          flushing = flushing.then(async () => {
            await ctx.runMutation(internal.briefs.setText, { id, text })
          })
        },
      })
      await flushing
      await ctx.runMutation(internal.briefs.complete, {
        id,
        text: body + briefAppendix(interview.graph),
      })
      return { id }
    } catch (err) {
      await flushing.catch(() => {})
      const code = err instanceof LlmError ? err.code : "network"
      await ctx.runMutation(internal.briefs.setError, { id, code })
      return { id, error: code }
    }
  },
})
