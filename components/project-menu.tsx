"use client"

import { Delete02Icon, PencilEdit02Icon } from "@hugeicons/core-free-icons"
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
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useGoHome } from "@/hooks/use-go-home"
import { clearMirror } from "@/lib/scene-store"
import { cn } from "@/lib/utils"

/**
 * The drawing list (one project per drawing): open, create, delete. Rendered
 * inside an Excalidraw sidebar so it floats like the interview panel.
 */
export function DrawingsList({
  currentId,
  onClose,
}: {
  currentId: Id<"projects">
  onClose: () => void
}) {
  const router = useRouter()
  const goHome = useGoHome()
  const projects = useQuery(api.projects.list)
  const create = useMutation(api.projects.create)
  const remove = useMutation(api.projects.remove)
  const [createError, setCreateError] = React.useState<string | null>(null)
  const [confirmId, setConfirmId] = React.useState<Id<"projects"> | null>(null)
  const [renaming, setRenaming] = React.useState<{
    id: Id<"projects">
    name: string
  } | null>(null)

  const openProject = (id: Id<"projects">) => {
    onClose()
    router.push(`/?p=${id}`)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <p className="text-xs text-muted-foreground">
          Each drawing keeps its own interviews and prompts. An untitled one
          names itself from the drawing&apos;s title, or from the prompt once
          there is one.
        </p>
        <ul className="-mx-2 flex flex-col gap-0.5">
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
                        onClose()
                        await goHome()
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
                <span className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 has-[:focus-visible]:opacity-100">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Rename ${p.name}`}
                    onClick={() => setRenaming({ id: p._id, name: p.name })}
                  >
                    <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${p.name}`}
                    onClick={() => setConfirmId(p._id)}
                  >
                    <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-2 px-5 py-4">
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
                      "Couldn't create the drawing.")
                  : "Couldn't create the drawing."
              )
            }
          }}
        >
          New drawing
        </Button>
      </div>
      {renaming && (
        <RenameDialog
          key={renaming.id}
          open
          onOpenChange={(open) => {
            if (!open) setRenaming(null)
          }}
          projectId={renaming.id}
          initialName={renaming.name}
        />
      )}
    </div>
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
          <DialogTitle>Rename drawing</DialogTitle>
          <DialogDescription>
            Untitled drawings take their name from their title text
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
            aria-label="Drawing name"
          />
          <Button type="submit" disabled={!name.trim()}>
            Rename
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
