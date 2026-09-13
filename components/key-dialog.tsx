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
} from "@/components/ui/dialog"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { useApiKey, useModel } from "@/lib/llm-settings"
import { isModelId, modelsFor, providerForKey } from "@/lib/llm/models"

/** The BYOK key and the model used for the next interview. */
export function KeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [model, setModel] = useModel()
  const [apiKey, setApiKey] = useApiKey()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Model &amp; API key</DialogTitle>
          <DialogDescription>
            Bring your own key; usage is billed to your account.
          </DialogDescription>
        </DialogHeader>
        {apiKey && (
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Model for the next interview</span>
            <NativeSelect
              size="sm"
              aria-label="Model"
              value={model}
              onChange={(e) => {
                if (isModelId(e.target.value)) setModel(e.target.value)
              }}
            >
              {modelsFor(providerForKey(apiKey)).map((m) => (
                <NativeSelectOption key={m.id} value={m.id}>
                  {m.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        )}
        <KeyForm
          hasKey={!!apiKey}
          onSave={(key) => {
            setApiKey(key)
            onOpenChange(false)
          }}
        />
        {apiKey && (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => {
              setApiKey(null)
              onOpenChange(false)
            }}
          >
            Forget key
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
