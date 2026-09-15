"use client"

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { useAction, useMutation, useQuery } from "convex/react"
import { ConvexError } from "convex/values"
import * as React from "react"

import {
  ArrowTurnBackwardIcon,
  Image02Icon,
  PencilEdit02Icon,
  Sent02Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { BriefView } from "@/components/brief-view"
import { KeyForm } from "@/components/key-form"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "cn"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { applyEdit } from "@/lib/edits/apply"
import { describeProblems } from "@/lib/edits/layout"
import { applySketch, placeSketch } from "@/lib/edits/sketch-apply"
import { useApiKey, useModel } from "@/lib/llm-settings"
import { isModelId, modelsFor, providerForKey } from "@/lib/llm/models"
import {
  hashScene,
  serializeScene,
  type SerializedScene,
} from "@/lib/serializer"

type Interview = Doc<"interviews">

const isConvexCode = (err: unknown, code: string) =>
  err instanceof ConvexError &&
  (err.data as { code?: string } | undefined)?.code === code
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
  const [model, setModel] = useModel()
  const start = useMutation(api.interviews.start)
  const finish = useMutation(api.interviews.finish)
  const rebase = useMutation(api.interviews.rebase)
  const rejectEdit = useMutation(api.interviews.rejectEdit)
  const rewind = useMutation(api.interviews.rewind)
  const generateUploadUrl = useMutation(api.projects.generateUploadUrl)
  const step = useAction(api.interviewActions.step)
  const sketchFromReference = useAction(api.sketchActions.fromReference)
  const [busy, setBusy] = React.useState(false)
  const [startError, setStartError] = React.useState<string | null>(null)
  // "Keep going" silences the banner for one particular drawing state.
  const [ignoredHash, setIgnoredHash] = React.useState<string | null>(null)
  // Index of a user turn being re-answered; the interview rewinds when sent.
  const [editing, setEditing] = React.useState<number | null>(null)

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
    let base = { key: changeKey, kind, text, snapshot: elements } as const
    let relaid = false

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
      if (result.relaid) {
        relaid = true
        base = { ...base, text: `${text} — and tidied the whole drawing` }
      }
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
    if (relaid || (changed.length > 0 && !inView(excalidraw, changed))) {
      void excalidraw.setViewport({
        target: relaid ? excalidraw.getSceneElements() : changed,
        fit: "scale-down",
        animation: true,
        offsets: { ui: true },
      })
    }

    if (kind === "sketch") {
      // Big and destructive: the author confirms before the interview moves on.
      setChangeState({ ...base, skipped, status: "applied" })
      return
    }
    // Edits are in force at once: pin the interview to the new drawing.
    setChangeState({ ...base, skipped, status: "working" })
    let graph: string
    try {
      graph = await rebaseToCanvas(excalidraw, turnIndex)
    } catch (err) {
      console.warn("could not pin the edited drawing", err)
      setChangeState({
        ...base,
        skipped,
        status: "failed",
        failed:
          "The change is on the canvas but could not be saved; it will be picked up with your next answer.",
      })
      return
    }
    // What the tidy pass could not fix, so the model can move things itself.
    const live = excalidraw.getSceneElements()
    const untidy = describeProblems(live, serializeScene(live).idMap)
    const note = `(Your drawing change was applied. The drawing is now:\n\n${graph})${
      untidy.length
        ? `\n\n(Still overlapping after tidying — fix with "move" ops if it matters: ${untidy.join("; ")})`
        : ""
    }`
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

  // Synchronous guard: a held key or a double tap fires again before the
  // re-render that disables the controls, and the server rejects the second
  // answer ("not_awaiting").
  const inFlight = React.useRef(false)
  const answer = async (text: string) => {
    if (!interview || !apiKey || inFlight.current) return
    if (interview.status !== "awaiting_answer" && editing === null) return
    inFlight.current = true
    setBusy(true)
    try {
      if (editing !== null) {
        // Drop the old answer and what followed, pin to the canvas as it is
        // now, then answer the question again.
        const excalidraw = excalidrawApi.current
        await rewind({ id: interview._id, turnIndex: editing })
        if (excalidraw) await rebaseToCanvas(excalidraw, editing - 1)
        setEditing(null)
        setChangeState(null)
        await step({ interviewId: interview._id, apiKey, answer: text })
        return
      }
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
    } catch (err) {
      // The answer already landed (a repeat submit); the doc tells the truth.
      if (!isConvexCode(err, "not_awaiting")) throw err
    } finally {
      inFlight.current = false
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

  if (interview === undefined) return null

  const idle = !interview || interview.status === "done"
  const needsKey = !apiKey || interview?.lastError === "bad_key"
  const editingQuestion =
    editing !== null && interview
      ? (interview.turns[editing - 1] as Extract<Turn, { kind: "question" }>)
      : null
  const editingAnswer =
    editing !== null && interview
      ? (interview.turns[editing] as Extract<Turn, { role: "user" }>)
      : null
  const doneTurn = interview?.turns.find(
    (t): t is Extract<Turn, { kind: "done" }> =>
      t.role === "assistant" && t.kind === "done"
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {drawingChanged && ignoredHash !== sceneHash && (
          <Notice tone="warn" className="enter">
            <p className="font-medium">
              The drawing changed since this interview started.
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={() => reframe(interview._id)}
                disabled={busy}
              >
                Restart with the new drawing
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIgnoredHash(sceneHash)}
              >
                Keep going
              </Button>
            </div>
          </Notice>
        )}

        {!interview && <EmptyState nodeCount={nodeCount} />}

        {interview && (
          <Transcript
            turns={interview.turns}
            editing={editing}
            onEdit={
              interview.status === "thinking" || busy
                ? undefined
                : (i) => setEditing(i)
            }
          />
        )}

        {editingQuestion && editingAnswer && (
          <QuestionCard
            key={`edit-${editing}`}
            number={countQuestions(interview!.turns.slice(0, editing!))}
            question={editingQuestion}
            change={null}
            disabled={busy}
            onAnswer={answer}
            onEnough={() => finish({ id: interview!._id })}
            editing={{
              previous: stripNote(editingAnswer.answer),
              later:
                interview!.turns
                  .slice(editing!)
                  .filter((t) => t.role === "user").length - 1,
              onCancel: () => setEditing(null),
            }}
          />
        )}

        {interview?.status === "thinking" && <Thinking />}

        {sketchPending && (
          <Card className="enter space-y-3">
            <CardTitle icon={Image02Icon}>{sketchPending.text}</CardTitle>
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
                    Keep it
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
          </Card>
        )}

        {interview?.status === "awaiting_answer" &&
          !sketchPending &&
          editing === null && (
            <QuestionCard
              key={interview.turns.length}
              number={countQuestions(interview.turns)}
              question={currentQuestion}
              change={
                changeState?.kind === "edit" && changeState.status !== "decided"
                  ? {
                      text: changeState.text,
                      status: changeState.status,
                      skipped: changeState.skipped,
                      failed: changeState.failed,
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
          <Notice tone="error" className="enter">
            <p>{ERROR_TEXT[interview.lastError ?? "network"]}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={retry}
              disabled={busy}
            >
              Retry
            </Button>
          </Notice>
        )}

        {interview?.status === "done" && (
          <div className="enter space-y-5">
            {doneTurn && (
              <div className="space-y-1.5 rounded-2xl bg-forest p-4 text-forest-foreground">
                <p className="flex items-center gap-2 text-xs font-medium tracking-wide uppercase opacity-80">
                  <HugeiconsIcon
                    icon={SparklesIcon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                  What we settled on
                </p>
                <p className="text-sm leading-relaxed">{doneTurn.summary}</p>
              </div>
            )}
            {apiKey && (
              <BriefView
                interviewId={interview._id}
                apiKey={apiKey}
                actions={
                  <Button
                    size="sm"
                    variant="ghost"
                    title="A new interview that already knows your earlier answers"
                    onClick={() => reframe(interview._id)}
                    disabled={busy || nodeCount === 0}
                  >
                    {busy ? <Spinner /> : "Interview again"}
                  </Button>
                }
              />
            )}
          </div>
        )}
      </div>

      {idle && needsKey && (
        <div className="enter px-5 py-4">
          <KeyForm
            rejected={interview?.lastError === "bad_key"}
            onSave={setApiKey}
          />
        </div>
      )}

      {!interview && !needsKey && (
        <div className="space-y-2 px-5 py-4">
          <label className="flex items-center justify-between gap-3 pb-1 text-sm">
            <span className="text-muted-foreground">Model</span>
            <NativeSelect
              size="sm"
              aria-label="Model"
              value={model}
              onChange={(e) => {
                if (isModelId(e.target.value)) setModel(e.target.value)
              }}
            >
              {modelsFor(providerForKey(apiKey!)).map((m) => (
                <NativeSelectOption key={m.id} value={m.id}>
                  {m.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <Button
            size="lg"
            className="w-full"
            onClick={() => reframe()}
            disabled={busy || nodeCount === 0}
          >
            {busy ? (
              <Spinner />
            ) : (
              <>
                <HugeiconsIcon
                  icon={SparklesIcon}
                  strokeWidth={2}
                  data-icon="inline-start"
                />
                Start the interview
              </>
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {nodeCount === 0
              ? "Draw something first."
              : `Sends ${nodeCount} element${nodeCount === 1 ? "" : "s"} and a picture of the canvas.`}
          </p>
          {startError && (
            <p className="text-center text-xs text-destructive">{startError}</p>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- surfaces ---------- */

function Card({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "rounded-xl bg-secondary p-4 text-sm text-card-foreground",
        className
      )}
    >
      {children}
    </div>
  )
}

function CardTitle({
  icon,
  children,
}: {
  icon: typeof SparklesIcon
  children: React.ReactNode
}) {
  return (
    <p className="flex items-start gap-2 font-medium">
      <HugeiconsIcon
        icon={icon}
        strokeWidth={2}
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
      <span>{children}</span>
    </p>
  )
}

function Notice({
  tone,
  className,
  children,
}: {
  tone: "warn" | "error"
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "rounded-xl p-4 text-sm",
        tone === "warn" && "bg-peach/30",
        tone === "error" && "bg-destructive/10",
        className
      )}
    >
      {children}
    </div>
  )
}

function EmptyState({ nodeCount }: { nodeCount: number }) {
  const steps = [
    ["Draw", "Boxes, arrows, scribbles, a screenshot — whatever says it."],
    ["Answer", "Usually 6–10 questions, one at a time, about what you drew."],
    ["Paste", "A prompt your coding agent can build from, in your words."],
  ] as const
  return (
    <div className="enter flex h-full flex-col justify-center gap-6 py-6">
      <div className="space-y-1">
        <p className="text-lg font-semibold tracking-tight">
          {nodeCount === 0 ? "Start on the canvas" : "Ready when you are"}
        </p>
        <p className="text-sm text-muted-foreground">
          {nodeCount === 0
            ? "Reframe turns a drawing into a prompt for your coding agent by asking you about it."
            : `${nodeCount} element${nodeCount === 1 ? "" : "s"} on the canvas. A short interview first, then the prompt.`}
        </p>
      </div>
      <ol className="enter-stagger space-y-3">
        {steps.map(([title, body], i) => (
          <li key={title} className="flex gap-3">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand font-mono text-[11px] font-medium text-brand-foreground">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-medium">{title}</p>
              <p className="text-xs text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Thinking() {
  return (
    <div className="enter space-y-2.5 rounded-xl border p-4" aria-live="polite">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Looking at the drawing…
      </p>
      <div className="space-y-2">
        <div className="h-2.5 w-4/5 animate-pulse rounded bg-muted" />
        <div className="h-2.5 w-3/5 animate-pulse rounded bg-muted" />
      </div>
    </div>
  )
}

function countQuestions(turns: Turn[]) {
  return turns.filter((t) => t.role === "assistant" && t.kind === "question")
    .length
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

function Transcript({
  turns,
  editing,
  onEdit,
}: {
  turns: Turn[]
  editing: number | null
  /** Re-answer the user turn at this index; absent while the model is busy. */
  onEdit?: (turnIndex: number) => void
}) {
  // Everything except the turn currently being acted on.
  const last = turns[turns.length - 1]
  const settled =
    last && last.role === "assistant" && last.kind !== "done"
      ? turns.slice(0, -1)
      : turns
  const [open, setOpen] = React.useState(false)
  const shown = open || editing !== null
  const answered = settled.filter((t) => t.role === "user").length
  if (answered === 0) return null
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="pressable flex w-full items-center justify-between rounded-md px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <span>{answered} answered</span>
        <span>{open ? "Hide" : "Show"}</span>
      </button>
      {shown && (
        <ol className="enter space-y-3 rounded-xl bg-secondary p-3 text-sm">
          {settled.map((t, i) => (
            <li key={i} className={cn(editing === i && "opacity-50")}>
              {t.role === "user" ? (
                <p className="group flex items-start justify-between gap-2 text-foreground">
                  <span>{stripNote(t.answer)}</span>
                  {onEdit && editing === null && (
                    <button
                      type="button"
                      onClick={() => onEdit(i)}
                      className="pressable shrink-0 rounded px-1 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
                    >
                      Change
                    </button>
                  )}
                </p>
              ) : t.kind === "question" ? (
                <div className="space-y-0.5">
                  {t.change && (
                    <p className="text-xs text-muted-foreground">
                      ✎ {t.change}
                      {t.applied === false && " (undone)"}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{t.text}</p>
                </div>
              ) : t.kind === "edit" || t.kind === "sketch" ? (
                <p className="text-xs text-muted-foreground">
                  ✎ {t.text}
                  {t.applied === false && " (undone)"}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** Answers carry a graph note for the model; the author only wrote the part after "Answer:". */
function stripNote(answer: string) {
  const i = answer.lastIndexOf("\n\nAnswer: ")
  if (i >= 0) return answer.slice(i + "\n\nAnswer: ".length)
  if (answer.startsWith("Applied.") || answer.startsWith("(Your drawing"))
    return "Applied the change."
  if (answer.startsWith("Undone")) return "Undid the change."
  return answer
}

function QuestionCard({
  number,
  question,
  change,
  disabled,
  onAnswer,
  onEnough,
  editing,
}: {
  number: number
  question: Extract<Turn, { kind: "question" }> | null
  /** A drawing change that came with this question, already applied. */
  change: {
    text: string
    status: "working" | "applied" | "undone" | "failed"
    skipped: string[]
    failed?: string
    onUndo: () => void
  } | null
  disabled: boolean
  onAnswer: (text: string) => void
  onEnough: () => void
  /** Re-answering an earlier question: the old answer, how many later ones go. */
  editing?: { previous: string; later: number; onCancel: () => void }
}) {
  // Keyed on the turn count by the parent, so a new question starts blank.
  const [other, setOther] = React.useState(editing?.previous ?? "")
  const [writing, setWriting] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const options = React.useMemo(() => question?.options ?? [], [question])

  // 1–5 answer with the keyboard; no animation on keyboard-driven actions.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled || writing || e.repeat) return
      const target = e.target as HTMLElement | null
      if (target?.closest("input, textarea, [contenteditable]")) return
      const n = Number(e.key)
      if (n >= 1 && n <= options.length && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        onAnswer(options[n - 1])
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [disabled, writing, options, onAnswer])

  React.useEffect(() => {
    if (writing) textareaRef.current?.focus()
  }, [writing])

  if (!question) return null
  return (
    <div className="enter space-y-4">
      {change && (
        <div className="rounded-xl bg-lavender px-3 py-2.5 text-xs text-foreground">
          <div className="flex items-center gap-2.5">
            <HugeiconsIcon
              icon={PencilEdit02Icon}
              strokeWidth={2}
              className="size-4 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Drawing updated</p>
              <p className="opacity-80">{change.text}</p>
            </div>
            {change.status === "working" && <Spinner className="size-3.5" />}
            {change.status === "applied" && (
              <button
                type="button"
                onClick={change.onUndo}
                disabled={disabled}
                className="pressable inline-flex shrink-0 items-center gap-1 rounded-full bg-card px-3 py-1.5 font-medium shadow-xs"
              >
                <HugeiconsIcon
                  icon={ArrowTurnBackwardIcon}
                  strokeWidth={2}
                  className="size-3"
                />
                Undo
              </button>
            )}
            {change.status === "undone" && (
              <span className="shrink-0 opacity-70">Undone</span>
            )}
            {change.status === "failed" && (
              <span className="shrink-0 text-destructive">Not saved</span>
            )}
          </div>
          {change.failed && (
            <p className="mt-1.5 text-destructive">{change.failed}</p>
          )}
          {change.skipped.length > 0 && (
            <p className="mt-1.5 text-destructive">
              Skipped: {change.skipped.join("; ")}
            </p>
          )}
        </div>
      )}

      {editing && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-peach/30 px-3 py-2.5 text-xs">
          <span>
            Changing your answer
            {editing.later > 0 &&
              ` — the ${editing.later} after it will be asked again`}
            .
          </span>
          <button
            type="button"
            onClick={editing.onCancel}
            className="pressable shrink-0 font-medium hover:underline"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="space-y-1">
        <p className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
          Question {number}
        </p>
        <p
          className="text-[15px] leading-snug font-medium"
          title={question.reason}
        >
          {question.text}
        </p>
      </div>

      <ol className="enter-stagger space-y-1.5">
        {options.map((opt, i) => (
          <li key={opt}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAnswer(opt)}
              className="option-row pressable group flex w-full items-start gap-3 rounded-xl border border-transparent bg-secondary px-3 py-2.5 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
            >
              <kbd className="option-key mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-[10px] text-muted-foreground group-hover:bg-brand group-hover:text-brand-foreground">
                {i + 1}
              </kbd>
              <span className="leading-snug">{opt}</span>
            </button>
          </li>
        ))}
      </ol>

      {writing ? (
        <form
          className="enter space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (other.trim()) onAnswer(other.trim())
          }}
        >
          <Textarea
            ref={textareaRef}
            placeholder="Say it in your own words. Enter to send, Shift+Enter for a new line."
            value={other}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && other.trim()) {
                e.preventDefault()
                onAnswer(other.trim())
              }
            }}
            disabled={disabled}
            rows={3}
          />
          <div className="flex items-center justify-between">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setWriting(false)}
                className="pressable text-xs text-muted-foreground hover:text-foreground"
              >
                Back to the options
              </button>
              <button
                type="button"
                onClick={onEnough}
                disabled={disabled}
                className="pressable text-xs text-muted-foreground hover:text-foreground"
              >
                Enough — write the prompt
              </button>
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={disabled || !other.trim()}
            >
              <HugeiconsIcon
                icon={Sent02Icon}
                strokeWidth={2}
                data-icon="inline-start"
              />
              Send
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setWriting(true)}
            disabled={disabled}
            className="pressable rounded-md px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Something else…
          </button>
          {number < ENOUGH_AFTER && (
            <button
              type="button"
              onClick={onEnough}
              disabled={disabled}
              className="pressable rounded-md px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Enough — write the prompt
            </button>
          )}
        </div>
      )}

      {number >= ENOUGH_AFTER && !editing && (
        <Button
          variant="outline"
          className="enter w-full"
          onClick={onEnough}
          disabled={disabled}
        >
          <HugeiconsIcon
            icon={SparklesIcon}
            strokeWidth={2}
            data-icon="inline-start"
          />
          That&apos;s enough — write the prompt
        </Button>
      )}
    </div>
  )
}

/** From this question on, stopping is offered as a real button. */
const ENOUGH_AFTER = 5

/** True when every element's box is already inside the visible canvas. */
function inView(
  excalidraw: ExcalidrawImperativeAPI,
  elements: readonly ExcalidrawElement[]
) {
  const { scrollX, scrollY, zoom, width, height } = excalidraw.getAppState()
  // Excalidraw measures its own UI (toolbar, docked panel) for us.
  const m = excalidraw.getViewportOffsets({ padding: 0 })
  const o = { top: 0, right: 0, bottom: 0, left: 0, ...m }
  const z = zoom.value
  return elements.every((el) => {
    const x = (el.x + scrollX) * z
    const y = (el.y + scrollY) * z
    return (
      x >= o.left &&
      y >= o.top &&
      x + el.width * z <= width - o.right &&
      y + el.height * z <= height - o.bottom
    )
  })
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
    // Selecting is how we point at things, but it also opens the shape
    // properties island. Hide that until the author touches the canvas.
    const container = document.querySelector<HTMLElement>(".excalidraw")
    const release = (e?: Event) => {
      // Only a touch on the canvas itself counts, not the panel or menus.
      if (e && !(e.target instanceof HTMLCanvasElement)) return
      container?.removeAttribute("data-highlighting")
      container?.removeEventListener("pointerdown", release)
    }
    if (ids.length > 0 && container) {
      container.setAttribute("data-highlighting", "")
      container.addEventListener("pointerdown", release)
    }
    if (elements.length > 0 && !inView(api, elements)) {
      void api.setViewport({
        target: elements,
        fit: "scale-down",
        animation: true,
        offsets: { ui: true },
      })
    }
    return () => {
      release()
      // The panel closing or the question moving on takes the selection with it.
      if (ids.length > 0) {
        void import("@excalidraw/excalidraw").then(
          ({ CaptureUpdateAction }) => {
            api.updateScene({
              appState: { selectedElementIds: {} },
              captureUpdate: CaptureUpdateAction.NEVER,
            })
          }
        )
      }
    }
    // idMap changes with every autosave; only the question should retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, excalidrawApi])
}
