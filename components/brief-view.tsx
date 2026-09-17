"use client"

import {
  Copy01Icon,
  Download04Icon,
  RefreshIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useAction, useQuery } from "convex/react"
import * as React from "react"

import { SignInButtons } from "@/components/account-menu"
import { Markdown } from "@/components/markdown"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

const ERROR_TEXT = {
  bad_key: "The API key was rejected.",
  billing:
    "The provider says this key has no remaining credit. Top up your account, then retry.",
  rate_limit: "The provider is rate-limiting this key. Try again in a moment.",
  invalid_output: "The model returned something unusable.",
  network: "Couldn't reach the model. Check your connection.",
} as const

/**
 * The prompt for a finished interview (a "brief" in the code and the model's
 * instructions). Starts writing itself the first time this mounts without
 * one; text streams in via the doc.
 */
const NUDGE_KEY = "reframe:nudge-dismissed"

export function BriefView({
  interviewId,
  apiKey,
  fileName = "prompt",
  actions,
  below,
}: {
  interviewId: Id<"interviews">
  apiKey: string
  /** Base name for the downloaded .md (the drawing's name). */
  fileName?: string
  /** Extra controls for the sticky bar (e.g. Interview again). */
  actions?: React.ReactNode
  /** Rendered under the prompt, above the sticky bar (e.g. previous prompts). */
  below?: React.ReactNode
}) {
  const brief = useQuery(api.briefs.latestForInterview, { interviewId })
  const user = useQuery(api.auth.getCurrentUser)
  const generate = useAction(api.briefActions.generate)
  const [busy, setBusy] = React.useState(false)
  const autoStarted = React.useRef(false)

  const run = React.useCallback(
    async (regenerate = false) => {
      setBusy(true)
      try {
        await generate({ interviewId, apiKey, regenerate })
      } finally {
        setBusy(false)
      }
    },
    [apiKey, generate, interviewId]
  )

  // Once per mount; the action itself refuses to fork a running stream.
  React.useEffect(() => {
    if (brief === null && !autoStarted.current) {
      autoStarted.current = true
      void run()
    }
  }, [brief, run])

  return (
    <div className="space-y-3">
      <div>
        <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
          Prompt
          {brief?.status === "done" && (
            <span className="tracking-normal normal-case">
              {" "}
              · {words(brief.text)} words
            </span>
          )}
        </p>
        <p className="text-sm font-medium">
          Paste this into Claude Code, Codex, Cursor or any coding agent.
        </p>
      </div>

      {brief === undefined ? null : brief === null ||
        brief.status === "error" ? (
        <div className="space-y-2 text-sm">
          {brief?.status === "error" && (
            <p className="rounded-xl bg-destructive/10 p-3">
              {ERROR_TEXT[brief.lastError ?? "network"]}
            </p>
          )}
          <Button size="sm" onClick={() => run()} disabled={busy}>
            {busy ? <Spinner /> : "Write the prompt"}
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-xl bg-secondary px-4 py-3 text-sm">
            <Markdown streaming={brief.status === "streaming"}>
              {brief.text}
            </Markdown>
            {brief.status === "streaming" && <span className="caret" />}
          </div>
          {brief.status === "done" &&
            (!user ||
              (user as { isAnonymous?: boolean | null }).isAnonymous) && (
              <GuestNudge />
            )}
          {below}
          {/* Stays in reach however long the prompt runs; the panel scrolls behind it. */}
          <div className="sticky -bottom-5 -mx-5 -mb-5 flex items-center justify-between gap-2 bg-card/90 px-5 py-3 backdrop-blur">
            <span className="flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
              {brief.status === "streaming" && (
                <>
                  <Spinner className="size-3" />
                  Writing…
                </>
              )}
            </span>
            <div className="flex items-center gap-0.5">
              {actions}
              {brief.status === "done" && (
                <>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Write it again"
                    title="Write it again"
                    disabled={busy || brief.status !== "done"}
                    onClick={() => run(true)}
                  >
                    <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Download as Markdown"
                    title="Download as Markdown"
                    disabled={brief.status !== "done"}
                    onClick={() =>
                      download(`${slug(fileName)}-prompt.md`, brief.text)
                    }
                  >
                    <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
                  </Button>
                </>
              )}
              <CopyButton
                text={brief.text}
                disabled={brief.status !== "done"}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** One quiet line, once: the moment there is something worth keeping. */
function GuestNudge() {
  const [dismissed, setDismissed] = React.useState(() => {
    try {
      return localStorage.getItem(NUDGE_KEY) === "1"
    } catch {
      return false
    }
  })
  if (dismissed) return null
  const dismiss = () => {
    try {
      localStorage.setItem(NUDGE_KEY, "1")
    } catch {}
    setDismissed(true)
  }
  return (
    <div className="enter space-y-2 rounded-xl bg-lavender px-3 py-2.5 text-xs">
      <div className="flex items-start justify-between gap-3">
        <p className="leading-relaxed">
          <span className="font-medium">Worth keeping?</span> You are drawing as
          a guest — this drawing and prompt live in this browser only. Sign in
          to have them on any device.
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="pressable shrink-0 text-muted-foreground hover:text-foreground"
        >
          Not now
        </button>
      </div>
      <SignInButtons size="sm" />
    </div>
  )
}

function slug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "prompt"
  )
}

/** Save text as a file; the blob URL lives just long enough for the click. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/markdown;charset=utf-8" })
  )
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function words(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

function CopyButton({ text, disabled }: { text: string; disabled: boolean }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <Button
      size="sm"
      variant={copied ? "ghost" : "default"}
      disabled={disabled}
      aria-label="Copy the prompt"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {/* Keyed so the state change crossfades instead of snapping. */}
      <span
        key={String(copied)}
        className="swap inline-flex items-center gap-1.5"
      >
        <HugeiconsIcon
          icon={copied ? Tick02Icon : Copy01Icon}
          strokeWidth={2}
          data-icon="inline-start"
        />
        {copied ? "Copied" : "Copy prompt"}
      </span>
    </Button>
  )
}
