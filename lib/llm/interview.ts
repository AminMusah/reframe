import { createAnthropic } from "@ai-sdk/anthropic"
import { generateText, Output, type ModelMessage } from "ai"
import { z } from "zod"

import { classifyError, LlmError } from "./errors"
import { DEFAULT_MODEL, type ModelId } from "./models"

// Pure: no Convex imports. The action and the eval runner both call this.

export const questionSchema = z.object({
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

export const turnSchema = z.discriminatedUnion("kind", [
  questionSchema,
  doneSchema,
])

export type Question = z.infer<typeof questionSchema>
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

Return kind "done" when a competent engineer could build this without guessing the important things — usually after 4 to 8 questions — or whenever the author says they have had enough or asks for the prompt. The summary is two or three sentences on what this is and what you learned.`

export type InterviewInput = {
  apiKey: string
  model?: ModelId
  graph: string
  /** PNG of the drawing; omitted in text-only evals. */
  png?: { base64: string; mediaType: string } | null
  history: HistoryEntry[]
  /** Ids that exist in the graph; anything else the model cites is dropped. */
  validIds: Iterable<string>
}

export async function interviewTurn(
  input: InterviewInput
): Promise<InterviewTurn> {
  const anthropic = createAnthropic({ apiKey: input.apiKey })
  const model = anthropic(input.model ?? DEFAULT_MODEL)

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        ...(input.png
          ? [
              {
                type: "image" as const,
                image: input.png.base64,
                mediaType: input.png.mediaType,
              },
            ]
          : []),
        {
          type: "text",
          text: `Here is the drawing as a graph:\n\n${input.graph}\n\nStart the interview.`,
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
      output: Output.object({ schema: turnSchema, name: "interview_turn" }),
      maxRetries: 1,
    })
    output = result.output
  } catch (err) {
    throw classifyError(err)
  }
  if (!output) throw new LlmError("invalid_output", "Model returned no turn")

  if (output.kind === "question") {
    const valid = new Set(input.validIds)
    output = {
      ...output,
      elementIds: output.elementIds.filter((id) => valid.has(id)),
    }
  }
  return output
}
