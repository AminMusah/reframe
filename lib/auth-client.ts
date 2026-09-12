import {
  convexClient,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins"
import { anonymousClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

// The auth handler is served by Convex HTTP actions (convex/http.ts), so the
// base URL is the deployment's .site origin, not the app's.
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_CONVEX_SITE_URL,
  plugins: [anonymousClient(), convexClient(), crossDomainClient()],
})
