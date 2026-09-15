"use client"

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { useQuery } from "convex/react"
import { useSearchParams } from "next/navigation"
import * as React from "react"

import { Canvas } from "@/components/canvas"
import { InterviewPanel } from "@/components/interview-panel"
import { Button } from "@/components/ui/button"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { SaveStatus } from "@/hooks/use-autosave"
import { useGoHome } from "@/hooks/use-go-home"
import type { SerializedScene } from "@/lib/serializer"
import { cn } from "@/lib/utils"

export function Workspace() {
  const params = useSearchParams()
  const projectId = params.get("p") as Id<"projects"> | null
  const goHome = useGoHome()

  // `/` without a project: open the most recent one (creating it if needed).
  React.useEffect(() => {
    if (projectId) return
    void goHome()
  }, [goHome, projectId])

  if (!projectId) return null
  return (
    <ProjectErrorBoundary key={projectId} onReset={goHome}>
      <Project projectId={projectId} />
    </ProjectErrorBoundary>
  )
}

/**
 * The canvas is the whole window. Menus, the project switcher and the
 * interview panel all live in Excalidraw's own slots (see canvas/chrome.tsx).
 */
function Project({ projectId }: { projectId: Id<"projects"> }) {
  const goHome = useGoHome()
  const project = useQuery(api.projects.get, { id: projectId })
  const interview = useQuery(api.interviews.latestForProject, { projectId })
  // Deleted, or a link to someone else's drawing: go to the latest one.
  React.useEffect(() => {
    if (project === null) void goHome()
  }, [project, goHome])
  const [status, setStatus] = React.useState<SaveStatus>("idle")
  const [scene, setScene] = React.useState<SerializedScene | null>(null)
  const [sceneHash, setSceneHash] = React.useState<string | null>(null)
  const onScene = React.useCallback(
    (s: SerializedScene | null, hash: string | null) => {
      setScene(s)
      setSceneHash(hash)
    },
    []
  )
  const apiRef = React.useRef<ExcalidrawImperativeAPI | null>(null)
  const onApi = React.useCallback((api: ExcalidrawImperativeAPI | null) => {
    apiRef.current = api
  }, [])

  if (!project) return null

  return (
    <div className="relative h-dvh">
      <Canvas
        projectId={projectId}
        project={project}
        panelOpen={!!interview && interview.status !== "done"}
        panelBadge={
          !interview || interview.status === "done"
            ? null
            : interview.status === "error"
              ? "Needs you"
              : `Question ${interview.turns.filter((t) => t.role === "assistant" && t.kind === "question").length}`
        }
        panel={
          <InterviewPanel
            projectId={projectId}
            scene={scene}
            sceneHash={sceneHash}
            excalidrawApi={apiRef}
          />
        }
        onStatus={setStatus}
        onScene={onScene}
        onApi={onApi}
      />
      <SaveStatusLabel status={status} />
    </div>
  )
}

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: "",
  dirty: "Unsaved",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed — retrying",
}

/** Bottom-centre, only while there is something to say. */
function SaveStatusLabel({ status }: { status: SaveStatus }) {
  const quiet = status === "idle" || status === "saved"
  return (
    <span
      className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-background/80 px-2.5 py-1 text-xs text-muted-foreground shadow-xs backdrop-blur transition-opacity duration-200"
      style={{ opacity: quiet ? 0 : 1 }}
      aria-live="polite"
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          status === "saving" && "animate-pulse bg-amber-500",
          status === "dirty" && "bg-amber-500",
          status === "error" && "bg-destructive"
        )}
      />
      {STATUS_LABEL[status]}
    </span>
  )
}

class ProjectErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 text-sm">
        <p>That drawing doesn&apos;t exist or isn&apos;t yours.</p>
        <Button variant="outline" onClick={this.props.onReset}>
          Open my latest drawing
        </Button>
      </div>
    )
  }
}
