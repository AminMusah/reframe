"use node"

import { ConvexError, v } from "convex/values"

import { InterviewError, interviewTurn } from "../lib/llm/interview"
import { isModelId } from "../lib/llm/models"
import { api, internal } from "./_generated/api"
import { action } from "./_generated/server"
import { graphIds, loadPng, toHistory } from "./helpers"

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
    const priorDoc = interview.priorInterviewId
      ? await ctx.runQuery(api.interviews.get, {
          id: interview.priorInterviewId,
        })
      : null
    const prior = priorDoc
      ? {
          graph: priorDoc.graph,
          history: toHistory(priorDoc.turns),
          sameDrawing: priorDoc.sceneHash === interview.sceneHash,
        }
      : null

    try {
      const turn = await interviewTurn({
        apiKey,
        model: isModelId(interview.model) ? interview.model : undefined,
        graph: interview.graph,
        png,
        prior,
        history: toHistory(interview.turns),
        validIds: graphIds(interview.graph),
      })
      // Convex validators have no null: a question's absent change is omitted.
      const stored =
        turn.kind === "question"
          ? {
              role: "assistant" as const,
              ...turn,
              change: turn.change ?? undefined,
            }
          : { role: "assistant" as const, ...turn }
      await ctx.runMutation(internal.interviews.appendAssistantTurn, {
        id: interviewId,
        turn: stored,
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
