import { ConvexError, v } from "convex/values"

import { authComponent } from "./auth"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { internalMutation, mutation, query } from "./_generated/server"
import { errorCode } from "./schema"

async function requireUserId(ctx: QueryCtx | MutationCtx): Promise<string> {
  const user = await authComponent.getAuthUser(ctx)
  return user._id
}

/** The newest brief for an interview. */
export const latestForInterview = query({
  args: { interviewId: v.id("interviews") },
  handler: async (ctx, { interviewId }) => {
    const userId = await requireUserId(ctx)
    const briefs = await ctx.db
      .query("briefs")
      .withIndex("by_interview_and_createdAt", (q) =>
        q.eq("interviewId", interviewId)
      )
      .order("desc")
      .collect()
    return briefs.find((b) => b.ownerId === userId) ?? null
  },
})

/**
 * Open a brief in the `streaming` state. Returns the existing one when a
 * stream is already running or finished, so a double-click
 * can't fork it; `regenerate` always starts a new one (unless one is mid-stream).
 */
export const create = mutation({
  args: {
    interviewId: v.id("interviews"),
    regenerate: v.optional(v.boolean()),
  },
  handler: async (ctx, { interviewId, regenerate }) => {
    const userId = await requireUserId(ctx)
    const interview = await ctx.db.get(interviewId)
    if (!interview || interview.ownerId !== userId) {
      throw new ConvexError({
        code: "not_found",
        message: "Interview not found",
      })
    }
    if (interview.status !== "done") {
      throw new ConvexError({
        code: "not_done",
        message: "The interview has not finished",
      })
    }
    const briefs = await ctx.db
      .query("briefs")
      .withIndex("by_interview_and_createdAt", (q) =>
        q.eq("interviewId", interviewId)
      )
      .order("desc")
      .collect()
    const existing = briefs[0]
    if (existing?.status === "streaming")
      return { id: existing._id, fresh: false }
    if (existing && existing.status !== "error" && !regenerate) {
      return { id: existing._id, fresh: false }
    }
    const id = await ctx.db.insert("briefs", {
      interviewId,
      ownerId: userId,
      model: interview.model,
      text: "",
      status: "streaming",
      createdAt: Date.now(),
    })
    return { id, fresh: true }
  },
})

/** Replace the text so far. Idempotent, so a late flush can't corrupt it. */
export const setText = internalMutation({
  args: { id: v.id("briefs"), text: v.string() },
  handler: async (ctx, { id, text }) => {
    const brief = await ctx.db.get(id)
    if (brief?.status === "streaming") await ctx.db.patch(id, { text })
  },
})

export const complete = internalMutation({
  args: { id: v.id("briefs"), text: v.string() },
  handler: async (ctx, { id, text }) => {
    await ctx.db.patch(id, { text, status: "done", lastError: undefined })
  },
})

export const setError = internalMutation({
  args: { id: v.id("briefs"), code: errorCode },
  handler: async (ctx, { id, code }) => {
    await ctx.db.patch(id, { status: "error", lastError: code })
  },
})
