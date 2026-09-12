"use client"

import { useAction, useQuery } from "convex/react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

const ERROR_TEXT = {
  bad_key: "The API key was rejected.",
  rate_limit: "The provider is rate-limiting this key. Try again in a moment.",
  invalid_output: "The model returned something unusable.",
  network: "Couldn't reach the model. Check your connection.",
} as const

/**
 * The brief for a finished interview. Generation starts automatically the
 * first time this mounts with no brief; the text streams in via the doc.
 */
export function BriefView({
  interviewId,
  apiKey,
}: {
  interviewId: Id<"interviews">
  apiKey: string
}) {
  const brief = useQuery(api.briefs.latestForInterview, { interviewId })
  const generate = useAction(api.briefActions.generate)
  const [busy, setBusy] = React.useState(false)
  const started = React.useRef(false)

  const run = React.useCallback(async () => {
    setBusy(true)
    try {
      await generate({ interviewId, apiKey })
    } finally {
      setBusy(false)
    }
  }, [apiKey, generate, interviewId])

  // Auto-trigger once per mount; the action itself refuses to fork a running stream.
  React.useEffect(() => {
    if (brief === null && !started.current) {
      started.current = true
      void run()
    }
  }, [brief, run])

  if (brief === undefined) return null

  if (brief === null || brief.status === "error") {
    return (
      <div className="space-y-2 text-sm">
        {brief?.status === "error" && (
          <p className="rounded-md border border-destructive/40 p-3">
            {ERROR_TEXT[brief.lastError ?? "network"]}
          </p>
        )}
        <Button size="sm" onClick={run} disabled={busy}>
          {busy ? <Spinner /> : "Generate brief"}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {brief.status === "streaming" ? "Writing the brief…" : "Brief"}
        </span>
        <CopyButton text={brief.text} disabled={brief.status !== "done"} />
      </div>
      <pre className="max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {brief.text}
        {brief.status === "streaming" && (
          <span className="animate-pulse">▍</span>
        )}
      </pre>
    </div>
  )
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
