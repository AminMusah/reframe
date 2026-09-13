import { generateText, Output } from "ai"
import { z } from "zod"

import { classifyError, LlmError } from "./errors"
import type { ModelId } from "./models"
import { languageModel, supportsVision } from "./provider"

// Pure: no Convex imports. "Sketch from reference" turns a picture on the
// canvas (a screenshot, a photo of a whiteboard) into editable shapes with
// real positions — the thing agent edits deliberately cannot do.

export const sketchSchema = z.object({
  canvas: z
    .object({ w: z.number(), h: z.number() })
    .describe(
      "Aspect of the sketch on a grid whose longer side is 100 (e.g. 100×60 for a wide diagram)."
    ),
  nodes: z
    .array(
      z.object({
        ref: z.string().min(1).describe("Unique name, e.g. n1, n2 …"),
        type: z.enum(["rectangle", "ellipse", "diamond", "text"]),
        label: z
          .string()
          .describe("The text shown; may be empty for an unlabelled shape."),
        x: z.number().describe("Left edge on the grid."),
        y: z.number().describe("Top edge on the grid."),
        w: z.number().describe("Width on the grid."),
        h: z.number().describe("Height on the grid."),
      })
    )
    .max(60),
  arrows: z
    .array(
      z.object({
        from: z.string().describe("ref of the source node"),
        to: z.string().describe("ref of the target node"),
        label: z.string().nullable(),
        bidirectional: z.boolean(),
      })
    )
    .max(80),
})

export type Sketch = z.infer<typeof sketchSchema>

export const SKETCH_PROMPT = `You convert a picture of a diagram into editable shapes.

You receive an image of a drawing canvas. It contains a reference picture (a screenshot or photo of a diagram) and possibly some existing shapes. Reproduce the diagram shown in the reference picture — not the existing shapes — as nodes and arrows:
- One node per box, ellipse, diamond, or free-standing text in the reference, with its exact label text.
- Positions and sizes on a grid whose longer side is 100, preserving the reference's layout: relative positions, alignment, and spacing. Boxes that are side by side must not overlap; keep gaps roughly as drawn.
- One arrow per connection, with its label and direction; two-headed connections are bidirectional. Text that sits on or beside a connection is that arrow's label — put it in the arrow, never as a separate text node.
- Leave generous gaps between boxes (at least half a box-height) and make each box wide enough for its label — the editable version needs breathing room.
- Do not invent elements that are not in the reference. If the picture is not a diagram, return no nodes.
The author's instruction may narrow or adjust what to reproduce; follow it.`

export type SketchInput = {
  apiKey: string
  model?: ModelId
  png: { base64: string; mediaType: string }
  instruction?: string
}

export async function sketchFromReference(input: SketchInput): Promise<Sketch> {
  if (!supportsVision(input.apiKey, input.model)) {
    throw new LlmError(
      "invalid_output",
      "This model cannot see images; pick one that can."
    )
  }
  const model = languageModel(input.apiKey, input.model)
  let output: Sketch | undefined
  try {
    const result = await generateText({
      model,
      instructions: SKETCH_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: input.png.base64,
              mediaType: input.png.mediaType,
            },
            {
              type: "text",
              text: input.instruction?.trim()
                ? `Instruction: ${input.instruction.trim()}`
                : "Reproduce the reference diagram.",
            },
          ],
        },
      ],
      output: Output.object({ schema: sketchSchema, name: "sketch" }),
      maxRetries: 2,
      maxOutputTokens: 8192,
    })
    output = result.output
  } catch (err) {
    throw classifyError(err)
  }
  if (!output) throw new LlmError("invalid_output", "Model returned no sketch")
  return normalize(output)
}

/** Drop arrows to unknown refs, dedupe refs, clamp geometry to the grid. */
export function normalize(sketch: Sketch): Sketch {
  const seen = new Set<string>()
  const nodes = sketch.nodes
    .filter((n) => {
      if (seen.has(n.ref)) return false
      seen.add(n.ref)
      return true
    })
    .map((n) => ({
      ...n,
      x: clamp(n.x, 0, 100),
      y: clamp(n.y, 0, 100),
      w: clamp(n.w, 1, 100),
      h: clamp(n.h, 1, 100),
    }))
  const arrows = sketch.arrows.filter(
    (a) => seen.has(a.from) && seen.has(a.to) && a.from !== a.to
  )
  // Models often list an arrow's label a second time as free text; keep the arrow's.
  const arrowLabels = new Set(
    arrows.map((a) => a.label?.trim().toLowerCase()).filter(Boolean)
  )
  const deduped = nodes.filter(
    (n) => !(n.type === "text" && arrowLabels.has(n.label.trim().toLowerCase()))
  )
  const w = clamp(sketch.canvas.w || 100, 10, 100)
  const h = clamp(sketch.canvas.h || 100, 10, 100)
  return { canvas: { w, h }, nodes: deduped, arrows }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo))
}
