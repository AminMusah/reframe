import { v } from "convex/values"

import { internalMutation } from "./_generated/server"

/**
 * When an anonymous visitor signs in with GitHub/Google, Better Auth links
 * the accounts and deletes the anonymous user. Everything they made moves
 * to the new user first (called from the anonymous plugin's onLinkAccount).
 */
export const transferOwnership = internalMutation({
  args: { fromUserId: v.string(), toUserId: v.string() },
  handler: async (ctx, { fromUserId, toUserId }) => {
    if (fromUserId === toUserId) return
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_owner_and_updatedAt", (q) => q.eq("ownerId", fromUserId))
      .collect()
    const interviews = await ctx.db
      .query("interviews")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", fromUserId))
      .collect()
    const briefs = await ctx.db
      .query("briefs")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", fromUserId))
      .collect()
    await Promise.all(
      [...projects, ...interviews, ...briefs].map((doc) =>
        ctx.db.patch(doc._id, { ownerId: toUserId })
      )
    )
  },
})
