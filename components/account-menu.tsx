"use client"

import { useMutation, useQuery } from "convex/react"
import * as React from "react"

import { GitHubMark, GoogleMark } from "@/components/provider-logos"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { api } from "@/convex/_generated/api"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"
import { PENDING_LINK_KEY } from "@/lib/pending-link"

/** Each provider's brand: its mark and its button colours. */
const BRAND: Record<
  string,
  { label: string; className: string; mark: React.ReactNode }
> = {
  github: {
    label: "GitHub",
    className: "bg-[#24292f] text-white hover:bg-[#24292f]/90",
    mark: <GitHubMark className="size-5" />,
  },
  google: {
    label: "Google",
    className: "bg-white text-[#1f1f1f] hover:bg-white/90 dark:bg-white",
    mark: <GoogleMark className="size-5" />,
  },
}

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
  const prepareLink = useMutation(api.users.prepareLink)
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
              size="lg"
              className={cn("w-full", BRAND[provider]?.className)}
              disabled={busy !== null}
              onClick={async () => {
                setBusy(provider)
                try {
                  // Carry this anonymous user's work across the redirect
                  // (redeemed in Providers once the new session is in).
                  const token = await prepareLink()
                  try {
                    localStorage.setItem(PENDING_LINK_KEY, token)
                  } catch {}
                  await authClient.signIn.social({
                    provider: provider as "github" | "google",
                    callbackURL: window.location.href,
                  })
                } finally {
                  setBusy(null)
                }
              }}
            >
              {busy === provider ? (
                <Spinner />
              ) : (
                <>
                  {BRAND[provider]?.mark}
                  Continue with {BRAND[provider]?.label ?? provider}
                </>
              )}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
