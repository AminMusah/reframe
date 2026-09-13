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
} from "@/components/ui/dialog"
import { api } from "@/convex/_generated/api"
import { authClient } from "@/lib/auth-client"

const LABEL: Record<string, string> = { github: "GitHub", google: "Google" }

/**
 * Anonymous visitors can upgrade to a GitHub/Google account; their projects
 * follow them. Providers appear only when configured on the deployment.
 */
export function SignInDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const providers = useQuery(api.auth.providers)
  const [busy, setBusy] = React.useState<string | null>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign in</DialogTitle>
          <DialogDescription>
            Keep your projects across devices. Everything you have drawn so far
            comes with you.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {providers?.map((provider) => (
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
