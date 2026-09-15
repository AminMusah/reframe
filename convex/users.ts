import { ConvexError, v } from "convex/values"

import { authComponent } from "./auth"
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server"

/** Everything `fromUserId` made becomes `toUserId`'s. */
async function transfer(
  ctx: MutationCtx,
  fromUserId: string,
  toUserId: string
) {
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
}

/**
 * When an anonymous visitor signs in with GitHub/Google and Better Auth's
 * anonymous plugin sees the anonymous session at the OAuth callback, it links
 * the accounts and deletes the anonymous user; this moves their work first
 * (called from the plugin's onLinkAccount).
 */
export const transferOwnership = internalMutation({
  args: { fromUserId: v.string(), toUserId: v.string() },
  handler: async (ctx, { fromUserId, toUserId }) => {
    await transfer(ctx, fromUserId, toUserId)
  },
})

const LINK_TTL_MS = 15 * 60 * 1000

/**
 * The plugin's linking only works when the anonymous session cookie reaches
 * the OAuth callback — a cross-site navigation to the Convex origin, where
 * the browser usually has no such cookie (the session lives in the app's
 * localStorage). So the app carries the link itself: before the redirect the
 * anonymous user mints a token here; after the redirect the new user redeems
 * it with `completeLink`. Only the browser that started the sign-in holds the
 * token.
 */
export const prepareLink = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx)
    const token = crypto.randomUUID()
    await ctx.db.insert("pendingLinks", {
      token,
      fromUserId: user._id,
      expiresAt: Date.now() + LINK_TTL_MS,
    })
    return token
  },
})

/** Redeem a `prepareLink` token as the signed-in user; idempotent and one-shot. */
export const completeLink = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await authComponent.getAuthUser(ctx)
    if ((user as { isAnonymous?: boolean | null }).isAnonymous) {
      // The Convex connection still carries the anonymous identity; the
      // client retries once it has re-authenticated as the new user.
      throw new ConvexError({ code: "anonymous", message: "Not signed in yet" })
    }
    const pending = await ctx.db
      .query("pendingLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique()
    if (!pending) return
    await ctx.db.delete(pending._id)
    if (pending.expiresAt < Date.now()) {
      throw new ConvexError({
        code: "expired",
        message: "Sign-in link expired",
      })
    }
    await transfer(ctx, pending.fromUserId, user._id)
  },
})
