"use client"

import { useMutation, useQuery } from "convex/react"
import { ConvexError } from "convex/values"
import { useRouter } from "next/navigation"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/utils"

export function ProjectMenu({
  currentId,
  currentName,
}: {
  currentId: Id<"projects">
  currentName: string
}) {
  const router = useRouter()
  const projects = useQuery(api.projects.list)
  const create = useMutation(api.projects.create)
  const rename = useMutation(api.projects.rename)
  const [open, setOpen] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)

  const openProject = (id: Id<"projects">) => {
    setOpen(false)
    router.push(`/?p=${id}`)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="sm" className="font-medium">
            {currentName}
          </Button>
        }
      />
      <SheetContent side="left" className="w-80">
        <SheetHeader>
          <SheetTitle>Projects</SheetTitle>
          <SheetDescription>One drawing per project.</SheetDescription>
        </SheetHeader>

        <RenameForm
          key={`${currentId}:${currentName}`}
          initialName={currentName}
          onRename={(name) => rename({ id: currentId, name })}
        />

        <ul className="flex flex-col gap-1 overflow-y-auto px-4 py-2">
          {projects?.map((p) => (
            <li key={p._id}>
              <button
                type="button"
                onClick={() => openProject(p._id)}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                  p._id === currentId && "bg-accent font-medium"
                )}
              >
                {p.name}
              </button>
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
function RenameForm({
  initialName,
  onRename,
}: {
  initialName: string
  onRename: (name: string) => Promise<unknown>
}) {
  const [name, setName] = React.useState(initialName)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim() && name.trim() !== initialName) void onRename(name)
      }}
      className="flex gap-2 px-4"
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Project name"
      />
      <Button type="submit" variant="outline" size="sm">
        Rename
      </Button>
    </form>
  )
}
