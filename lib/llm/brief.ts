import { createAnthropic } from "@ai-sdk/anthropic"
import { streamText, type ModelMessage } from "ai"

import { classifyError } from "./errors"
import type { HistoryEntry } from "./interview"
import { DEFAULT_MODEL, type ModelId } from "./models"

// Pure: no Convex imports. The action streams this into the briefs doc; the
// eval runner calls it directly.

export const BRIEF_PROMPT = `You write implementation briefs for coding agents (Claude Code, Cursor) from a diagram and an interview with its author.

Write in Markdown with exactly these top-level sections, in this order, each as a level-1 heading:

# Goal
# Scope
# Structure
# Behavior
# Constraints
# Open questions

Rules:
- Goal: two or three sentences on what is being built and for whom.
- Scope: two lists, "In" and "Explicitly out". Only include what the drawing or the interview supports.
- Structure: one subsection (level 2) per screen, service, or node in the drawing, using the author's labels. Say what it contains and how it connects to the others, in the author's terms.
- Behavior: interactions, transitions, data flow, and edge cases, as concrete statements an engineer can implement.
- Constraints: stack, styling, auth, data, hosting — only what was stated or is clearly implied.
- Open questions: everything the interview did not resolve. Tell the agent to ask the user about these before guessing.
- Never invent requirements. When the author's answer contradicts the drawing, the answer wins; say so briefly.
- Be specific and terse. No preamble, no closing remarks, and do not add an appendix — one is attached automatically.`

export type BriefInput = {
  apiKey: string
  model?: ModelId
  graph: string
  png?: { base64: string; mediaType: string } | null
  /** The full interview, questions and answers, in order. */
  transcript: HistoryEntry[]
  /** Called with the complete text so far, whenever it grows. */
  onProgress?: (text: string) => void | Promise<void>
}

/** Stream the brief body (without the appendix). Resolves to the full text. */
export async function generateBrief(input: BriefInput): Promise<string> {
  const anthropic = createAnthropic({ apiKey: input.apiKey })
  const model = anthropic(input.model ?? DEFAULT_MODEL)

  const transcript = input.transcript
    .map((entry) => {
      if (entry.role === "user") return `Author: ${entry.answer}`
      if (entry.turn.kind === "question") {
        return `Interviewer: ${entry.turn.text}\n  (options offered: ${entry.turn.options.join(" | ")})`
      }
      return `Interviewer (summary): ${entry.turn.summary}`
    })
    .join("\n\n")

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
          text: `The drawing as a graph:\n\n${input.graph}\n\nThe interview:\n\n${transcript || "(the author ended the interview before answering anything)"}\n\nWrite the brief.`,
        },
      ],
    },
  ]

  try {
    const result = streamText({
      model,
      instructions: BRIEF_PROMPT,
      messages,
      maxRetries: 1,
    })
    let text = ""
    for await (const chunk of result.textStream) {
      text += chunk
      await input.onProgress?.(text)
    }
    return text.trim()
  } catch (err) {
    throw classifyError(err)
  }
}

/** The deterministic tail every brief gets: the graph the agent can cite. */
export function briefAppendix(graph: string): string {
  return `\n\n# Appendix: source diagram\n\n\`\`\`\n${graph}\n\`\`\`\n`
}
