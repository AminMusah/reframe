"use client"

import * as React from "react"

import { KeyForm } from "@/components/key-form"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { useApiKey, useModel } from "@/lib/llm-settings"
import { isModelId, modelsFor, providerForKey } from "@/lib/llm/models"

/** Header controls: model for the next interview, and the BYOK key. */
export function SettingsMenu() {
  const [model, setModel] = useModel()
  const [apiKey, setApiKey] = useApiKey()
  const [open, setOpen] = React.useState(false)

  return (
    <div className="flex items-center gap-2">
      <NativeSelect
        size="sm"
        aria-label="Model"
        value={model}
        onChange={(e) => {
          if (isModelId(e.target.value)) setModel(e.target.value)
        }}
      >
        {modelsFor(providerForKey(apiKey ?? "")).map((m) => (
          <NativeSelectOption key={m.id} value={m.id}>
            {m.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <Button variant="outline" size="sm">
              {apiKey ? "Key ✓" : "Add key"}
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API key</DialogTitle>
            <DialogDescription>
              Anthropic (sk-ant-…), OpenAI (sk-…), OpenRouter (sk-or-…), Google
              (AIza…) or Groq (gsk_…). Bring your own key; usage is billed to
              your account.
            </DialogDescription>
          </DialogHeader>
          <KeyForm
            hasKey={!!apiKey}
            onSave={(key) => {
              setApiKey(key)
              setOpen(false)
            }}
          />
          {apiKey && (
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-start"
              onClick={() => {
                setApiKey(null)
                setOpen(false)
              }}
            >
              Forget key
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
