"use client"

import {
  ConvexBetterAuthProvider,
  type AuthClient,
} from "@convex-dev/better-auth/react"
import { ConvexReactClient, useConvexAuth } from "convex/react"
import * as React from "react"

import { authClient } from "@/lib/auth-client"

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

  React.useEffect(() => {
    if (isPending || session || attempted.current) return
    attempted.current = true
    void authClient.signIn.anonymous()
  }, [isPending, session])

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }
  return <>{children}</>
}
