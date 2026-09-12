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
import { applyEdit, describeOp } from "@/lib/edits/apply"
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
  const [busy, setBusy] = React.useState(false)
  const [startError, setStartError] = React.useState<string | null>(null)
  // "Keep going" silences the banner for one particular drawing state.
  const [ignoredHash, setIgnoredHash] = React.useState<string | null>(null)

  const currentQuestion = interview ? lastQuestion(interview.turns) : null
  const lastTurn = interview?.turns[interview.turns.length - 1]
  const pendingEdit =
    interview?.status === "awaiting_answer" &&
    lastTurn?.role === "assistant" &&
    lastTurn.kind === "edit"
      ? lastTurn
      : null
  const editKey = pendingEdit ? interview!.turns.length : null
  // While an edit is pending the canvas legitimately differs from the pinned hash.
  const drawingChanged =
    !!interview &&
    !!sceneHash &&
    interview.sceneHash !== sceneHash &&
    !pendingEdit

  // Agent edits: applied to the canvas as soon as they arrive, then Accept / Undo.
  // `decided` stays set until the next turn arrives, so the apply effect
  // cannot fire a second time while the answer is in flight.
  const [editState, setEditState] = React.useState<{
    key: number
    snapshot: readonly ExcalidrawElement[]
    skipped: string[]
    decided: boolean
  } | null>(null)

  const applyPending = async () => {
    const excalidraw = excalidrawApi.current
    if (!excalidraw || !pendingEdit || editKey === null) return
    const { convertToExcalidrawElements, CaptureUpdateAction } =
      await import("@excalidraw/excalidraw")
    const elements = excalidraw.getSceneElements()
    const serialized = serializeScene(elements)
    const result = applyEdit({
      elements,
      ops: pendingEdit.ops,
      idMap: serialized.idMap,
      boxes: serialized.boxes,
      convert: convertToExcalidrawElements,
    })
    excalidraw.updateScene({
      elements: result.elements,
      appState: {
        selectedElementIds: Object.fromEntries(
          result.changedIds.map((id) => [id, true])
        ),
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    const changed = excalidraw
      .getSceneElements()
      .filter((el) => result.changedIds.includes(el.id))
    if (changed.length > 0) {
      void excalidraw.setViewport({
        target: changed,
        fit: "scale-down",
        animation: true,
      })
    }
    setEditState({
      key: editKey,
      snapshot: elements,
      skipped: result.skipped,
      decided: false,
    })
  }
  // The trigger is a query update (an external system); apply runs on the next
  // tick through a ref so the effect itself stays free of state changes.
  const applyRef = React.useRef(applyPending)
  React.useEffect(() => {
    applyRef.current = applyPending
  })
  const appliedKey = editState?.key ?? null
  React.useEffect(() => {
    if (editKey !== null && appliedKey !== editKey) {
      const t = setTimeout(() => void applyRef.current(), 0)
      return () => clearTimeout(t)
    }
  }, [editKey, appliedKey])

  const acceptEdit = async () => {
    const excalidraw = excalidrawApi.current
    if (!excalidraw || !interview || !apiKey) return
    setBusy(true)
    try {
      const elements = excalidraw.getSceneElements()
      const serialized = serializeScene(elements)
      const newHash = await hashScene(serialized.text)
      const pngFileId = await exportPng(excalidraw, generateUploadUrl)
      await rebase({
        id: interview._id,
        sceneHash: newHash,
        graph: serialized.text,
        pngFileId,
      })
      setEditState((st) => (st ? { ...st, decided: true } : st))
      await step({
        interviewId: interview._id,
        apiKey,
        answer: `Applied. The drawing is now:

${serialized.text}`,
      })
    } finally {
      setBusy(false)
    }
  }

  const undoEdit = async () => {
    const excalidraw = excalidrawApi.current
    if (!excalidraw || !interview || !apiKey) return
    setBusy(true)
    try {
      if (editState) {
        const { CaptureUpdateAction } = await import("@excalidraw/excalidraw")
        excalidraw.updateScene({
          elements: editState.snapshot,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        })
      }
      await rejectEdit({ id: interview._id })
      setEditState((st) => (st ? { ...st, decided: true } : st))
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
      await step({ interviewId: interview._id, apiKey, answer: text })
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

        {pendingEdit && (
          <div className="space-y-3 rounded-md border p-3 text-sm">
            <p className="font-medium">✎ {pendingEdit.text}</p>
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {pendingEdit.ops.map((op, i) => (
                <li key={i}>{describeOp(op)}</li>
              ))}
            </ul>
            {editState?.skipped.length ? (
              <p className="text-xs text-destructive">
                Skipped: {editState.skipped.join("; ")}
              </p>
            ) : null}
            <div className="flex gap-2">
              {editState?.key === editKey && editState.decided ? (
                <Spinner />
              ) : editState?.key === editKey ? (
                <>
                  <Button size="sm" onClick={acceptEdit} disabled={busy}>
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={undoEdit}
                    disabled={busy}
                  >
                    Undo
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={applyPending} disabled={busy}>
                  Apply to drawing
                </Button>
              )}
            </div>
          </div>
        )}

        {interview?.status === "awaiting_answer" && !pendingEdit && (
          <QuestionCard
            key={interview.turns.length}
            question={currentQuestion}
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
        <div className="space-y-2 border-t p-4">
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
            <p className="text-muted-foreground">{t.text}</p>
          ) : t.kind === "edit" ? (
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
  disabled,
  onAnswer,
  onEnough,
}: {
  question: Extract<Turn, { kind: "question" }> | null
  disabled: boolean
  onAnswer: (text: string) => void
  onEnough: () => void
}) {
  // Keyed on the turn count by the parent, so a new question starts blank.
  const [other, setOther] = React.useState("")
  if (!question) return null
  return (
    <div className="space-y-3">
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
async function exportPng(
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
