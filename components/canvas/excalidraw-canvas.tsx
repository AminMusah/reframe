"use client"

import { Excalidraw } from "@excalidraw/excalidraw"
import "@excalidraw/excalidraw/index.css"
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { useTheme } from "next-themes"
import * as React from "react"

import type { Id } from "@/convex/_generated/dataModel"
import { useAutosave, type SaveStatus } from "@/hooks/use-autosave"
import type { SerializedScene } from "@/lib/serializer"

import { loadScene } from "./load-scene"

export type CanvasProps = {
  projectId: Id<"projects">
  project: { sceneHash?: string; sceneUrl: string | null }
  onStatus?: (status: SaveStatus) => void
  onScene?: (scene: SerializedScene | null, sceneHash: string | null) => void
  onApi?: (api: ExcalidrawImperativeAPI | null) => void
}

export default function ExcalidrawCanvas({
  projectId,
  project,
  onStatus,
  onScene,
  onApi,
}: CanvasProps) {
  const { resolvedTheme } = useTheme()
  const { onChange, status, scene, sceneHash, prime } = useAutosave(projectId)

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

  return (
    <div className="h-full w-full">
      <Excalidraw
        initialData={initialData}
        onChange={onChange}
        onExcalidrawAPI={(api) => onApi?.(api)}
        theme={resolvedTheme === "dark" ? "dark" : "light"}
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false },
        }}
      />
    </div>
  )
}
