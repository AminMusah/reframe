"use client"

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { useAction, useMutation, useQuery } from "convex/react"
import * as React from "react"

import { BriefView } from "@/components/brief-view"
import { KeyForm } from "@/components/key-form"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { applyEdit } from "@/lib/edits/apply"
import { applySketch, placeSketch } from "@/lib/edits/sketch-apply"
import { useApiKey, useModel } from "@/lib/llm-settings"
import {
  hashScene,
  serializeScene,
  type SerializedScene,
} from "@/lib/serializer"

type Interview = Doc<"interviews">
type Turn = Interview["turns"][number]

export function InterviewPanel({
  projectId,
  scene,
  sceneHash,
  excalidrawApi,
}: {
  projectId: Id<"projects">
  scene: SerializedScene | null
  /** Hash of what is on the canvas now; differs from the interview's once the drawing changes. */
  sceneHash: string | null
  excalidrawApi: React.RefObject<ExcalidrawImperativeAPI | null>
}) {
  const interview = useQuery(api.interviews.latestForProject, { projectId })
  const [apiKey, setApiKey] = useApiKey()
  const [model] = useModel()
  const start = useMutation(api.interviews.start)
  const finish = useMutation(api.interviews.finish)
  const rebase = useMutation(api.interviews.rebase)
  const rejectEdit = useMutation(api.interviews.rejectEdit)
  const generateUploadUrl = useMutation(api.projects.generateUploadUrl)
  const step = useAction(api.interviewActions.step)
  const sketchFromReference = useAction(api.sketchActions.fromReference)
  const [busy, setBusy] = React.useState(false)
  const [startError, setStartError] = React.useState<string | null>(null)
  // "Keep going" silences the banner for one particular drawing state.
  const [ignoredHash, setIgnoredHash] = React.useState<string | null>(null)

  const currentQuestion = interview ? lastQuestion(interview.turns) : null
  const lastTurn = interview?.turns[interview.turns.length - 1]
  // A drawing change riding on the latest assistant turn: ops attached to a
  // question, a standalone edit, or a sketch. Edits are applied on arrival
  // (Undo stays available); a sketch replaces things, so it waits for Accept.
  const pendingChange =
    interview?.status === "awaiting_answer" &&
    lastTurn?.role === "assistant" &&
    (lastTurn.kind === "edit" ||
      lastTurn.kind === "sketch" ||
      (lastTurn.kind === "question" && (lastTurn.ops?.length ?? 0) > 0))
      ? lastTurn
      : null
  const changeKey = pendingChange ? interview!.turns.length : null
  const sketchPending = pendingChange?.kind === "sketch" ? pendingChange : null
  // While a change is in flight the canvas legitimately differs from the pinned hash.
  const drawingChanged =
    !!interview &&
    !!sceneHash &&
    interview.sceneHash !== sceneHash &&
    !pendingChange

  const [changeState, setChangeState] = React.useState<{
    key: number
    kind: "edit" | "sketch"
    text: string
    snapshot: readonly ExcalidrawElement[]
    skipped: string[]
    status: "working" | "applied" | "undone" | "failed" | "decided"
    failed?: string
    /** Told to the model with the next answer, so its ids stay right. */
    note?: string
  } | null>(null)

  /** Pin the interview to whatever is on the canvas now: hash, graph, PNG. */
  const rebaseToCanvas = async (
    excalidraw: ExcalidrawImperativeAPI,
    turnIndex: number
  ) => {
    const elements = excalidraw.getSceneElements()
    const serialized = serializeScene(elements)
    const newHash = await hashScene(serialized.text)
    const pngFileId = await exportPng(excalidraw, generateUploadUrl)
    await rebase({
      id: interview!._id,
      sceneHash: newHash,
      graph: serialized.text,
      pngFileId,
      turnIndex,
    })
    return serialized.text
  }

  const applyPending = async () => {
    const excalidraw = excalidrawApi.current
    if (!excalidraw || !pendingChange || changeKey === null || !interview)
      return
    const { convertToExcalidrawElements, CaptureUpdateAction } =
      await import("@excalidraw/excalidraw")
    const elements = excalidraw.getSceneElements()
    const turnIndex = changeKey - 1
    const kind = pendingChange.kind === "sketch" ? "sketch" : "edit"
    const text =
      pendingChange.kind === "question"
        ? (pendingChange.change ?? "Updated the drawing")
        : pendingChange.text
    const base = { key: changeKey, kind, text, snapshot: elements } as const

    let next: readonly ExcalidrawElement[]
    let changedIds: string[]
    let skipped: string[] = []
    if (pendingChange.kind === "sketch") {
      // Photograph the canvas, ask the vision model for shapes on a grid, build
      // them. The PNG upload is transient; the action deletes it.
      setChangeState({ ...base, skipped: [], status: "working" })
      try {
        const pngFileId = await exportPng(excalidraw, generateUploadUrl)
        if (!pngFileId) throw new Error("Nothing on the canvas to read")
        const result = await sketchFromReference({
          pngFileId,
          apiKey: apiKey!,
          model: interview.model,
          instruction: pendingChange.instruction || undefined,
        })
        if ("error" in result) throw new Error(result.message)
        if (result.sketch.nodes.length === 0) {
          throw new Error("No diagram was found in the picture")
        }
        const placement = placeSketch(elements, pendingChange.mode)
        const built = applySketch(
          result.sketch,
          placement,
          convertToExcalidrawElements
        )
        const kept =
          pendingChange.mode === "replace"
            ? elements.map((el) =>
                el.type === "image" ||
                el.type === "frame" ||
                el.type === "magicframe"
                  ? el
                  : { ...el, isDeleted: true, version: el.version + 1 }
              )
            : [...elements]
        next = [...kept, ...built.elements]
        changedIds = built.ids
      } catch (err) {
        setChangeState({
          ...base,
          skipped: [],
          status: "failed",
          failed: err instanceof Error ? err.message : String(err),
        })
        return
      }
    } else {
      const ops =
        pendingChange.kind === "edit"
          ? pendingChange.ops
          : (pendingChange.ops ?? [])
      const serialized = serializeScene(elements)
      const result = applyEdit({
        elements,
        ops,
        idMap: serialized.idMap,
        boxes: serialized.boxes,
        convert: convertToExcalidrawElements,
      })
      next = result.elements
      changedIds = result.changedIds
      skipped = result.skipped
    }

    excalidraw.updateScene({
      elements: next,
      appState: {
        selectedElementIds: Object.fromEntries(
          changedIds.map((id) => [id, true])
        ),
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    const changed = excalidraw
      .getSceneElements()
      .filter((el) => changedIds.includes(el.id))
    if (changed.length > 0) {
      void excalidraw.setViewport({
        target: changed,
        fit: "scale-down",
        animation: true,
      })
    }

    if (kind === "sketch") {
      // Big and destructive: the author confirms before the interview moves on.
      setChangeState({ ...base, skipped, status: "applied" })
      return
    }
    // Edits are in force at once: pin the interview to the new drawing.
    setChangeState({ ...base, skipped, status: "working" })
    const graph = await rebaseToCanvas(excalidraw, turnIndex)
    const note = `(Your drawing change was applied. The drawing is now:\n\n${graph})`
    setChangeState({ ...base, skipped, status: "applied", note })
    if (pendingChange.kind === "edit" && apiKey) {
      // A standalone edit has no question to answer; hand the model the new
      // graph so it continues. The Undo link stays until the next answer.
      await step({ interviewId: interview._id, apiKey, answer: note })
    }
  }
  // The trigger is a query update (an external system); apply runs on the next
  // tick through a ref so the effect itself stays free of state changes.
  const applyRef = React.useRef(applyPending)
  React.useEffect(() => {
    applyRef.current = applyPending
  })
  const appliedKey = changeState?.key ?? null
  React.useEffect(() => {
    if (changeKey !== null && appliedKey !== changeKey) {
      const t = setTimeout(() => void applyRef.current(), 0)
      return () => clearTimeout(t)
    }
  }, [changeKey, appliedKey])

  /** Undo an applied edit: restore the snapshot and pin the interview back to it. */
  const undoChange = async () => {
    const excalidraw = excalidrawApi.current
    if (!excalidraw || !interview || !changeState) return
    setBusy(true)
    try {
      const { CaptureUpdateAction } = await import("@excalidraw/excalidraw")
      excalidraw.updateScene({
        elements: changeState.snapshot,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      })
      const turnIndex = changeState.key - 1
      const graph = await rebaseToCanvas(excalidraw, turnIndex)
      await rejectEdit({ id: interview._id, turnIndex })
      const note = `(You undid the last drawing change; the drawing is unchanged:\n\n${graph})`
      setChangeState({ ...changeState, status: "undone", note })
    } finally {
      setBusy(false)
    }
  }

  const acceptSketch = async () => {
    const excalidraw = excalidrawApi.current
    if (!excalidraw || !interview || !apiKey || !changeState) return
    setBusy(true)
    try {
      const graph = await rebaseToCanvas(excalidraw, changeState.key - 1)
      setChangeState({ ...changeState, status: "decided" })
      await step({
        interviewId: interview._id,
        apiKey,
        answer: `Applied. The drawing is now:\n\n${graph}`,
      })
    } finally {
      setBusy(false)
    }
  }

  const undoSketch = async () => {
    const excalidraw = excalidrawApi.current
    if (!excalidraw || !interview || !apiKey || !changeState) return
    setBusy(true)
    try {
      const { CaptureUpdateAction } = await import("@excalidraw/excalidraw")
      excalidraw.updateScene({
        elements: changeState.snapshot,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      })
      await rejectEdit({ id: interview._id, turnIndex: changeState.key - 1 })
      setChangeState({ ...changeState, status: "decided" })
      await step({
        interviewId: interview._id,
        apiKey,
        answer: "Undone — keep the drawing as it was.",
      })
    } finally {
      setBusy(false)
    }
  }

  // Highlight the elements a question cites, if the drawing still matches.
  useHighlight(
    excalidrawApi,
    interview?.status === "awaiting_answer" && !drawingChanged
      ? (currentQuestion?.elementIds ?? null)
      : null,
    scene?.idMap ?? null
  )

  const nodeCount = scene?.graph.nodes.length ?? 0

  /** Start an interview; `priorId` carries an earlier one's answers along. */
  const reframe = async (priorId?: Id<"interviews">) => {
    const excalidraw = excalidrawApi.current
    if (!excalidraw || !apiKey) return
    setBusy(true)
    setStartError(null)
    try {
      const elements = excalidraw.getSceneElements()
      const serialized = serializeScene(elements)
      const sceneHash = await hashScene(serialized.text)
      const pngFileId = await exportPng(excalidraw, generateUploadUrl)
      const interviewId = await start({
        projectId,
        sceneHash,
        graph: serialized.text,
        pngFileId,
        model,
        priorInterviewId: priorId,
      })
      await step({ interviewId, apiKey })
    } catch (err) {
      console.error(err)
      setStartError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const answer = async (text: string) => {
    if (!interview || !apiKey) return
    setBusy(true)
    try {
      // An applied or undone change travels with the answer so the model's ids match.
      const note =
        changeState?.kind === "edit" &&
        (changeState.status === "applied" || changeState.status === "undone")
          ? changeState.note
          : undefined
      if (changeState && note)
        setChangeState({ ...changeState, status: "decided" })
      await step({
        interviewId: interview._id,
        apiKey,
        answer: note ? `${note}\n\nAnswer: ${text}` : text,
      })
    } finally {
      setBusy(false)
    }
  }

  const retry = async () => {
    if (!interview || !apiKey) return
    setBusy(true)
    try {
      await step({ interviewId: interview._id, apiKey })
    } finally {
      setBusy(false)
    }
  }

  if (!apiKey || interview?.lastError === "bad_key") {
    return (
      <div className="p-4">
        <KeyForm
          rejected={interview?.lastError === "bad_key"}
          onSave={setApiKey}
        />
      </div>
    )
  }

  if (interview === undefined) return null

  const idle = !interview || interview.status === "done"

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {drawingChanged && ignoredHash !== sceneHash && (
          <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <p>Drawing changed since this interview started.</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => reframe(interview._id)}
                disabled={busy}
              >
                Restart with new drawing
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIgnoredHash(sceneHash)}
              >
                Keep going
              </Button>
            </div>
          </div>
        )}

        {interview && <Transcript turns={interview.turns} />}

        {interview?.status === "thinking" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Looking at the drawing…
          </p>
        )}

        {sketchPending && (
          <div className="space-y-3 rounded-md border p-3 text-sm">
            <p className="font-medium">✎ {sketchPending.text}</p>
            <p className="text-xs text-muted-foreground">
              {sketchPending.mode === "replace"
                ? "Redrawing the picture as editable shapes and clearing the earlier attempt."
                : "Redrawing the picture as editable shapes below the drawing."}
            </p>
            {changeState?.key === changeKey &&
              changeState.status === "working" && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner /> Reading the picture…
                </p>
              )}
            {changeState?.key === changeKey && changeState.failed && (
              <p className="text-xs text-destructive">{changeState.failed}</p>
            )}
            <div className="flex gap-2">
              {changeState?.key !== changeKey ? (
                <Button size="sm" onClick={applyPending} disabled={busy}>
                  Redraw now
                </Button>
              ) : changeState.status === "decided" ? (
                <Spinner />
              ) : changeState.status ===
                "working" ? null : changeState.status === "failed" ? (
                <>
                  <Button size="sm" onClick={applyPending} disabled={busy}>
                    Try again
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={undoSketch}
                    disabled={busy}
                  >
                    Skip
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" onClick={acceptSketch} disabled={busy}>
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={undoSketch}
                    disabled={busy}
                  >
                    Undo
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {interview?.status === "awaiting_answer" && !sketchPending && (
          <QuestionCard
            key={interview.turns.length}
            question={currentQuestion}
            change={
              changeState?.kind === "edit" && changeState.status !== "decided"
                ? {
                    text: changeState.text,
                    status: changeState.status,
                    skipped: changeState.skipped,
                    onUndo: undoChange,
                  }
                : null
            }
            disabled={busy}
            onAnswer={answer}
            onEnough={() => finish({ id: interview._id })}
          />
        )}

        {interview?.status === "error" && (
          <div className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
            <p>{ERROR_TEXT[interview.lastError ?? "network"]}</p>
            <Button size="sm" variant="outline" onClick={retry} disabled={busy}>
              Retry
            </Button>
          </div>
        )}

        {interview?.status === "done" && (
          <BriefView interviewId={interview._id} apiKey={apiKey} />
        )}
      </div>

      {idle && (
        <div className="space-y-3 border-t p-4">
          <Button
            className="w-full"
            onClick={() => reframe(interview?._id)}
            disabled={busy || nodeCount === 0}
          >
            {busy ? <Spinner /> : interview ? "Interview again" : "Reframe"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {nodeCount === 0
              ? "Draw something, then click Reframe."
              : interview
                ? "Starts a new interview that already knows your earlier answers."
                : `${nodeCount} element${nodeCount === 1 ? "" : "s"} will be sent with a PNG of the canvas.`}
          </p>
          {startError && (
            <p className="text-xs text-destructive">{startError}</p>
          )}
        </div>
      )}
    </div>
  )
}

const ERROR_TEXT: Record<NonNullable<Interview["lastError"]>, string> = {
  bad_key: "The API key was rejected.",
  billing:
    "The provider says this key has no remaining credit. Top up your account, then retry.",
  rate_limit: "The provider is rate-limiting this key. Try again in a moment.",
  invalid_output:
    "The model returned something unusable. Retry usually fixes it.",
  network: "Couldn't reach the model. Check your connection and retry.",
}

function lastQuestion(turns: Turn[]) {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t.role === "assistant" && t.kind === "question") return t
  }
  return null
}

function Transcript({ turns }: { turns: Turn[] }) {
  // Everything except the question currently being asked.
  const last = turns[turns.length - 1]
  const settled =
    last && last.role === "assistant" && last.kind !== "done"
      ? turns.slice(0, -1)
      : turns
  if (settled.length === 0) return null
  return (
    <ol className="space-y-3 text-sm">
      {settled.map((t, i) => (
        <li key={i}>
          {t.role === "user" ? (
            <p className="rounded-md bg-accent px-3 py-2">{t.answer}</p>
          ) : t.kind === "question" ? (
            <div className="space-y-1">
              {t.change && (
                <p className="text-xs text-muted-foreground">
                  ✎ {t.change}
                  {t.applied === false && " (undone)"}
                </p>
              )}
              <p className="text-muted-foreground">{t.text}</p>
            </div>
          ) : t.kind === "edit" || t.kind === "sketch" ? (
            <p className="text-muted-foreground">
              ✎ {t.text}
              {t.applied === false && " (undone)"}
            </p>
          ) : (
            <p className="rounded-md border px-3 py-2">{t.summary}</p>
          )}
        </li>
      ))}
    </ol>
  )
}

function QuestionCard({
  question,
  change,
  disabled,
  onAnswer,
  onEnough,
}: {
  question: Extract<Turn, { kind: "question" }> | null
  /** A drawing change that came with this question, already applied. */
  change: {
    text: string
    status: "working" | "applied" | "undone" | "failed"
    skipped: string[]
    onUndo: () => void
  } | null
  disabled: boolean
  onAnswer: (text: string) => void
  onEnough: () => void
}) {
  // Keyed on the turn count by the parent, so a new question starts blank.
  const [other, setOther] = React.useState("")
  if (!question) return null
  return (
    <div className="space-y-3">
      {change && (
        <div className="rounded-md border border-dashed px-3 py-2 text-xs">
          <span className="text-muted-foreground">✎ {change.text}</span>
          {change.status === "working" && <Spinner className="ml-2 inline" />}
          {change.status === "applied" && (
            <button
              type="button"
              onClick={change.onUndo}
              disabled={disabled}
              className="ml-2 underline-offset-2 hover:underline"
            >
              Undo
            </button>
          )}
          {change.status === "undone" && (
            <span className="ml-2 text-muted-foreground">(undone)</span>
          )}
          {change.status === "failed" && (
            <span className="ml-2 text-destructive">could not be applied</span>
          )}
          {change.skipped.length > 0 && (
            <p className="mt-1 text-destructive">
              Skipped: {change.skipped.join("; ")}
            </p>
          )}
        </div>
      )}
      <p className="text-sm font-medium" title={question.reason}>
        {question.text}
      </p>
      <div className="flex flex-col gap-2">
        {question.options.map((opt) => (
          <Button
            key={opt}
            variant="outline"
            className="h-auto justify-start py-2 text-left whitespace-normal"
            disabled={disabled}
            onClick={() => onAnswer(opt)}
          >
            {opt}
          </Button>
        ))}
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (other.trim()) onAnswer(other.trim())
        }}
      >
        <Textarea
          placeholder="Something else…"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          disabled={disabled}
          rows={2}
        />
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onEnough}
            disabled={disabled}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Enough — write the brief
          </button>
          <Button type="submit" size="sm" disabled={disabled || !other.trim()}>
            Send
          </Button>
        </div>
      </form>
    </div>
  )
}

