"use client"

import * as React from "react"

import { KeyForm } from "@/components/key-form"
import { ModelSelect } from "@/components/model-select"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useApiKey, useModel } from "@/lib/llm-settings"

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
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Model for the next interview</p>
            <ModelSelect apiKey={apiKey} value={model} onChange={setModel} />
          </div>
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
