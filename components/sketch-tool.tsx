"use client"

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { useAction, useMutation } from "convex/react"
import * as React from "react"

import { exportPng } from "@/components/interview-panel"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import { applySketch, placeSketch } from "@/lib/edits/sketch-apply"
import type { ModelId } from "@/lib/llm/models"

/**
 * Sketch from reference: turn a picture on the canvas (screenshot, photo of a
 * whiteboard) into editable shapes with real layout. Applied immediately;
 * Undo restores the snapshot until the next sketch.
 */
export function SketchTool({
  excalidrawApi,
  apiKey,
  model,
  hasImage,
}: {
  excalidrawApi: React.RefObject<ExcalidrawImperativeAPI | null>
  apiKey: string
  model: ModelId
  hasImage: boolean
}) {
  const fromReference = useAction(api.sketchActions.fromReference)
  const generateUploadUrl = useMutation(api.projects.generateUploadUrl)
  const [open, setOpen] = React.useState(hasImage)
  const [instruction, setInstruction] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [last, setLast] = React.useState<{
    snapshot: readonly ExcalidrawElement[]
    count: number
  } | null>(null)

  const run = async (mode: "add" | "replace") => {
    const excalidraw = excalidrawApi.current
    if (!excalidraw) return
    setBusy(true)
    setError(null)
    try {
      const pngFileId = await exportPng(excalidraw, generateUploadUrl)
      if (!pngFileId) throw new Error("Nothing on the canvas to read")
      const result = await fromReference({
        pngFileId,
        apiKey,
        model,
        instruction: instruction || undefined,
      })
      if ("error" in result) throw new Error(result.message)
      if (result.sketch.nodes.length === 0) {
        throw new Error("No diagram found in the picture")
      }
      const { convertToExcalidrawElements, CaptureUpdateAction } =
        await import("@excalidraw/excalidraw")
      const before = excalidraw.getSceneElements()
      const placement = placeSketch(before, mode)
      const { elements, ids } = applySketch(
        result.sketch,
        placement,
        convertToExcalidrawElements
      )
      // Replace keeps pictures and frames (the reference itself); shapes go.
      const kept =
        mode === "replace"
          ? before.map((el) =>
              el.type === "image" ||
              el.type === "frame" ||
              el.type === "magicframe"
                ? el
                : { ...el, isDeleted: true, version: el.version + 1 }
            )
          : [...before]
      excalidraw.updateScene({
        elements: [...kept, ...elements],
        appState: {
          selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])),
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      })
      const added = excalidraw
        .getSceneElements()
        .filter((el) => ids.includes(el.id))
      if (added.length) {
        void excalidraw.setViewport({
          target: added,
          fit: "scale-down",
          animation: true,
        })
      }
      setLast({ snapshot: before, count: result.sketch.nodes.length })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    const excalidraw = excalidrawApi.current
    if (!excalidraw || !last) return
    const { CaptureUpdateAction } = await import("@excalidraw/excalidraw")
    excalidraw.updateScene({
      elements: last.snapshot,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    setLast(null)
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left text-sm font-medium"
      >
        <span>Sketch from reference</span>
        <span className="text-xs text-muted-foreground">
          {open ? "hide" : "show"}
        </span>
      </button>
      {open && (
        <>
          <p className="text-xs text-muted-foreground">
            {hasImage
              ? "Redraws the picture on your canvas as editable shapes with matching layout."
              : "Paste a screenshot or photo of a diagram onto the canvas first, then redraw it as editable shapes."}
          </p>
          <Textarea
            rows={2}
            placeholder="Optional: what to reproduce, or what to leave out"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={busy}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => run("add")}
              disabled={busy || !hasImage}
            >
              {busy ? <Spinner /> : "Sketch below"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => run("replace")}
              disabled={busy || !hasImage}
            >
              Replace shapes
            </Button>
            {last && (
              <Button size="sm" variant="ghost" onClick={undo} disabled={busy}>
                Undo sketch ({last.count} shapes)
              </Button>
            )}
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </>
      )}
    </div>
  )
}