/** Light-theme PNG capped at 1568 px on the long edge, uploaded to Convex storage. */
export async function exportPng(
  excalidraw: ExcalidrawImperativeAPI,
  generateUploadUrl: () => Promise<string>
): Promise<Id<"_storage"> | undefined> {
  const elements = excalidraw.getSceneElements()
  if (elements.length === 0) return undefined
  // Loaded on demand so Excalidraw stays out of the main bundle.
  const { exportToBlob } = await import("@excalidraw/excalidraw")
  const blob = await exportToBlob({
    elements,
    files: excalidraw.getFiles(),
    appState: {
      ...excalidraw.getAppState(),
      exportBackground: true,
      exportWithDarkMode: false,
      viewBackgroundColor: "#ffffff",
      theme: "light",
    },
    mimeType: "image/png",
    maxWidthOrHeight: 1568,
    exportPadding: 32,
  })
  const res = await fetch(await generateUploadUrl(), {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: blob,
  })
  if (!res.ok) throw new Error(`PNG upload failed: ${res.status}`)
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> }
  return storageId
}

/**
 * Select + scroll to the cited elements whenever the question changes, and
 * clear the selection when there is nothing to show. Short ids map back to
 * Excalidraw ids through the serializer's idMap.
 */
function useHighlight(
  excalidrawApi: React.RefObject<ExcalidrawImperativeAPI | null>,
  elementIds: string[] | null,
  idMap: Record<string, string> | null
) {
  const key = elementIds?.join(",") ?? ""
  React.useEffect(() => {
    const api = excalidrawApi.current
    if (!api || !idMap) return
    const ids = (key ? key.split(",") : [])
      .map((short) => idMap[short])
      .filter((id): id is string => !!id)
    const elements = api.getSceneElements().filter((el) => ids.includes(el.id))
    void import("@excalidraw/excalidraw").then(({ CaptureUpdateAction }) => {
      api.updateScene({
        appState: {
          selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])),
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      })
    })
    if (elements.length > 0) {
      void api.setViewport({
        target: elements,
        fit: "scale-down",
        animation: true,
      })
    }
    // idMap changes with every autosave; only the question should retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, excalidrawApi])
}
