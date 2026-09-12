"use client"

import { getSceneVersion, serializeAsJSON } from "@excalidraw/excalidraw"
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types"
import { useMutation } from "convex/react"
import * as React from "react"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { markMirrorClean, writeMirror } from "@/lib/scene-store"
import {
  hashScene,
  serializeScene,
  type SerializedScene,
} from "@/lib/serializer"

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error"

/** Wait this long after the last edit before saving… */
const IDLE_MS = 1500
/** …but never longer than this after the first unsaved edit. */
const MAX_WAIT_MS = 10_000

type Snapshot = {
  elements: readonly ExcalidrawElement[]
  appState: AppState
  files: BinaryFiles
}

export function useAutosave(projectId: Id<"projects">) {
  const generateUploadUrl = useMutation(api.projects.generateUploadUrl)
  const saveScene = useMutation(api.projects.saveScene)

  const [status, setStatus] = React.useState<SaveStatus>("idle")
  const [scene, setScene] = React.useState<SerializedScene | null>(null)

  const latest = React.useRef<Snapshot | null>(null)
  const lastVersion = React.useRef<number | null>(null)
  const idleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = React.useRef(false)
  // Timers call the latest flush without the callback needing to reference itself.
  const flushRef = React.useRef<() => Promise<void>>(async () => {})

  const clearTimers = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    if (maxTimer.current) clearTimeout(maxTimer.current)
    idleTimer.current = null
    maxTimer.current = null
  }

  const flush = React.useCallback(async () => {
    clearTimers()
    const snap = latest.current
    if (!snap || inFlight.current) return
    inFlight.current = true
    setStatus("saving")

    const serialized = serializeScene(snap.elements)
    setScene(serialized)
    const sceneHash = await hashScene(serialized.text)
    const json = serializeAsJSON(
      snap.elements,
      snap.appState,
      snap.files,
      "local"
    )
    writeMirror(projectId, {
      json,
      sceneHash,
      dirty: true,
      savedAt: Date.now(),
    })

    const versionAtFlush = getSceneVersion(snap.elements)
    try {
      const uploadUrl = await generateUploadUrl()
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
      })
      if (!res.ok) throw new Error(`upload failed: ${res.status}`)
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> }
      await saveScene({ id: projectId, storageId, sceneHash })
      markMirrorClean(projectId)
      // Edits that arrived mid-upload keep the dirty state and get their own save.
      const stillCurrent =
        latest.current &&
        getSceneVersion(latest.current.elements) === versionAtFlush
      setStatus(stillCurrent ? "saved" : "dirty")
      if (!stillCurrent)
        idleTimer.current = setTimeout(() => void flushRef.current(), IDLE_MS)
    } catch (err) {
      console.error(err)
      setStatus("error")
      // The mirror still holds the work; try again once the connection is back.
      idleTimer.current = setTimeout(() => void flushRef.current(), MAX_WAIT_MS)
    } finally {
      inFlight.current = false
    }
  }, [generateUploadUrl, projectId, saveScene])
  React.useEffect(() => {
    flushRef.current = flush
  }, [flush])

  const schedule = React.useCallback(() => {
    setStatus("dirty")
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => void flushRef.current(), IDLE_MS)
    if (!maxTimer.current)
      maxTimer.current = setTimeout(() => void flushRef.current(), MAX_WAIT_MS)
  }, [])

  /** Excalidraw's onChange: fires on every pointer move, so bail unless an element version changed. */
  const onChange = React.useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles
    ) => {
      const version = getSceneVersion(elements)
      latest.current = { elements, appState, files }
      if (lastVersion.current === null) {
        // First call is Excalidraw mounting the initial data — nothing to save yet.
        lastVersion.current = version
        setScene(serializeScene(elements))
        return
      }
      if (version === lastVersion.current) return
      lastVersion.current = version
      schedule()
    },
    [schedule]
  )

  /** Force a save cycle, e.g. when the mirror was loaded dirty. */
  const markDirty = React.useCallback(() => {
    lastVersion.current = -1
    schedule()
  }, [schedule])

  // Unload: the async upload can't be awaited, but the mirror can be written synchronously.
  React.useEffect(() => {
    const persist = () => {
      const snap = latest.current
      if (!snap || status === "saved" || status === "idle") return
      const json = serializeAsJSON(
        snap.elements,
        snap.appState,
        snap.files,
        "local"
      )
      writeMirror(projectId, {
        json,
        sceneHash: "",
        dirty: true,
        savedAt: Date.now(),
      })
    }
    const onVisibility = () =>
      document.visibilityState === "hidden" && persist()
    window.addEventListener("beforeunload", persist)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.removeEventListener("beforeunload", persist)
      document.removeEventListener("visibilitychange", onVisibility)
      clearTimers()
    }
  }, [projectId, status])

  return { onChange, status, scene, markDirty }
}
