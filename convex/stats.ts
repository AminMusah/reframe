import { internalQuery } from "./_generated/server"

/**
 * Product numbers, for the maintainer: `npx convex run stats:summary --prod`.
 * Page views come from Vercel Web Analytics; what people do once here lives in
 * these tables, so there is no third-party event tracking.
 */
export const summary = internalQuery({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect()
    const interviews = await ctx.db.query("interviews").collect()
    const briefs = await ctx.db.query("briefs").collect()
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const questions = (i: (typeof interviews)[number]) =>
      i.turns.filter((t) => t.role === "assistant" && t.kind === "question")
        .length
    const done = interviews.filter((i) => i.status === "done")
    const byModel: Record<string, number> = {}
    for (const i of interviews) byModel[i.model] = (byModel[i.model] ?? 0) + 1
    const byLanguage: Record<string, number> = {}
    for (const i of interviews) {
      const l = i.language ?? "unknown"
      byLanguage[l] = (byLanguage[l] ?? 0) + 1
    }
    return {
      owners: new Set(projects.map((p) => p.ownerId)).size,
      drawings: projects.length,
      drawingsWithScene: projects.filter((p) => p.sceneFileId).length,
      interviews: {
        total: interviews.length,
        lastSevenDays: interviews.filter((i) => i.createdAt > weekAgo).length,
        byStatus: {
          done: done.length,
          awaiting: interviews.filter((i) => i.status === "awaiting_answer")
            .length,
          thinking: interviews.filter((i) => i.status === "thinking").length,
          error: interviews.filter((i) => i.status === "error").length,
        },
        avgQuestionsWhenDone: done.length
          ? Math.round(
              (done.reduce((n, i) => n + questions(i), 0) / done.length) * 10
            ) / 10
          : null,
        withEdits: interviews.filter((i) =>
          i.turns.some(
            (t) =>
              t.role === "assistant" &&
              (t.kind === "edit" ||
                t.kind === "sketch" ||
                (t.kind === "question" && (t.ops?.length ?? 0) > 0))
          )
        ).length,
        byModel,
        byLanguage,
      },
      prompts: {
        total: briefs.length,
        done: briefs.filter((b) => b.status === "done").length,
        error: briefs.filter((b) => b.status === "error").length,
      },
    }
  },
})
