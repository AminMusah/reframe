"use client"

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { useMutation, useQuery } from "convex/react"
import { useRouter, useSearchParams } from "next/navigation"
import * as React from "react"

import { Canvas } from "@/components/canvas"
import { InterviewPanel } from "@/components/interview-panel"
import { AccountMenu } from "@/components/account-menu"
import { ProjectMenu } from "@/components/project-menu"
import { SettingsMenu } from "@/components/settings-menu"
import { Button } from "@/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { SaveStatus } from "@/hooks/use-autosave"
import type { SerializedScene } from "@/lib/serializer"
import { cn } from "@/lib/utils"

export function Workspace() {
  const params = useSearchParams()
  const router = useRouter()
  const projectId = params.get("p") as Id<"projects"> | null
  const openMostRecent = useMutation(api.projects.openMostRecent)

  // `/` without a project: open the most recent one (creating it if needed).
  React.useEffect(() => {
    if (projectId) return
    void openMostRecent().then((id) => router.replace(`/?p=${id}`))
  }, [openMostRecent, projectId, router])

  if (!projectId) return null
  return (
    <ProjectErrorBoundary key={projectId} onReset={() => router.replace("/")}>
      <Project projectId={projectId} />
    </ProjectErrorBoundary>
  )
}

function Project({ projectId }: { projectId: Id<"projects"> }) {
  const project = useQuery(api.projects.get, { id: projectId })
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
    <div className="flex h-dvh flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur">
        <Wordmark />
        <span className="text-muted-foreground/40" aria-hidden>
          /
        </span>
        <ProjectMenu currentId={projectId} currentName={project.name} />
        <SaveStatusLabel status={status} />
        <SettingsMenu />
        <AccountMenu />
      </header>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="65" minSize="30">
          <Canvas
            projectId={projectId}
            project={project}
            onStatus={setStatus}
            onScene={onScene}
            onApi={onApi}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="35" minSize="20" collapsible>
          <InterviewPanel
            projectId={projectId}
            scene={scene}
            sceneHash={sceneHash}
            excalidrawApi={apiRef}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

function Wordmark() {
  return (
    <span className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
      <span
        aria-hidden
        className="inline-block size-2.5 rounded-[3px] bg-foreground"
      />
      Reframe
    </span>
  )
}

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: "",
  dirty: "Unsaved",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed — retrying",
}

/** A dot that changes colour with the save state; the word fades in beside it. */
function SaveStatusLabel({ status }: { status: SaveStatus }) {
  return (
    <span
      className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground transition-opacity duration-200"
      style={{ opacity: status === "idle" ? 0 : 1 }}
      aria-live="polite"
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full transition-colors duration-200",
          status === "saved" && "bg-emerald-500",
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
        <p>That project doesn&apos;t exist or isn&apos;t yours.</p>
        <Button variant="outline" onClick={this.props.onReset}>
          Open my latest project
        </Button>
      </div>
    )
  }
}
