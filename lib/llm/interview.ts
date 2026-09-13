import { generateText, Output, type ModelMessage } from "ai"
import { z } from "zod"

import { classifyError, LlmError } from "./errors"
import type { ModelId } from "./models"
import { languageModel, supportsVision } from "./provider"

// Pure: no Convex imports. The action and the eval runner both call this.

export const questionSchemaBase = z.object({
  kind: z.literal("question"),
  text: z
    .string()
    .min(1)
    .describe("The question, one sentence, addressed to the author."),
  options: z
    .array(z.string().min(1))
    .min(2)
    .max(5)
    .describe(
      "Concrete answers the author can pick with one click. Do not add a 'something else' option; the client provides it."
    ),
  reason: z
    .string()
    .min(1)
    .describe(
      "One sentence on what in the drawing prompted this question, citing element ids."
    ),
  elementIds: z
    .array(z.string())
    .describe(
      "Ids from the graph this question is about; the client highlights them."
    ),
})

export const doneSchema = z.object({
  kind: z.literal("done"),
  summary: z
    .string()
    .min(1)
    .describe(
      "Two or three sentences on what the drawing is and what was learned."
    ),
})

// Agent edits: a handful of constrained ops, never raw element JSON.
const idRef = z
  .string()
  .describe(
    "A graph id (r1, d2, f1 …) or the ref of an element added in this edit."
  )

// Plain unions (anyOf): OpenAI structured outputs reject the oneOf that
// discriminatedUnion compiles to. TypeScript still narrows on the literal.
export const editOpSchema = z.union([
  z.object({
    op: z.literal("add"),
    ref: z
      .string()
      .min(1)
      .describe(
        "A temporary name (new1, new2 …) other ops in this edit can refer to."
      ),
    type: z.enum(["rectangle", "ellipse", "diamond", "text"]),
    label: z.string().min(1),
    place: z.object({
      relative: z.enum(["right", "left", "above", "below", "inside"]),
      of: idRef,
    }),
  }),
  z.object({
    op: z.literal("connect"),
    from: idRef,
    to: idRef,
    label: z.string().nullable(),
    bidirectional: z.boolean(),
  }),
  z.object({ op: z.literal("update"), id: idRef, label: z.string().min(1) }),
  z.object({ op: z.literal("delete"), id: idRef }),
])

/** A question may carry a drawing change the answer before it called for. */
export const questionSchema = questionSchemaBase.extend({
  ops: z
    .array(editOpSchema)
    .max(6)
    .describe(
      "Changes to the drawing that the author's last answer calls for; empty when none."
    ),
  change: z
    .string()
    .nullable()
    .describe(
      "One short sentence describing the change, or null when ops is empty."
    ),
})

export const editSchema = z.object({
  kind: z.literal("edit"),
  text: z
    .string()
    .min(1)
    .describe(
      "One sentence for the author: what you are changing in the drawing and why."
    ),
  ops: z.array(editOpSchema).min(1).max(6),
})

// The drawing contains a picture of a diagram: redraw it as editable shapes
// (the client runs Sketch-from-reference and asks the author to accept).
export const sketchTurnSchema = z.object({
  kind: z.literal("sketch"),
  text: z
    .string()
    .min(1)
    .describe("One sentence for the author: what you are redrawing and why."),
  instruction: z
    .string()
    .describe(
      "What the redraw should reproduce from the picture, or leave out — passed to the sketching model."
    ),
  mode: z
    .enum(["add", "replace"])
    .describe(
      "replace: the existing shapes are earlier attempts at the same diagram and should go; add: keep them and draw below."
    ),
})

export const turnSchema = z.union([
  questionSchema,
  editSchema,
  sketchTurnSchema,
  doneSchema,
])

/**
 * What the model is asked to produce: one flat object, since providers differ
 * in what they accept: OpenAI strict mode wants an object with every key
 * required (nullable is fine) and no oneOf at the top level. It is validated
 * into `turnSchema` afterwards.
 */
