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
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(value)
        setValue("")
      }}
    >
      <p className="text-sm font-medium">
        {rejected
          ? "That key was rejected — try another."
          : hasKey
            ? "Replace your Anthropic API key"
            : "Add your Anthropic API key"}
      </p>
      <p className="text-xs text-muted-foreground">
        It stays in this browser and is sent only with each request. It is never
        stored on the server.
      </p>
      <Input
        type="password"
        autoComplete="off"
        placeholder="sk-ant-…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" size="sm" disabled={!value.trim()}>
        Save key
      </Button>
    </form>
  )
}
