import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export const questionTurn = v.object({
  role: v.literal("assistant"),
  kind: v.literal("question"),
  text: v.string(),
  options: v.array(v.string()),
  reason: v.string(),
  elementIds: v.array(v.string()),
})

export const doneTurn = v.object({
  role: v.literal("assistant"),
  kind: v.literal("done"),
  summary: v.string(),
})

const idRef = v.string()
export const editOp = v.union(
  v.object({
    op: v.literal("add"),
    ref: v.string(),
    type: v.union(
      v.literal("rectangle"),
      v.literal("ellipse"),
      v.literal("diamond"),
      v.literal("text")
    ),
    label: v.string(),
    place: v.object({
      relative: v.union(
        v.literal("right"),
        v.literal("left"),
        v.literal("above"),
        v.literal("below"),
        v.literal("inside")
      ),
      of: idRef,
    }),
  }),
  v.object({
    op: v.literal("connect"),
    from: idRef,
    to: idRef,
    label: v.union(v.string(), v.null()),
    bidirectional: v.boolean(),
  }),
  v.object({ op: v.literal("update"), id: idRef, label: v.string() }),
  v.object({ op: v.literal("delete"), id: idRef })
)

export const editTurn = v.object({
  role: v.literal("assistant"),
  kind: v.literal("edit"),
  text: v.string(),
  ops: v.array(editOp),
  // Set once the author decides; absent while the edit is pending.
  applied: v.optional(v.boolean()),
})

export const answerTurn = v.object({
  role: v.literal("user"),
  answer: v.string(),
})

export const turn = v.union(questionTurn, editTurn, doneTurn, answerTurn)

export const interviewStatus = v.union(
  v.literal("thinking"),
  v.literal("awaiting_answer"),
  v.literal("done"),
  v.literal("error")
)

export const briefTarget = v.union(
  v.literal("generic"),
  v.literal("claude-code"),
  v.literal("cursor")
)

export const briefStatus = v.union(
  v.literal("streaming"),
  v.literal("done"),
  v.literal("error")
)

export const errorCode = v.union(
  v.literal("bad_key"),
  v.literal("rate_limit"),
  v.literal("invalid_output"),
  v.literal("network")
)

export default defineSchema({
  projects: defineTable({
    // Better Auth user id (the component's user document _id).
    ownerId: v.string(),
    name: v.string(),
    // Scene JSON (Excalidraw file format) lives in file storage; docs cap at 1 MB.
    sceneFileId: v.optional(v.id("_storage")),
    // SHA-256 of the serializer output — cosmetic edits don't change it.
    sceneHash: v.optional(v.string()),
    pngFileId: v.optional(v.id("_storage")),
    updatedAt: v.number(),
  }).index("by_owner_and_updatedAt", ["ownerId", "updatedAt"]),

  // One interview is a pure function of one scene snapshot (graph + PNG + hash).
  interviews: defineTable({
    projectId: v.id("projects"),
    ownerId: v.string(),
    sceneHash: v.string(),
    graph: v.string(),
    pngFileId: v.optional(v.id("_storage")),
    model: v.string(),
    status: interviewStatus,
    lastError: v.optional(errorCode),
    turns: v.array(turn),
    // Restart-with-context: the interview this one continues from.
    priorInterviewId: v.optional(v.id("interviews")),
    createdAt: v.number(),
  })
    .index("by_project_and_createdAt", ["projectId", "createdAt"])
    .index("by_ownerId", ["ownerId"]),

  // Streamed by the brief action: `text` grows every ~250 ms until `done`.
  briefs: defineTable({
    interviewId: v.id("interviews"),
    ownerId: v.string(),
    // Absent on rows from before per-target briefs; read as "generic".
    target: v.optional(briefTarget),
    model: v.string(),
    text: v.string(),
    status: briefStatus,
    lastError: v.optional(errorCode),
    createdAt: v.number(),
  })
    .index("by_interview_and_createdAt", ["interviewId", "createdAt"])
    .index("by_ownerId", ["ownerId"]),
})