export const flatTurnSchema = z.object({
  kind: z
    .enum(["question", "edit", "sketch", "done"])
    .describe(
      "question: ask the author; edit: change the drawing; sketch: redraw a picture on the canvas as editable shapes; done: finish."
    ),
  text: z
    .string()
    .nullable()
    .describe(
      "question: the question. edit/sketch: what you are changing and why. done: null."
    ),
  options: z
    .array(z.string())
    .nullable()
    .describe(
      'question only: 2 to 5 concrete answers, no "something else". Otherwise null.'
    ),
  reason: z
    .string()
    .nullable()
    .describe(
      "question only: what in the drawing prompted it, citing ids. Otherwise null."
    ),
  elementIds: z
    .array(z.string())
    .nullable()
    .describe("question only: ids this question is about. Otherwise null."),
  ops: z
    .array(editOpSchema)
    .nullable()
    .describe(
      "edit: 1 to 6 ops. question: ops the last answer calls for, or null. Otherwise null."
    ),
  change: z
    .string()
    .nullable()
    .describe(
      "question with ops only: one short sentence describing the change. Otherwise null."
    ),
  instruction: z
    .string()
    .nullable()
    .describe(
      "sketch only: what to reproduce from the picture or leave out. Otherwise null."
    ),
  mode: z
    .enum(["add", "replace"])
    .nullable()
    .describe(
      "sketch only: replace earlier attempts at the same diagram, or add below. Otherwise null."
    ),
  summary: z
    .string()
    .nullable()
    .describe(
      "done only: two or three sentences on what this is and what you learned. Otherwise null."
    ),
})

