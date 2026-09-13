import { ConvexError, v } from "convex/values"

import { authComponent } from "./auth"
import type { Doc, Id } from "./_generated/dataModel"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import {
  doneTurn,
  editTurn,
  errorCode,
  questionTurn,
  sketchTurn,
} from "./schema"

const assistantTurn = v.union(questionTurn, editTurn, sketchTurn, doneTurn)

async function requireUserId(ctx: QueryCtx | MutationCtx): Promise<string> {
  const user = await authComponent.getAuthUser(ctx)
  return user._id
}

async function ownedInterview(
  ctx: QueryCtx | MutationCtx,
  id: Id<"interviews">
): Promise<Doc<"interviews">> {
  const [userId, interview] = await Promise.all([
    requireUserId(ctx),
    ctx.db.get(id),
  ])
  if (!interview || interview.ownerId !== userId) {
    throw new ConvexError({ code: "not_found", message: "Interview not found" })
  }
  return interview
}

export const get = query({
  args: { id: v.id("interviews") },
  handler: async (ctx, { id }) => ownedInterview(ctx, id),
})

/** The panel shows the newest interview for the open project. */
export const latestForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx)
    const latest = await ctx.db
      .query("interviews")
      .withIndex("by_project_and_createdAt", (q) =>
        q.eq("projectId", projectId)
      )
      .order("desc")
      .first()
    return latest && latest.ownerId === userId ? latest : null
  },
})

/** Pin a snapshot and open the interview in `thinking`; the action asks the first question. */
export const start = mutation({
  args: {
    projectId: v.id("projects"),
    sceneHash: v.string(),
    graph: v.string(),
    pngFileId: v.optional(v.id("_storage")),
    model: v.string(),
    priorInterviewId: v.optional(v.id("interviews")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const project = await ctx.db.get(args.projectId)
    if (!project || project.ownerId !== userId) {
      throw new ConvexError({ code: "not_found", message: "Project not found" })
    }
    if (args.priorInterviewId) {
      const prior = await ctx.db.get(args.priorInterviewId)
      if (!prior || prior.ownerId !== userId) {
        throw new ConvexError({
          code: "not_found",
          message: "Prior interview not found",
        })
      }
    }
    await ctx.db.patch(args.projectId, { pngFileId: args.pngFileId })
    return ctx.db.insert("interviews", {
      ...args,
      ownerId: userId,
      status: "thinking",
      turns: [],
      createdAt: Date.now(),
    })
  },
})

/** Phase 1 of a turn: record the answer and lock the interview while the model runs. */
export const submitAnswer = mutation({
  args: { id: v.id("interviews"), answer: v.string() },
  handler: async (ctx, { id, answer }) => {
    const interview = await ownedInterview(ctx, id)
    if (interview.status !== "awaiting_answer") {
      throw new ConvexError({
        code: "not_awaiting",
        message: "No question is waiting for an answer",
      })
    }
    await ctx.db.patch(id, {
      turns: [...interview.turns, { role: "user", answer }],
      status: "thinking",
      lastError: undefined,
    })
  },
})

/** Re-run the model after an error without resending the answer. */
export const retry = mutation({
  args: { id: v.id("interviews") },
  handler: async (ctx, { id }) => {
    const interview = await ownedInterview(ctx, id)
    if (interview.status !== "error") {
      throw new ConvexError({ code: "not_error", message: "Nothing to retry" })
    }
    await ctx.db.patch(id, { status: "thinking", lastError: undefined })
  },
})

/** The Enough link: ends the interview without a model round-trip. */
export const finish = mutation({
  args: { id: v.id("interviews") },
  handler: async (ctx, { id }) => {
    const interview = await ownedInterview(ctx, id)
    if (interview.status === "done") return
    await ctx.db.patch(id, {
      status: "done",
      lastError: undefined,
      turns: [
        ...interview.turns,
        {
          role: "assistant",
          kind: "done",
          summary:
            "The author ended the interview early; unresolved points go under Open questions.",
        },
      ],
    })
  },
})

/** Phase 3 of a turn, called by the action once the model has answered. */
export const appendAssistantTurn = internalMutation({
  args: { id: v.id("interviews"), turn: assistantTurn },
  handler: async (ctx, { id, turn }) => {
    const interview = await ctx.db.get(id)
    if (!interview) return
    await ctx.db.patch(id, {
      turns: [...interview.turns, turn],
      status: turn.kind === "done" ? "done" : "awaiting_answer",
      lastError: undefined,
    })
  },
})

/**
 * An accepted agent edit becomes the interview's new baseline: the pinned
 * hash, graph, and PNG move to the edited drawing, so no restart is needed.
 */
export const rebase = mutation({
  args: {
    id: v.id("interviews"),
    sceneHash: v.string(),
    graph: v.string(),
    pngFileId: v.optional(v.id("_storage")),
    turnIndex: v.optional(v.number()),
  },
  handler: async (ctx, { id, sceneHash, graph, pngFileId, turnIndex }) => {
    const interview = await ownedInterview(ctx, id)
    await ctx.db.patch(id, {
      sceneHash,
      graph,
      ...(pngFileId ? { pngFileId } : {}),
      turns: markChange(interview.turns, true, turnIndex),
    })
  },
})

/** The author undid the edit; record it so the transcript shows the decision. */
export const rejectEdit = mutation({
  args: { id: v.id("interviews"), turnIndex: v.optional(v.number()) },
  handler: async (ctx, { id, turnIndex }) => {
    const interview = await ownedInterview(ctx, id)
    await ctx.db.patch(id, {
      turns: markChange(interview.turns, false, turnIndex),
    })
  },
})

/** Record the author's decision on the change carried by a turn (default: the last one). */
function markChange(
  turns: Doc<"interviews">["turns"],
  applied: boolean,
  turnIndex?: number
) {
  const i = turnIndex ?? turns.length - 1
  const t = turns[i]
  if (!t || t.role !== "assistant" || t.kind === "done") return turns
  if (t.kind === "question" && !(t.ops && t.ops.length)) return turns
  return [...turns.slice(0, i), { ...t, applied }, ...turns.slice(i + 1)]
}

export const setError = internalMutation({
  args: { id: v.id("interviews"), code: errorCode },
  handler: async (ctx, { id, code }) => {
    await ctx.db.patch(id, { status: "error", lastError: code })
  },
})
