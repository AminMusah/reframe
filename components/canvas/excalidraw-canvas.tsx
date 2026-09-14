"use client"

import { Excalidraw, Sidebar, useHandleLibrary } from "@excalidraw/excalidraw"
import "@excalidraw/excalidraw/index.css"
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { FolderOpenIcon, SparklesIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTheme } from "next-themes"
import * as React from "react"

import type { Id } from "@/convex/_generated/dataModel"
import { useAutosave, type SaveStatus } from "@/hooks/use-autosave"
import { libraryAdapter } from "@/lib/library-store"
import type { SerializedScene } from "@/lib/serializer"

import { DrawingsList } from "@/components/project-menu"
import { applyEdit } from "@/lib/edits/apply"
import { serializeScene } from "@/lib/serializer"

import { Chrome, type ChromeDialog } from "./chrome"
import { loadScene } from "./load-scene"

export const PANEL = "reframe"
const DRAWINGS = "drawings"

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
      // Everything floats: Excalidraw's own sidebar (search, library) too.
      return {
        ...data,
        appState: { ...data?.appState, defaultSidebarDockedPreference: false },
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId]
  )

  // An interview in progress brings the panel with it on load.
  const opened = React.useRef(false)
  const [api, setApi] = React.useState<ExcalidrawImperativeAPI | null>(null)
  const apiReady = api !== null
  // Installs libraries arriving via #addLibrary (from libraries.excalidraw.com)
  // and persists the library in this browser.
  useHandleLibrary({ excalidrawAPI: api, adapter: libraryAdapter })
  const [panelShown, setPanelShown] = React.useState(false)
  // Fit the drawing on load when the saved viewport cannot be trusted to show
  // it: small screens, or a scene saved without one.
  const fitted = React.useRef(false)
  React.useEffect(() => {
    if (!api || fitted.current) return
    fitted.current = true
    const t = setTimeout(() => {
      const els = api.getSceneElements()
      const { scrollX, scrollY } = api.getAppState()
      const narrow = window.innerWidth < 900
      if (els.length && (narrow || (!scrollX && !scrollY))) {
        void api.setViewport({
          target: els,
          fit: "scale-down",
          offsets: { ui: true },
        })
      }
    }, 300)
    return () => clearTimeout(t)
  }, [api])

  React.useEffect(() => {
    if (panelOpen && apiReady && !opened.current && apiRef.current) {
      opened.current = true
      apiRef.current.toggleSidebar({ name: PANEL, force: true })
    }
  }, [panelOpen, apiReady])

  const loadExample = async () => {
    const api = apiRef.current
    if (!api) return
    const res = await fetch("/examples/signup-flow.excalidraw")
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
          setApi(api)
          onApi?.(api)
          if (process.env.NODE_ENV === "development") {
            // Test hook: replay edit ops against the live canvas (see scripts/).
            void import("@excalidraw/excalidraw").then((m) => {
              ;(window as unknown as Record<string, unknown>).__reframe = {
                api,
                applyEdit,
                serializeScene,
                convert: m.convertToExcalidrawElements,
                CaptureUpdateAction: m.CaptureUpdateAction,
              }
            })
          }
        }}
        theme={resolvedTheme === "dark" ? "dark" : "light"}
        // No Excalidraw AI tab; the Mermaid tab of that dialog is reached from our menu.
        aiEnabled={false}
        // "Browse libraries" sends the author to excalidraw.com and back here.
        libraryReturnUrl={
          typeof window === "undefined"
            ? undefined
            : `${window.location.origin}/?p=${projectId}`
        }
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false },
        }}
        renderTopRightUI={(isMobile) => (
          <>
            <button
              type="button"
              className="sidebar-trigger max-w-48 truncate"
              title="Drawings"
              onClick={() =>
                apiRef.current?.toggleSidebar({ name: DRAWINGS, force: true })
              }
            >
              {isMobile ? (
                <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
              ) : (
                project.name
              )}
            </button>
            <Sidebar.Trigger
              name={PANEL}
              title="A short interview, then a prompt for your coding agent"
              icon={<HugeiconsIcon icon={SparklesIcon} strokeWidth={2} />}
            >
              {/* Phones get the icon and a dot; the words need the room. */}
              {isMobile ? null : "Generate prompt"}
              {panelBadge &&
                !panelShown &&
                (isMobile ? (
                  <span
                    className="absolute top-1 right-1 size-2 rounded-full bg-lime ring-2 ring-background"
                    aria-label={panelBadge}
                  />
                ) : (
                  <span className="rounded-full bg-lime px-1.5 py-0.5 text-[10px] leading-none font-medium text-lime-foreground">
                    {panelBadge}
                  </span>
                ))}
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
          className="reframe-panel"
          onStateChange={(state) => setPanelShown(state?.name === PANEL)}
        >
          <Sidebar.Header>
            <span className="flex items-center gap-1.5 font-sans text-sm font-semibold tracking-tight text-foreground">
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-[3px] bg-lime"
              />
              Reframe
            </span>
          </Sidebar.Header>
          <div className="min-h-0 flex-1 font-sans text-foreground">
            {panel}
          </div>
        </Sidebar>
        <Sidebar name={DRAWINGS} className="reframe-panel reframe-panel--left">
          <Sidebar.Header>
            <span className="font-sans text-sm font-semibold tracking-tight text-foreground">
              Drawings
            </span>
          </Sidebar.Header>
          <div className="min-h-0 flex-1 font-sans text-foreground">
            <DrawingsList
              currentId={projectId}
              currentName={project.name}
              onClose={() =>
                apiRef.current?.toggleSidebar({ name: DRAWINGS, force: false })
              }
            />
          </div>
        </Sidebar>
      </Excalidraw>
    </div>
  )
}
