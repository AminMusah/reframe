"use client"

import { Copy01Icon, RefreshIcon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useAction, useQuery } from "convex/react"
import * as React from "react"

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
export function BriefView({
  interviewId,
  apiKey,
  actions,
}: {
  interviewId: Id<"interviews">
  apiKey: string
  /** Extra controls for the sticky bar (e.g. Interview again). */
  actions?: React.ReactNode
}) {
  const brief = useQuery(api.briefs.latestForInterview, { interviewId })
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
          {/* Stays in reach however long the prompt runs; the panel scrolls behind it. */}
          <div className="sticky -bottom-5 -mx-5 -mb-5 flex items-center justify-between gap-2 bg-card/90 px-5 py-3 backdrop-blur">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {brief.status === "streaming" && <Spinner className="size-3" />}
              {brief.status === "streaming"
                ? "Writing…"
                : `${words(brief.text)} words`}
            </span>
            <div className="flex items-center gap-1">
              {actions}
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
      <HugeiconsIcon
        icon={copied ? Tick02Icon : Copy01Icon}
        strokeWidth={2}
        data-icon="inline-start"
      />
      {copied ? "Copied" : "Copy prompt"}
    </Button>
  )
}