export function fromFlatTurn(
  flat: z.infer<typeof flatTurnSchema>
): InterviewTurn | null {
  const candidate =
    flat.kind === "question"
      ? {
          kind: "question",
          text: flat.text ?? "",
          options: flat.options ?? [],
          reason: flat.reason ?? "",
          elementIds: flat.elementIds ?? [],
          ops: flat.ops ?? [],
          change: flat.ops?.length ? (flat.change ?? flat.text ?? "") : null,
        }
      : flat.kind === "edit"
        ? { kind: "edit", text: flat.text ?? "", ops: flat.ops ?? [] }
        : flat.kind === "sketch"
          ? {
              kind: "sketch",
              text: flat.text ?? "",
              instruction: flat.instruction ?? "",
              mode: flat.mode ?? "add",
            }
          : { kind: "done", summary: flat.summary ?? flat.text ?? "" }
  const parsed = turnSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

export type Question = z.infer<typeof questionSchema>
export type Edit = z.infer<typeof editSchema>
export type SketchTurn = z.infer<typeof sketchTurnSchema>
export type EditOp = z.infer<typeof editOpSchema>
export type Done = z.infer<typeof doneSchema>
export type InterviewTurn = z.infer<typeof turnSchema>

export type HistoryEntry =
  { role: "assistant"; turn: InterviewTurn } | { role: "user"; answer: string }

export { LlmError as InterviewError, type ErrorCode } from "./errors"

export const SYSTEM_PROMPT = `You are interviewing the author of a diagram so that a coding agent (Claude Code, Cursor) can build what they drew without guessing.

You receive the drawing as an image and as a text graph. The graph names every element with a short id (r1, d2, a3, t4, f1 …) and gives positions on a 0–100 grid. Refer to elements by those ids.

Cover, over the course of the interview, in roughly this order:
1. Framing — what this is and who it is for, unless the drawing makes it obvious. Usually the first question.
2. The elements — what the ambiguous arrows, containers, scribbles, notes, and dangling ends mean.
3. Scope — what is explicitly out, and for anything optional-looking (a secondary button, a "nice to have"), whether it is required now.
4. Constraints — stack, auth, data, hosting, only where the drawing or the answers make them relevant.

Ask one question per turn. Each question:
- targets the most consequential thing that is still ambiguous: what this is for, what is in and out of scope, what happens on interaction or data flow, what the arrows and containers mean, what the scribbles and notes are about, and hard constraints (stack, auth, data);
- offers 2–5 concrete, mutually distinct options the author can pick with one click; a free-text "something else" is added automatically, do not include it;
- cites the element ids it is about in elementIds and explains in reason what in the drawing prompted it. In the question text itself, refer to elements by their label or a short description ("the HTTPS arrow", "the dashed box"), never by id — the client highlights the cited elements.

Do not ask about things the drawing already makes clear, and do not ask about visual styling unless the drawing implies it matters. Prefer questions whose answer changes what gets built. Treat free-text answers as authoritative, even when they contradict the drawing; if an answer implies the drawing should change, note it and keep going. If the author asks you for suggestions, offer them as the options of one question and then move on — do not keep consulting on the same point.

The drawing is the living spec: keep it in step with what the author tells you. Whenever an answer changes what the drawing states — a label, a connection, a component that should exist or should not, where a flow goes — attach the change to your next question as "ops" with a one-line "change" note, and ask the question. The client applies the change immediately (the author can undo it) and your next reply will carry the updated graph with new ids. Examples: the drawing says Firebase does auth and storage and the author says storage only → relabel those arrows; the author names a component the drawing lacks → add it and connect it; the author says media goes through the backend → delete the direct arrows and connect via the backend. Do not change the drawing for answers that only add detail the drawing never claimed, and never for tidying, styling, or annotations. Ops are coarse — add, connect, rename, delete, relative placement — and cannot control spacing or match a picture. When a change replaces something, delete what it replaces in the same ops. When the author explicitly asks for a change and you have no question to pair it with, return kind "edit" (text + ops) on its own; it is applied the same way.

When the drawing contains a picture of a diagram (a screenshot, a photo of a whiteboard), the author usually wants it as editable shapes — but ask first, do not assume. If the canvas is essentially just that picture, make your first question about it, with options such as "Redraw it as editable shapes so we can work on it", "Interview me from the picture as it is", and a third if sensible. Only when the author picks the redraw (or asks for it in their own words) return kind "sketch" instead of a question: the client redraws the picture with real layout and the author accepts or undoes it. Put in "instruction" what to reproduce or leave out; use mode "replace" when the existing shapes are earlier attempts at the same diagram, "add" otherwise. Never try to reproduce a picture with edit ops. After an accepted sketch the reply carries the new graph; continue the interview about the sketched diagram.

Keep it short. Before every question, ask yourself: could a competent engineer build this now, putting anything still unknown under "Open questions" for the agent to ask about? If yes, return kind "done" instead. Most drawings need 4 to 6 questions; do not exceed 8 unless the author keeps adding new information. Specifically:
- Do not ask about stack, auth, hosting, or data storage unless the drawing or an earlier answer points at them. Unstated constraints belong in Open questions, not in the interview.
- Scope, in one question near the end: whether the obvious adjacent things exist or are wanted (sign-up next to a login, the data model behind a database, an admin side of a public site) — several such items as the options. Do not fish for product scope beyond that ("which features are in v1?"); the author drew what is in scope.
- Every ambiguous drawn element (an unlabelled arrow, a container, a dangling end, a scribble) gets its question before anything that is not drawn. Never finish while a drawn element is still unexplained.

- Do not follow up on a question the author has already answered adequately; one question per topic.
- When several small marks are similar (a few scribbles, a few notes), ask about them in one question.

Also return kind "done" whenever the author says they have had enough or asks for the prompt. The summary is two or three sentences on what this is and what you learned.

Reply with a single JSON object matching the schema you were given: every field present, null where it does not apply to the kind.`

export type InterviewInput = {
  apiKey: string
  model?: ModelId
  graph: string
  /** PNG of the drawing; omitted in text-only evals. */
  png?: { base64: string; mediaType: string } | null
  history: HistoryEntry[]
  /** A previous interview about an earlier version of this drawing (restart-with-context). */
  prior?: {
    graph: string
    history: HistoryEntry[]
    sameDrawing?: boolean
  } | null
  /** Ids that exist in the graph; anything else the model cites is dropped. */
  validIds: Iterable<string>
}

export async function interviewTurn(
  input: InterviewInput
): Promise<InterviewTurn> {
  const model = languageModel(input.apiKey, input.model)
  const png = supportsVision(input.apiKey, input.model) ? input.png : null

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        ...(png
          ? [
              {
                type: "image" as const,
                image: png.base64,
                mediaType: png.mediaType,
              },
            ]
          : []),
        {
          type: "text",
          text:
            (input.prior ? priorContext(input.prior) : "") +
            `Here is the drawing as a graph:\n\n${input.graph}\n\nStart the interview.`,
          // The image + graph never change within an interview: cache them.
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        },
      ],
    },
    ...input.history.map<ModelMessage>((entry) =>
      entry.role === "assistant"
        ? { role: "assistant", content: JSON.stringify(entry.turn) }
        : { role: "user", content: entry.answer }
    ),
  ]

  let output: InterviewTurn | undefined
  try {
    const result = await generateText({
      model,
      instructions: SYSTEM_PROMPT,
      messages,
      output: Output.object({ schema: flatTurnSchema, name: "interview_turn" }),
      maxRetries: 2,
      // A turn is a few hundred tokens; a cap keeps pay-per-request providers happy.
      maxOutputTokens: 4096,
    })
    output = result.output
      ? (fromFlatTurn(result.output) ?? undefined)
      : undefined
  } catch (err) {
    throw classifyError(err)
  }
  if (!output) throw new LlmError("invalid_output", "Model returned no turn")

  const valid = new Set(input.validIds)
  if (output.kind === "question") {
    const ops = validateOps(output.ops, valid)
    output = {
      ...output,
      elementIds: output.elementIds.filter((id) => valid.has(id)),
      ops,
      change: ops.length ? output.change : null,
    }
  }
  if (output.kind === "edit") {
    const ops = validateOps(output.ops, valid)
    if (ops.length === 0) {
      throw new LlmError(
        "invalid_output",
        "Edit referenced only unknown elements"
      )
    }
    output = { ...output, ops }
  }
  return output
}

