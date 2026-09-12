import { createClient, type GenericCtx } from "@convex-dev/better-auth"
import { convex, crossDomain } from "@convex-dev/better-auth/plugins"
import { betterAuth } from "better-auth/minimal"
import { anonymous } from "better-auth/plugins"

import { components, internal } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import { query } from "./_generated/server"
import authConfig from "./auth.config"

const siteUrl = process.env.SITE_URL!

export const authComponent = createClient<DataModel>(components.betterAuth)

/** Social providers are on only when both halves of their credentials are set. */
function socialProviders() {
  const providers: Record<string, { clientId: string; clientSecret: string }> =
    {}
  const github = [
    process.env.GITHUB_CLIENT_ID,
    process.env.GITHUB_CLIENT_SECRET,
  ]
  const google = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  ]
  if (github[0] && github[1]) {
    providers.github = { clientId: github[0], clientSecret: github[1] }
  }
  if (google[0] && google[1]) {
    providers.google = { clientId: google[0], clientSecret: google[1] }
  }
  return providers
}

// Static-export client, so the handler lives on Convex HTTP actions and the
// browser talks to it cross-origin: crossDomain on both sides (see DESIGN.md).
export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.CONVEX_SITE_URL,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    socialProviders: socialProviders(),
    plugins: [
      // Every visitor is signed in anonymously on first load. Signing in with
      // a provider links the accounts; their work follows them.
      anonymous({
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          if (!("runMutation" in ctx)) return
          await ctx.runMutation(internal.users.transferOwnership, {
            fromUserId: anonymousUser.user.id,
            toUserId: newUser.user.id,
          })
        },
      }),
      crossDomain({ siteUrl }),
      convex({ authConfig }),
    ],
  })

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => authComponent.safeGetAuthUser(ctx),
})

/** Which sign-in buttons to show; secrets never leave the server. */
export const providers = query({
  args: {},
  handler: async () => Object.keys(socialProviders()),
})
