"use client"

import { Tick02Icon, UnfoldMoreIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import * as React from "react"

import {
  isModelId,
  modelsFor,
  providerForKey,
  type ModelId,
} from "@/lib/llm/models"
import { cn } from "@/lib/utils"

/**
 * The model picker: the models the stored key can reach, each with a
 * one-line note. Sized like the rest of the fields (40 px, 14 px text), and
 * the list opens as a card of rows rather than the browser's native menu.
 */
// "Dialog" is Excalidraw's marker: while an element with that class exists,
// a click outside its sidebar does not close it (it does on narrow windows
// otherwise, which would close the panel when picking from this overlay).
export function ModelSelect({
  apiKey,
  value,
  onChange,
  className,
}: {
  apiKey: string
  value: ModelId
  onChange: (model: ModelId) => void
  className?: string
}) {
  const models = modelsFor(providerForKey(apiKey))
  const current = models.find((m) => m.id === value)
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(v) => {
        if (typeof v === "string" && isModelId(v)) onChange(v)
      }}
    >
      <SelectPrimitive.Trigger
        aria-label="Model"
        className={cn(
          "pressable flex h-10 w-full items-center justify-between gap-3 rounded-lg bg-secondary px-3.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
          className
        )}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-medium">
            {current?.label ?? value}
          </span>
          {current?.note && (
            <span className="truncate text-xs text-muted-foreground">
              {current.note}
            </span>
          )}
        </span>
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          strokeWidth={2}
          className="size-4 shrink-0 text-muted-foreground"
        />
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          sideOffset={6}
          alignItemWithTrigger={false}
          className="z-[210]"
        >
          <SelectPrimitive.Popup className="Dialog w-(--anchor-width) min-w-64 origin-(--transform-origin) rounded-xl bg-background p-1.5 text-foreground ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:duration-150 data-open:ease-[var(--ease-out-strong)] data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:duration-100 data-closed:fade-out-0 data-closed:zoom-out-98">
            <SelectPrimitive.List>
              {models.map((m) => (
                <SelectPrimitive.Item
                  key={m.id}
                  value={m.id}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm outline-none select-none data-highlighted:bg-accent data-selected:font-medium"
                >
                  <SelectPrimitive.ItemText className="flex min-w-0 flex-col">
                    <span>{m.label}</span>
                    {m.note && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {m.note}
                      </span>
                    )}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator
                    render={
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        strokeWidth={2}
                        className="size-4 shrink-0"
                      />
                    }
                  />
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