/** Earlier answers travel with a restart so the author is not asked twice. */
function priorContext(prior: {
  graph: string
  history: HistoryEntry[]
  sameDrawing?: boolean
}): string {
  const transcript = prior.history
    .map((h) =>
      h.role === "user"
        ? `Author: ${h.answer}`
        : h.turn.kind === "question"
          ? `You asked: ${h.turn.text}`
          : h.turn.kind === "edit" || h.turn.kind === "sketch"
            ? `You edited the drawing: ${h.turn.text}`
            : `You concluded: ${h.turn.summary}`
    )
    .join("\n")
  const framing = prior.sameDrawing
    ? `The author has asked for ANOTHER interview about the SAME drawing. The earlier answers below still hold — do not repeat those questions — but the author wants to go further: ask about what the earlier interview did not cover, dig into things it settled only shallowly, and ask at least three questions before finishing. Do not return "done" as your first turn, and do not propose edits unless asked.`
    : `An earlier interview covered a previous version of this drawing. Its answers still hold unless the new drawing contradicts them — do not ask them again; focus on what changed or was never covered. Element ids in it refer to the OLD graph.`
  return `${framing}

Earlier drawing:
${prior.graph}

Earlier interview:
${transcript}

---

`
}

/** Drop ops that point at ids that exist neither in the graph nor as refs added earlier in the same edit. */
export function validateOps(ops: EditOp[], valid: Set<string>): EditOp[] {
  const known = new Set(valid)
  const kept: EditOp[] = []
  for (const op of ops) {
    switch (op.op) {
      case "add":
        if (!known.has(op.place.of)) continue
        known.add(op.ref)
        kept.push(op)
        break
      case "connect":
        if (!known.has(op.from) || !known.has(op.to) || op.from === op.to)
          continue
        kept.push(op)
        break
      case "update":
      case "delete":
        if (!known.has(op.id)) continue
        kept.push(op)
        break
    }
  }
  return kept
}
