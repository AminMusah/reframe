"use client"

import { useAction, useQuery } from "convex/react"
import * as React from "react"

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
    <div className="space-y-2">
      <div className="flex items-center gap-1" role="tablist">
        {TARGETS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={t.id === target}
            onClick={() => setTarget(t.id)}
            className={cn(
              "rounded-md px-2 py-1 text-xs",
              t.id === target
                ? "bg-accent font-medium"
                : "text-muted-foreground hover:bg-accent/50"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {brief === undefined ? null : brief === null ||
        brief.status === "error" ? (
        <div className="space-y-2 text-sm">
          {brief?.status === "error" && (
            <p className="rounded-md border border-destructive/40 p-3">
              {ERROR_TEXT[brief.lastError ?? "network"]}
            </p>
          )}
          <Button size="sm" onClick={() => run()} disabled={busy}>
            {busy ? <Spinner /> : `Generate ${label(target)} brief`}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {brief.status === "streaming"
                ? "Writing the brief…"
                : `${label(target)} brief`}
            </span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || brief.status !== "done"}
                onClick={() => run(true)}
              >
                Regenerate
              </Button>
              <CopyButton
                text={brief.text}
                disabled={brief.status !== "done"}
              />
            </div>
          </div>
          <pre className="max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {brief.text}
            {brief.status === "streaming" && (
              <span className="animate-pulse">▍</span>
            )}
          </pre>
        </>
      )}
    </div>
  )
}

function label(target: BriefTarget) {
  return TARGETS.find((t) => t.id === target)?.label ?? target
}

function CopyButton({ text, disabled }: { text: string; disabled: boolean }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  )
}
