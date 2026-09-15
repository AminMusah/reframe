"use client"

import {
  ConvexBetterAuthProvider,
  type AuthClient,
} from "@convex-dev/better-auth/react"
import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react"
import * as React from "react"

import { api } from "@/convex/_generated/api"
import { authClient } from "@/lib/auth-client"
import { PENDING_LINK_KEY } from "@/lib/pending-link"

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!, {
  expectAuth: true,
})

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // The provider types its client generically; a client with concrete
    // plugins (anonymous) infers a narrower session type that TS rejects.
    <ConvexBetterAuthProvider
      client={convex}
      authClient={authClient as unknown as AuthClient}
    >
      <AnonymousSignIn>{children}</AnonymousSignIn>
    </ConvexBetterAuthProvider>
  )
}

/**
 * Every visitor gets an anonymous account on first load so every row has an
 * owner. Children render only once Convex has an authenticated identity.
 */
function AnonymousSignIn({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth()
  const { data: session, isPending } = authClient.useSession()
  const attempted = React.useRef(false)
  const completeLink = useMutation(api.users.completeLink)
  // Back from an OAuth redirect with a prepareLink token: claim the anonymous
  // user's work before anything renders, so the drawing in the URL is ours.
  const [linking, setLinking] = React.useState(() => {
    try {
      return !!localStorage.getItem(PENDING_LINK_KEY)
    } catch {
      return false
    }
  })
  // Read once: the provider strips `ott` from the URL as it verifies it.
  const [hadOtt] = React.useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("ott")
  )
  React.useEffect(() => {
    if (!linking || !isAuthenticated || !session) return
    const user = session.user as { isAnonymous?: boolean | null }
    if (user.isAnonymous && hadOtt) return // the new session is on its way
    const clear = () => {
      try {
        localStorage.removeItem(PENDING_LINK_KEY)
      } catch {}
      setLinking(false)
    }
    if (user.isAnonymous) return clear() // the sign-in never completed
    let token: string | null = null
    try {
      token = localStorage.getItem(PENDING_LINK_KEY)
    } catch {}
    if (!token) return clear()
    let cancelled = false
    void (async () => {
      // The Convex connection re-authenticates as the new user a moment
      // after the session changes; until then the server refuses the claim.
      for (let attempt = 0; attempt < 15 && !cancelled; attempt++) {
        try {
          await completeLink({ token })
          break
        } catch (err) {
          const code = (err as { data?: { code?: string } }).data?.code
          if (code !== "anonymous") {
            console.warn("could not claim earlier drawings", err)
            break
          }
          await new Promise((r) => setTimeout(r, 1000))
        }
      }
      if (!cancelled) clear()
    })()
    return () => {
      cancelled = true
    }
  }, [linking, hadOtt, isAuthenticated, session, completeLink])

  React.useEffect(() => {
    if (isPending) return
    if (session) {
      // A later sign-out should get a fresh anonymous session again.
      attempted.current = false
      return
    }
    if (attempted.current) return
    attempted.current = true
    void authClient.signIn.anonymous()
  }, [isPending, session])

  if (isLoading || !isAuthenticated || linking) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }
  return <>{children}</>
}
