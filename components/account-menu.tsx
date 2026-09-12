"use client"

import { useQuery } from "convex/react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { api } from "@/convex/_generated/api"
import { authClient } from "@/lib/auth-client"

const LABEL: Record<string, string> = { github: "GitHub", google: "Google" }

/**
 * Anonymous visitors can upgrade to a GitHub/Google account (their projects
 * follow them); signed-in users can sign out, which drops them back to a
 * fresh anonymous session.
 */
export function AccountMenu() {
  const user = useQuery(api.auth.getCurrentUser)
  const providers = useQuery(api.auth.providers)
  const [busy, setBusy] = React.useState<string | null>(null)

  if (!user) return null
  const anonymous = (user as { isAnonymous?: boolean | null }).isAnonymous

  if (!anonymous) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="max-w-40 truncate text-muted-foreground">
          {user.name || user.email}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await authClient.signOut()
            await authClient.signIn.anonymous()
          }}
        >
          Sign out
        </Button>
      </div>
    )
  }

  // Nothing to offer until a provider is configured on the deployment.
  if (!providers?.length) return null

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            Sign in
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign in</DialogTitle>
          <DialogDescription>
            Keep your projects across devices. Everything you have drawn so far
            comes with you.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {providers.map((provider) => (
            <Button
              key={provider}
              variant="outline"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(provider)
                try {
                  await authClient.signIn.social({
                    provider: provider as "github" | "google",
                    callbackURL: window.location.href,
                  })
                } finally {
                  setBusy(null)
                }
              }}
            >
              Continue with {LABEL[provider] ?? provider}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
