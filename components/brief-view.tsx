"use client"

import { Copy01Icon, RefreshIcon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useAction, useQuery } from "convex/react"
import * as React from "react"
import Markdown from "react-markdown"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { BriefTarget } from "@/lib/llm/brief"
import { cn } from "@/lib/utils"

const TARGETS: { id: BriefTarget; label: string }[] = [
  { id: "generic", label: "Generic" },
  { id: "claude-code", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
]

const ERROR_TEXT = {
  bad_key: "The API key was rejected.",
  billing:
    "The provider says this key has no remaining credit. Top up your account, then retry.",
  rate_limit: "The provider is rate-limiting this key. Try again in a moment.",
  invalid_output: "The model returned something unusable.",
  network: "Couldn't reach the model. Check your connection.",
} as const

/**
 * Briefs for a finished interview, one per target. The generic brief starts
 * automatically the first time this mounts without one; other targets
 * generate on demand. Text streams in via the doc.
 */
export function BriefView({
  interviewId,
  apiKey,
}: {
  interviewId: Id<"interviews">
  apiKey: string
}) {
  const [target, setTarget] = React.useState<BriefTarget>("generic")
  const brief = useQuery(api.briefs.latestForInterview, { interviewId, target })
  const generate = useAction(api.briefActions.generate)
  const [busy, setBusy] = React.useState(false)
  const autoStarted = React.useRef(false)

  const run = React.useCallback(
    async (regenerate = false) => {
      setBusy(true)
      try {
        await generate({ interviewId, apiKey, target, regenerate })
      } finally {
        setBusy(false)
      }
    },
    [apiKey, generate, interviewId, target]
  )

  // Only the generic brief auto-starts, and only once per mount; the action
  // itself refuses to fork a running stream.
  React.useEffect(() => {
    if (target === "generic" && brief === null && !autoStarted.current) {
      autoStarted.current = true
      void run()
    }
  }, [brief, run, target])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
            Brief
          </p>
          <p className="text-sm font-medium">Paste this into your agent</p>
        </div>
        <Segmented value={target} onChange={setTarget} />
      </div>

      {brief === undefined ? null : brief === null ||
        brief.status === "error" ? (
        <div className="space-y-2 text-sm">
          {brief?.status === "error" && (
            <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-3">
              {ERROR_TEXT[brief.lastError ?? "network"]}
            </p>
          )}
          <Button size="sm" onClick={() => run()} disabled={busy}>
            {busy ? <Spinner /> : `Write the ${label(target)} brief`}
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {brief.status === "streaming" && <Spinner className="size-3" />}
              {brief.status === "streaming"
                ? "Writing…"
                : `${label(target)} · ${words(brief.text)} words`}
            </span>
            <div className="flex gap-0.5">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Regenerate"
                title="Regenerate"
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
          <div className="brief max-h-[60vh] overflow-auto px-4 py-3 text-sm">
            <Markdown>{brief.text}</Markdown>
            {brief.status === "streaming" && <span className="caret" />}
          </div>
        </div>
      )}
    </div>
  )
}

function label(target: BriefTarget) {
  return TARGETS.find((t) => t.id === target)?.label ?? target
}

function words(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

/** Three-way switch; the active pill is a plain background swap, no motion. */
function Segmented({
  value,
  onChange,
}: {
  value: BriefTarget
  onChange: (t: BriefTarget) => void
}) {
  return (
    <div
      role="tablist"
      className="flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {TARGETS.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={cn(
            "pressable rounded-md px-2 py-1 text-xs whitespace-nowrap",
            t.id === value
              ? "bg-background font-medium text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function CopyButton({ text, disabled }: { text: string; disabled: boolean }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <Button
      size="sm"
      variant={copied ? "ghost" : "outline"}
      disabled={disabled}
      aria-label="Copy the brief"
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
      {copied ? "Copied" : "Copy"}
    </Button>
  )
}
