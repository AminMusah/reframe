"use client"

import * as React from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"

const GROUPS: { title: string; rows: [string, string[]][] }[] = [
  {
    title: "Drawing",
    rows: [
      ["Select", ["V"]],
      ["Rectangle", ["R"]],
      ["Ellipse", ["O"]],
      ["Arrow", ["A"]],
      ["Line", ["L"]],
      ["Text", ["T"]],
      ["Sticky note", ["N"]],
      ["Pen", ["P"]],
      ["Paste a screenshot", ["Ctrl", "V"]],
      ["Snap to angle / keep ratio", ["Shift", "drag"]],
      ["Duplicate", ["Ctrl", "D"]],
      ["Delete", ["Backspace"]],
      ["Undo / Redo", ["Ctrl", "Z"]],
    ],
  },
  {
    title: "Canvas",
    rows: [
      ["Pan", ["Space", "drag"]],
      ["Zoom", ["Ctrl", "wheel"]],
      ["Fit everything", ["Shift", "1"]],
      ["Zoom to 100%", ["Ctrl", "0"]],
      ["Find on canvas", ["Ctrl", "F"]],
    ],
  },
  {
    title: "Interview",
    rows: [
      ["Pick an option", ["1–5"]],
      ["Send a written answer", ["Enter"]],
      ["New line in an answer", ["Shift", "Enter"]],
      ["Close the panel", ["Esc"]],
    ],
  },
]

/** Our own help: the shortcuts that matter here, nothing else. */
export function HelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Draw with the keyboard, answer with the number keys.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-3">
          {GROUPS.map((g) => (
            <section key={g.title} className="space-y-2">
              <h3 className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                {g.title}
              </h3>
              <dl className="space-y-1.5 text-sm">
                {g.rows.map(([label, keys]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-4"
                  >
                    <dt className="whitespace-nowrap text-foreground">
                      {label}
                    </dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {keys.map((k, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && (
                            <span className="text-xs text-muted-foreground">
                              +
                            </span>
                          )}
                          <Kbd>{k}</Kbd>
                        </React.Fragment>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
