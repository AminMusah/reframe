import { ConvexError, v } from "convex/values"

import { authComponent } from "./auth"
import type { Doc, Id } from "./_generated/dataModel"
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"

export const DEFAULT_NAME = "Untitled"
/** Storage is on the deployment, not the user, so projects per user are bounded. */
export const MAX_PROJECTS_PER_USER = 10

async function requireUserId(ctx: QueryCtx | MutationCtx): Promise<string> {
  const user = await authComponent.getAuthUser(ctx)
  return user._id
}

async function ownedProject(
  ctx: QueryCtx | MutationCtx,
  id: Id<"projects">
): Promise<Doc<"projects">> {
  const [userId, project] = await Promise.all([
    requireUserId(ctx),
    ctx.db.get(id),
  ])
  if (!project || project.ownerId !== userId) {
    throw new ConvexError({ code: "not_found", message: "Project not found" })
  }
  return project
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx)
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_owner_and_updatedAt", (q) => q.eq("ownerId", userId))
      .order("desc")
      .collect()
    return projects.map(({ _id, name, updatedAt, sceneHash }) => ({
      _id,
      name,
      updatedAt,
      sceneHash,
    }))
  },
})

/** Null when the drawing is gone or someone else's — a state, not an error. */
export const get = query({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const [userId, project] = await Promise.all([
      requireUserId(ctx),
      ctx.db.get(id),
    ])
    if (!project || project.ownerId !== userId) return null
    return {
      ...project,
      sceneUrl: project.sceneFileId
        ? await ctx.storage.getUrl(project.sceneFileId)
        : null,
    }
  },
})

export const create = mutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, { name }) => {
    const userId = await requireUserId(ctx)
    const owned = await ctx.db
      .query("projects")
      .withIndex("by_owner_and_updatedAt", (q) => q.eq("ownerId", userId))
      .take(MAX_PROJECTS_PER_USER)
    if (owned.length >= MAX_PROJECTS_PER_USER) {
      throw new ConvexError({
        code: "project_limit",
        message: `You can have up to ${MAX_PROJECTS_PER_USER} drawings. Delete one first.`,
      })
    }
    return ctx.db.insert("projects", {
      ownerId: userId,
      name: name?.trim() || DEFAULT_NAME,
      updatedAt: Date.now(),
    })
  },
})

/** Most recent project, created on demand — what `/` opens without `?p=`. */
export const openMostRecent = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx)
    const latest = await ctx.db
      .query("projects")
      .withIndex("by_owner_and_updatedAt", (q) => q.eq("ownerId", userId))
      .order("desc")
      .first()
    if (latest) return latest._id
    return ctx.db.insert("projects", {
      ownerId: userId,
      name: DEFAULT_NAME,
      updatedAt: Date.now(),
    })
  },
})

/**
 * Remove a project and everything hanging off it: scene and PNG files, its
 * interviews (and their PNGs), and their briefs.
 */
export const remove = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const project = await ownedProject(ctx, id)
    const interviews = await ctx.db
      .query("interviews")
      .withIndex("by_project_and_createdAt", (q) => q.eq("projectId", id))
      .collect()
    for (const interview of interviews) {
      const briefs = await ctx.db
        .query("briefs")
        .withIndex("by_interview_and_createdAt", (q) =>
          q.eq("interviewId", interview._id)
        )
        .collect()
      for (const brief of briefs) await ctx.db.delete(brief._id)
      if (interview.pngFileId) await ctx.storage.delete(interview.pngFileId)
      await ctx.db.delete(interview._id)
    }
    if (project.sceneFileId) await ctx.storage.delete(project.sceneFileId)
    if (project.pngFileId) await ctx.storage.delete(project.pngFileId)
    await ctx.db.delete(id)
  },
})

export const rename = mutation({
  args: { id: v.id("projects"), name: v.string() },
  handler: async (ctx, { id, name }) => {
    await ownedProject(ctx, id)
    await ctx.db.patch(id, { name: name.trim() || DEFAULT_NAME })
  },
})

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx)
    return ctx.storage.generateUploadUrl()
  },
})

/** Swap in a freshly uploaded scene file and drop the previous one. */
export const saveScene = mutation({
  args: {
    id: v.id("projects"),
    storageId: v.id("_storage"),
    sceneHash: v.string(),
    // A title read off the drawing; adopted only while the project is unnamed.
    suggestedName: v.optional(v.string()),
  },
  handler: async (ctx, { id, storageId, sceneHash, suggestedName }) => {
    const project = await ownedProject(ctx, id)
    const name = suggestedName?.trim()
    await ctx.db.patch(id, {
      sceneFileId: storageId,
      sceneHash,
      updatedAt: Date.now(),
      ...(name && project.name === DEFAULT_NAME ? { name } : {}),
    })
    if (project.sceneFileId && project.sceneFileId !== storageId) {
      await ctx.storage.delete(project.sceneFileId)
    }
  },
})
