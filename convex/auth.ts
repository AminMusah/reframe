import { createClient, type GenericCtx } from "@convex-dev/better-auth"
import { convex, crossDomain } from "@convex-dev/better-auth/plugins"
import { betterAuth } from "better-auth/minimal"
import { anonymous } from "better-auth/plugins"

import { components } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import { query } from "./_generated/server"
import authConfig from "./auth.config"

const siteUrl = process.env.SITE_URL!

export const authComponent = createClient<DataModel>(components.betterAuth)

// Static-export client, so the handler lives on Convex HTTP actions and the
// browser talks to it cross-origin: crossDomain on both sides (see DESIGN.md).
export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.CONVEX_SITE_URL,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    plugins: [
      // Every visitor is signed in anonymously on first load; GitHub/Google
      // upgrade (and the onLinkAccount ownership hand-off) land in step 7.
      anonymous(),
      crossDomain({ siteUrl }),
      convex({ authConfig }),
    ],
  })

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => authComponent.safeGetAuthUser(ctx),
})
