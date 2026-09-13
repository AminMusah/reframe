"use node"

import { ConvexError, v } from "convex/values"

import { LlmError, type ErrorCode } from "../lib/llm/errors"
import { isModelId } from "../lib/llm/models"
import { sketchFromReference, type Sketch } from "../lib/llm/sketch"
import { action } from "./_generated/server"
import { loadPng } from "./helpers"

/**
 * Sketch from reference: the client uploads a PNG of the canvas (which
 * contains the reference picture) and gets back nodes + arrows on a grid.
 * Nothing is stored; the PNG is deleted once read. The key is per-call only.
 */
export const fromReference = action({
  args: {
    pngFileId: v.id("_storage"),
    apiKey: v.string(),
    model: v.string(),
    instruction: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { pngFileId, apiKey, model, instruction }
  ): Promise<{ sketch: Sketch } | { error: ErrorCode; message: string }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new ConvexError({
        code: "unauthenticated",
        message: "Sign in first",
      })
    }
    const png = await loadPng(ctx, pngFileId)
    await ctx.storage.delete(pngFileId).catch(() => {})
    if (!png) {
      throw new ConvexError({ code: "not_found", message: "PNG not found" })
    }
    try {
      const sketch = await sketchFromReference({
        apiKey,
        model: isModelId(model) ? model : undefined,
        png,
        instruction,
      })
      return { sketch }
    } catch (err) {
      const code = err instanceof LlmError ? err.code : "network"
      return {
        error: code,
        message: err instanceof Error ? err.message : String(err),
      }
    }
  },
})
