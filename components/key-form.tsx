"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

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
      <p className="text-sm font-medium">
        {rejected
          ? "That key was rejected — try another."
          : hasKey
            ? "Replace your API key"
            : "Add your API key"}
      </p>
      <p className="text-xs text-muted-foreground">
        Anthropic, OpenAI, OpenRouter or Google. It stays in this browser and is
        sent only with each request. It is never stored on the server.
      </p>
      <Input
        type="password"
        autoComplete="off"
        placeholder="sk-ant-… / sk-… / sk-or-… / AIza…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      <Button type="submit" size="sm" disabled={!value.trim()}>
        Save key
      </Button>
    </form>
  )
}
