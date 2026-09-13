"use client"

import { Delete02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery } from "convex/react"
import { ConvexError } from "convex/values"
import { useRouter } from "next/navigation"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { clearMirror } from "@/lib/scene-store"
import { cn } from "@/lib/utils"

/** The project list: open, create, delete. Opened from the canvas menu. */
export function ProjectsSheet({
  open,
  onOpenChange,
  currentId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentId: Id<"projects">
}) {
  const router = useRouter()
  const projects = useQuery(api.projects.list)
  const create = useMutation(api.projects.create)
  const remove = useMutation(api.projects.remove)
  const [createError, setCreateError] = React.useState<string | null>(null)
  const [confirmId, setConfirmId] = React.useState<Id<"projects"> | null>(null)

  const openProject = (id: Id<"projects">) => {
    onOpenChange(false)
    router.push(`/?p=${id}`)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-80">
        <SheetHeader>
          <SheetTitle>Projects</SheetTitle>
          <SheetDescription>
            One drawing per project. Names come from the drawing&apos;s title.
          </SheetDescription>
        </SheetHeader>

        <ul className="flex flex-col gap-0.5 overflow-y-auto px-2 py-1">
          {projects?.map((p) => (
            <li key={p._id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => openProject(p._id)}
                className={cn(
                  "pressable min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                  p._id === currentId && "bg-accent font-medium"
                )}
              >
                {p.name}
              </button>
              {confirmId === p._id ? (
                <span className="flex shrink-0 items-center gap-1 text-xs">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      await remove({ id: p._id })
                      clearMirror(p._id)
                      setConfirmId(null)
                      if (p._id === currentId) {
                        onOpenChange(false)
                        router.replace("/")
                      }
                    }}
                  >
                    Delete
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmId(null)}
                  >
                    Keep
                  </Button>
                </span>
              ) : (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete ${p.name}`}
                  className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => setConfirmId(p._id)}
                >
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-auto space-y-2 px-4 pb-4">
          {createError && (
            <p className="text-xs text-destructive">{createError}</p>
          )}
          <Button
            className="w-full"
            onClick={async () => {
              setCreateError(null)
              try {
                openProject(await create({}))
              } catch (err) {
                setCreateError(
                  err instanceof ConvexError
                    ? ((err.data as { message?: string }).message ??
                        "Couldn't create the project.")
                    : "Couldn't create the project."
                )
              }
            }}
          >
            New project
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Keyed on the current name by the parent, so a server rename resets the field. */
export function RenameDialog({
  open,
  onOpenChange,
  projectId,
  initialName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: Id<"projects">
  initialName: string
}) {
  const rename = useMutation(api.projects.rename)
  const [name, setName] = React.useState(initialName)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
          <DialogDescription>
            Untitled projects take their name from the drawing&apos;s title
            automatically.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (name.trim()) await rename({ id: projectId, name })
            onOpenChange(false)
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Project name"
          />
          <Button type="submit" disabled={!name.trim()}>
            Rename
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
