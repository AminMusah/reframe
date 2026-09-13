"use client"

import * as React from "react"

import { Key01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { providerForKey } from "@/lib/llm/models"

export function KeyForm({
  rejected = false,
  hasKey = false,
  onSave,
}: {
  rejected?: boolean
  hasKey?: boolean
  onSave: (key: string) => void
}) {
  const [value, setValue] = React.useState("")
  const [problem, setProblem] = React.useState<string | null>(null)
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        const key = value.trim()
        // Groq was dropped: its catalogue has no vision models, so the
        // interviewer could not see the drawing.
        if (key.startsWith("gsk_")) {
          setProblem("Groq keys are not supported — Groq has no vision models.")
          return
        }
        setProblem(null)
        onSave(key)
        setValue("")
      }}
    >
      {!hasKey && (
        <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
          <HugeiconsIcon
            icon={Key01Icon}
            strokeWidth={2}
            className="size-4 text-muted-foreground"
          />
        </span>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {rejected
            ? "That key was rejected — try another."
            : hasKey
              ? "Replace your API key"
              : "Bring your own model"}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          An Anthropic, OpenAI, OpenRouter or Google key. It stays in this
          browser and travels only with each request — never stored on the
          server.
        </p>
      </div>
      <div className="space-y-1.5">
        <Input
          type="password"
          autoComplete="off"
          placeholder="sk-ant-… / sk-… / sk-or-… / AIza…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <p className="h-4 text-xs text-muted-foreground">
          {problem ? (
            <span className="text-destructive">{problem}</span>
          ) : value.trim() ? (
            `Looks like ${PROVIDER_LABEL[providerForKey(value.trim())]}.`
          ) : null}
        </p>
      </div>
      <Button type="submit" size="sm" disabled={!value.trim()}>
        Save key
      </Button>
    </form>
  )
}

const PROVIDER_LABEL = {
  anthropic: "an Anthropic key",
  openai: "an OpenAI key",
  openrouter: "an OpenRouter key",
  google: "a Google key",
} as const
