"use client"

import {
  Delete02Icon,
  Key01Icon,
  Logout03Icon,
  Moon02Icon,
  Shield01Icon,
  Sun03Icon,
  UserIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery } from "convex/react"
import { useTheme } from "next-themes"
import Link from "next/link"
import * as React from "react"

import { GitHubMark, GoogleMark } from "@/components/provider-logos"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/convex/_generated/api"
import { authClient } from "@/lib/auth-client"
import { PENDING_LINK_KEY } from "@/lib/pending-link"
import { leaveTo } from "@/lib/leave"
import { clearAllMirrors } from "@/lib/scene-store"
import { cn } from "@/lib/utils"

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
 * The GitHub / Google buttons. Before the redirect the anonymous user mints
 * a link token so their drawings follow them (redeemed in Providers).
 */
export function SignInButtons({
  size = "lg",
  className,
}: {
  size?: "default" | "lg" | "sm"
  className?: string
}) {
  const providers = useQuery(api.auth.providers)
  const prepareLink = useMutation(api.users.prepareLink)
  const [busy, setBusy] = React.useState<string | null>(null)
  if (!providers?.length) return null
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {providers.map((provider) => (
        <Button
          key={provider}
          size={size}
          className={cn("w-full", BRAND[provider]?.className)}
          disabled={busy !== null}
          onClick={async () => {
            setBusy(provider)
            try {
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
  )
}

/**
 * The account surface, floating bottom-left above the zoom island (beside ☰
 * on phones). A guest sees a neutral mark with a dot and the sign-in buttons;
 * a signed-in user their picture. "You" lives here — key, theme, privacy,
 * sign out, delete — and ☰ is about the drawing.
 */
export function AccountAvatar({ onOpenKey }: { onOpenKey: () => void }) {
  const user = useQuery(api.auth.getCurrentUser)
  const { resolvedTheme, setTheme } = useTheme()
  const [deleting, setDeleting] = React.useState(false)
  const anonymous =
    !user || (user as { isAnonymous?: boolean | null }).isAnonymous
  const name = user?.name || user?.email || ""
  const initial = name.trim().charAt(0).toUpperCase()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="pressable fixed bottom-[4.25rem] left-4 z-[100] rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40 max-sm:top-3 max-sm:bottom-auto max-sm:left-16"
          aria-label={anonymous ? "Guest — sign in" : `Account: ${name}`}
        >
          <Avatar size="lg" className="bg-card ring-0">
            {!anonymous && user?.image && (
              <AvatarImage src={user.image} alt="" />
            )}
            <AvatarFallback className="bg-card text-foreground">
              {anonymous || !initial ? (
                <HugeiconsIcon
                  icon={UserIcon}
                  strokeWidth={2}
                  className="size-5 text-muted-foreground"
                />
              ) : (
                initial
              )}
            </AvatarFallback>
          </Avatar>
          {anonymous && (
            <span
              aria-hidden
              className="absolute top-0 right-0 size-2.5 rounded-full bg-brand ring-2 ring-background"
            />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-72 p-2 max-sm:data-[side=bottom]:mt-1"
        >
          {anonymous ? (
            <div className="space-y-3 p-2">
              <div>
                <p className="text-sm font-medium">Drawing as a guest</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Your drawings live in this browser only. Sign in to keep them
                  and open them anywhere.
                </p>
              </div>
              <SignInButtons size="default" />
            </div>
          ) : (
            <div className="flex items-center gap-3 p-2">
              <Avatar size="default">
                {user?.image && <AvatarImage src={user.image} alt="" />}
                <AvatarFallback>{initial}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user?.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user?.email}
                </p>
              </div>
            </div>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onOpenKey}>
            <HugeiconsIcon icon={Key01Icon} strokeWidth={2} />
            Model &amp; API key
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
          >
            <HugeiconsIcon
              icon={resolvedTheme === "dark" ? Sun03Icon : Moon02Icon}
              strokeWidth={2}
            />
            {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/privacy" />}>
            <HugeiconsIcon icon={Shield01Icon} strokeWidth={2} />
            Privacy
          </DropdownMenuItem>
          {!anonymous && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  await authClient.signOut()
                  await authClient.signIn.anonymous()
                }}
              >
                <HugeiconsIcon icon={Logout03Icon} strokeWidth={2} />
                Sign out
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleting(true)}
              >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                Delete account…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {!anonymous && (
        <DeleteAccountDialog open={deleting} onOpenChange={setDeleting} />
      )}
    </>
  )
}

/** Irreversible: lists what goes, asks for the word "delete", then a fresh guest session. */
function DeleteAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const footprint = useQuery(api.users.footprint, open ? {} : "skip")
  const [typed, setTyped] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const ready = typed.trim().toLowerCase() === "delete"
  const n = (count: number | undefined, word: string) =>
    count === undefined ? "…" : `${count} ${word}${count === 1 ? "" : "s"}`
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return
        onOpenChange(o)
        if (!o) {
          setTyped("")
          setError(null)
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes {n(footprint?.drawings, "drawing")},{" "}
            {n(footprint?.interviews, "interview")} and{" "}
            {n(footprint?.prompts, "prompt")}, and the account itself. There is
            no undo. Export anything you want to keep first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="block space-y-1.5 text-sm">
          <span className="text-muted-foreground">
            Type <span className="font-mono text-foreground">delete</span> to
            confirm
          </span>
          <Input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep my account</AlertDialogCancel>
          <AlertDialogAction
            disabled={!ready || busy}
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={async (e) => {
              e.preventDefault()
              setBusy(true)
              setError(null)
              try {
                const res = await authClient.deleteUser()
                if (res.error) throw new Error(res.error.message)
                clearAllMirrors()
                // Straight to a fresh load: Providers signs in anonymously
                // there, and nothing here is left to react to the deletion.
                leaveTo("/")
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Could not delete the account."
                )
                setBusy(false)
              }
            }}
          >
            {busy ? <Spinner /> : "Delete everything"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
