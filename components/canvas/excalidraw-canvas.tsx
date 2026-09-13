"use client"

import { Excalidraw, Sidebar } from "@excalidraw/excalidraw"
import "@excalidraw/excalidraw/index.css"
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { SparklesIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTheme } from "next-themes"
import * as React from "react"

import type { Id } from "@/convex/_generated/dataModel"
import { useAutosave, type SaveStatus } from "@/hooks/use-autosave"
import type { SerializedScene } from "@/lib/serializer"

import { Chrome, type ChromeDialog } from "./chrome"
import { loadScene } from "./load-scene"

export const PANEL = "reframe"
const DOCK_KEY = "reframe:panel-docked"

export type CanvasProps = {
  projectId: Id<"projects">
  project: { name: string; sceneHash?: string; sceneUrl: string | null }
  /** The interview panel, rendered inside Excalidraw's sidebar slot. */
  panel: React.ReactNode
  /** Open the panel as soon as the canvas is ready (an interview is underway). */
  panelOpen: boolean
  /** Shown on the panel trigger while it is closed, e.g. "Question 4". */
  panelBadge?: string | null
  onStatus?: (status: SaveStatus) => void
  onScene?: (scene: SerializedScene | null, sceneHash: string | null) => void
  onApi?: (api: ExcalidrawImperativeAPI | null) => void
}

export default function ExcalidrawCanvas({
  projectId,
  project,
  panel,
  panelOpen,
  panelBadge,
  onStatus,
  onScene,
  onApi,
}: CanvasProps) {
  const { resolvedTheme } = useTheme()
  const { onChange, status, scene, sceneHash, prime } = useAutosave(projectId)
  const apiRef = React.useRef<ExcalidrawImperativeAPI | null>(null)
  const [dialog, setDialog] = React.useState<ChromeDialog>(null)
  // Floats over the canvas unless the author pins it. Lazy initial read:
  // this component only renders client-side.
  const [docked, setDocked] = React.useState(() => {
    try {
      return localStorage.getItem(DOCK_KEY) === "1"
    } catch {
      return false
    }
  })

  React.useEffect(() => onStatus?.(status), [onStatus, status])
  React.useEffect(
    () => onScene?.(scene, sceneHash),
    [onScene, scene, sceneHash]
  )

  // Read once on mount; later project updates are our own saves echoing back.
  const initialData = React.useMemo(
    () => async () => {
      const { data, dirty } = await loadScene(projectId, project)
      prime(data, dirty)
      return data
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId]
  )

  // An interview in progress brings the panel with it on load.
  const opened = React.useRef(false)
  const [apiReady, setApiReady] = React.useState(false)
  const [panelShown, setPanelShown] = React.useState(false)
  React.useEffect(() => {
    if (panelOpen && apiReady && !opened.current && apiRef.current) {
      opened.current = true
      apiRef.current.toggleSidebar({ name: PANEL, force: true })
    }
  }, [panelOpen, apiReady])

  const loadExample = async () => {
    const api = apiRef.current
    if (!api) return
    const res = await fetch("/examples/three-tier.excalidraw")
    const file = (await res.json()) as {
      elements: unknown[]
      appState?: Record<string, unknown>
      files?: Record<string, unknown>
    }
    const { CaptureUpdateAction } = await import("@excalidraw/excalidraw")
    api.updateScene({
      elements: file.elements as never,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    void api.setViewport({
      target: api.getSceneElements(),
      fit: "scale-down",
      animation: true,
      offsets: { ui: true },
    })
  }

  return (
    <div className="h-full w-full">
      <Excalidraw
        initialData={initialData}
        onChange={onChange}
        onExcalidrawAPI={(api) => {
          apiRef.current = api
          setApiReady(true)
          onApi?.(api)
        }}
        theme={resolvedTheme === "dark" ? "dark" : "light"}
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false },
        }}
        renderTopRightUI={() => (
          <>
            <button
              type="button"
              className="sidebar-trigger max-w-48 truncate"
              title="Drawings"
              onClick={() => setDialog("projects")}
            >
              {project.name}
            </button>
            <Sidebar.Trigger
              name={PANEL}
              title="A short interview, then a prompt for your coding agent"
              icon={<HugeiconsIcon icon={SparklesIcon} strokeWidth={2} />}
            >
              Generate prompt
              {panelBadge && !panelShown && (
                <span className="rounded-full bg-foreground px-1.5 py-0.5 text-[10px] leading-none font-medium text-background">
                  {panelBadge}
                </span>
              )}
            </Sidebar.Trigger>
          </>
        )}
      >
        <Chrome
          projectId={projectId}
          projectName={project.name}
          api={apiRef}
          dialog={dialog}
          setDialog={setDialog}
          onLoadExample={loadExample}
        />
        <Sidebar
          name={PANEL}
          docked={docked}
          onDock={(d) => {
            setDocked(d)
            try {
              localStorage.setItem(DOCK_KEY, d ? "1" : "0")
            } catch {}
          }}
          className="reframe-panel"
          onStateChange={(state) => setPanelShown(state?.name === PANEL)}
        >
          <Sidebar.Header>
            <span className="flex items-center gap-1.5 font-sans text-sm font-semibold tracking-tight text-foreground">
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-[3px] bg-foreground"
              />
              Reframe
            </span>
          </Sidebar.Header>
          <div className="min-h-0 flex-1 font-sans text-foreground">
            {panel}
          </div>
        </Sidebar>
      </Excalidraw>
    </div>
  )
}
