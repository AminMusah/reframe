import { streamText, type ModelMessage } from "ai"

import { classifyError } from "./errors"
import type { HistoryEntry } from "./interview"
import type { ModelId } from "./models"
import { languageModel, supportsVision } from "./provider"

// Pure: no Convex imports. The action streams this into the briefs doc; the
// eval runner calls it directly.

export const BRIEF_PROMPT = `You write implementation prompts for coding agents (Claude Code, Codex, Cursor and the like) from a diagram and an interview with its author. The author will paste your output into the agent as-is.

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
- Constraints: stack, styling, auth, data, hosting — only what was stated or is clearly implied. Always end this section with these standing instructions to the agent: follow the repository's existing agent instructions file if there is one (CLAUDE.md, AGENTS.md or .cursor/rules), run the project's existing tests and linters before finishing, and work in small verifiable steps.
- Open questions: everything the interview did not resolve. Tell the agent to ask the user about these before starting work that depends on them — and, if it cannot ask, to state its assumption at the top of its reply and continue.
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
  const model = languageModel(input.apiKey, input.model)
  const png = supportsVision(input.apiKey, input.model) ? input.png : null

  const transcript = input.transcript
    .map((entry) => {
      if (entry.role === "user") return `Author: ${entry.answer}`
      if (entry.turn.kind === "question") {
        const change = entry.turn.change
          ? `\n  (changed the drawing: ${entry.turn.change})`
          : ""
        return `Interviewer: ${entry.turn.text}\n  (options offered: ${entry.turn.options.join(" | ")})${change}`
      }
      if (entry.turn.kind === "edit" || entry.turn.kind === "sketch") {
        return `Interviewer (edited the drawing): ${entry.turn.text}`
      }
      return `Interviewer (summary): ${entry.turn.summary}`
    })
    .join("\n\n")

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
      maxOutputTokens: 8192,
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
