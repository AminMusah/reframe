import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

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
})
