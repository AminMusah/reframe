/**
 * Interview evals: run the interviewer against every fixture that has an
 * `.eval.json`, let a cheap model play the author from a hidden intent note,
 * then have a stronger model grade the transcript against the rubric.
 *
 *   pnpm eval                 # all fixtures
 *   pnpm eval three-tier      # one fixture
 *   pnpm eval --brief         # also generate and print the brief
 *   pnpm eval --reps 3        # repeat each fixture; summary reports mean ± spread
 *   pnpm eval --quiet         # only the per-run line and the summary
 *   pnpm eval --openai        # prefer that provider's key (also --google, --openrouter, --anthropic)
 *
 * Text-only: the interviewer gets the graph but no PNG (Node cannot render
 * Excalidraw). Needs ANTHROPIC_API_KEY in the env or .env.local.
 */
import { APICallError, generateText, Output, RetryError } from "ai"
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"

import { briefAppendix, generateBrief } from "../lib/llm/brief"
import {
  interviewTurn,
  type HistoryEntry,
  type Question,
} from "../lib/llm/interview"
import { providerForKey, type ModelId, type Provider } from "../lib/llm/models"
import { languageModel } from "../lib/llm/provider"
import { serializeScene } from "../lib/serializer"

const ROOT = path.resolve(import.meta.dirname, "..")
const FIXTURES = path.join(ROOT, "fixtures")
const OUT = path.join(ROOT, ".eval")

/** Cheap author + stronger judge, per provider of the key in use. */
const HELPERS: Record<Provider, { author: ModelId; judge: ModelId }> = {
  anthropic: { author: "claude-haiku-4-5", judge: "claude-sonnet-5" },
  openai: { author: "gpt-5.6-luna", judge: "gpt-5.6-terra" },
  google: { author: "gemini-3.5-flash-lite", judge: "gemini-3.8-flash" },
  openrouter: {
    author: "anthropic/claude-haiku-4.5",
    judge: "anthropic/claude-sonnet-5",
  },
}
/** Safety rail for the runner only; the product has no cap. */
const MAX_TURNS = 12

type Rubric = { mustAsk: string[]; mustNotAsk: string[]; maxTurns: number }
type EvalSpec = { intent: string; rubric: Rubric }

type RunResult = {
  name: string
  rep: number
  questions: number
  mustAskHit: number
  mustAskTotal: number
  somethingElseRate: number
  endedByUser: boolean
  edits: number
  failed: string | null
  finished: boolean
  withinTurns: boolean
  mustAsk: string
  violations: number
  grounded: number
  options: number
  notes: string
  grade: z.infer<typeof gradeSchema>
  transcript: HistoryEntry[]
}

const answerSchema = z.object({
  choice: z
    .number()
    .int()
    .nullable()
    .describe(
      "0-based index of the option to pick, or null to write something else."
    ),
  text: z
    .string()
    .nullable()
    .describe("Free-text answer when no option fits; null otherwise."),
  enough: z
    .boolean()
    .describe("True when the author would say 'enough, just write the brief'."),
})

const gradeSchema = z.object({
  mustAsk: z.array(
    z.object({
      topic: z.string(),
      satisfied: z.boolean(),
      evidence: z
        .string()
        .describe(
          "Quote or paraphrase of the question that covers it, or why none does."
        ),
    })
  ),
  mustNotAsk: z.array(
    z.object({ topic: z.string(), violated: z.boolean(), evidence: z.string() })
  ),
  groundedInDrawing: z
    .number()
    .int()
    .min(0)
    .max(10)
    .describe(
      "Integer 0-10: how well questions and reasons refer to concrete elements of the drawing."
    ),
  optionQuality: z
    .number()
    .int()
    .min(0)
    .max(10)
    .describe(
      "Integer 0-10: are options concrete, distinct, and likely to contain the author's answer?"
    ),
  notes: z.string(),
})

/**
 * Free tiers rate-limit by the minute; wait out a 429 (honouring the
 * provider's retry hint when it gives one) rather than failing the run.
 */
async function withBackoff<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      // The SDK retries a few times itself, then throws a RetryError around the last failure.
      const cause = RetryError.isInstance(err) ? err.lastError : err
      const status = APICallError.isInstance(cause)
        ? cause.statusCode
        : undefined
      const body = APICallError.isInstance(cause)
        ? String(cause.responseBody ?? "")
        : String((cause as Error)?.message ?? "")
      const quota = status === 429 || /quota|rate limit/i.test(body)
      if (!quota || attempt > 4) throw err
      const hinted = /retryDelay"?:s*"?(d+)s/.exec(body)?.[1]
      const wait = hinted ? Number(hinted) * 1000 + 1000 : 15_000 * attempt
      console.error(
        `  rate limited (${label}); waiting ${Math.round(wait / 1000)}s`
      )
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const wantBrief = args.includes("--brief")
  const quiet = args.includes("--quiet")
  const repsArg = args.indexOf("--reps")
  const reps = repsArg >= 0 ? Number(args[repsArg + 1]) || 1 : 1
  const only = args.filter(
    (a, i) => !a.startsWith("--") && args[i - 1] !== "--reps"
  )
  const say = (...m: unknown[]) => {
    if (!quiet) console.log(...m)
  }
  const apiKey = loadKey()
  const helpers = HELPERS[providerForKey(apiKey)]
  const models = {
    author: languageModel(apiKey, helpers.author),
    judge: languageModel(apiKey, helpers.judge),
  }

  const names = fs
    .readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".eval.json"))
    .map((f) => f.replace(/\.eval\.json$/, ""))
    .filter((n) => only.length === 0 || only.includes(n))

  fs.mkdirSync(OUT, { recursive: true })
  const results: RunResult[] = []
  // Written after every run so a killed process still leaves usable data.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const file = path.join(OUT, `${stamp}.json`)
  const persist = () => fs.writeFileSync(file, JSON.stringify(results, null, 2))
  for (const [rep, name] of names.flatMap((n) =>
    Array.from({ length: reps }, (_, i) => [i + 1, n] as const)
  )) {
    say(`\n=== ${name}${reps > 1 ? ` (rep ${rep}/${reps})` : ""}`)
    const spec: EvalSpec = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, `${name}.eval.json`), "utf8")
    )
    const scene = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, `${name}.excalidraw`), "utf8")
    )
    const { text: graph, idMap } = serializeScene(scene.elements)
    const validIds = Object.keys(idMap)

    const history: HistoryEntry[] = []
    let somethingElse = 0
    let answers = 0
    let questions = 0
    let summary: string | null = null
    let endedByUser = false

    let failed: string | null = null
    let edits = 0
    while (questions < MAX_TURNS) {
      let turn
      try {
        turn = await withBackoff("interviewer", () =>
          interviewTurn({ apiKey, graph, history, validIds })
        )
      } catch {
        // One retry, then record the failure instead of aborting the whole run.
        try {
          turn = await withBackoff("interviewer", () =>
            interviewTurn({ apiKey, graph, history, validIds })
          )
        } catch (err2) {
          failed = err2 instanceof Error ? err2.message : String(err2)
          say(`  FAILED: ${failed}`)
          break
        }
      }
      history.push({ role: "assistant", turn })
      if (turn.kind === "done") {
        summary = turn.summary
        say(`  done: ${turn.summary}`)
        break
      }
      if (turn.kind === "edit") {
        // Text-only run: nothing can apply the edit, so the author undoes it.
        // Accepting would leave the model expecting ids that never appear.
        edits++
        say(`  EDIT (undone): ${turn.text} (${turn.ops.length} ops)`)
        history.push({
          role: "user",
          answer:
            "Undone — keep the drawing as it was; just note it for the brief.",
        })
        continue
      }
      questions++
      say(`  Q${questions}: ${turn.text}`)
      say(`      cites ${JSON.stringify(turn.elementIds)} — ${turn.reason}`)

      const reply = await withBackoff("author", () =>
        simulateAuthor(models.author, spec.intent, turn)
      )
      let answer: string
      if (reply.enough) {
        answer = "That's enough — please write the brief now."
        endedByUser = true
      } else if (reply.choice !== null && turn.options[reply.choice]) {
        answer = turn.options[reply.choice]
      } else {
        answer = reply.text ?? "I'm not sure."
        somethingElse++
      }
      answers++
      history.push({ role: "user", answer })
      say(
        `      A: ${answer}${reply.choice === null && !reply.enough ? "  [something else]" : ""}`
      )
    }

    let grade
    try {
      grade = await withBackoff("judge", () =>
        judge(models.judge, spec.rubric, graph, history)
      )
    } catch (err) {
      console.error(
        `judge failed for ${name}: ${err instanceof Error ? err.message.split(String.fromCharCode(10))[0] : err}`
      )
      process.exit(1)
    }
    const mustAskHit = grade.mustAsk.filter((m) => m.satisfied).length
    const violations = grade.mustNotAsk.filter((m) => m.violated).length
    const withinTurns = questions <= spec.rubric.maxTurns
    const result: RunResult = {
      name,
      rep,
      questions,
      mustAskHit,
      mustAskTotal: grade.mustAsk.length,
      somethingElseRate: answers ? somethingElse / answers : 0,
      endedByUser,
      edits,
      failed,
      finished: summary !== null,
      withinTurns,
      mustAsk: `${mustAskHit}/${grade.mustAsk.length}`,
      violations,
      grounded: grade.groundedInDrawing,
      options: grade.optionQuality,
      notes: grade.notes,
      grade,
      transcript: history,
    }
    results.push(result)
    persist()

    console.log(
      `  → ${result.mustAsk} must-ask, ${violations} violations, grounded ${grade.groundedInDrawing}/10, options ${grade.optionQuality}/10, ` +
        `${questions} turns${withinTurns ? "" : " (OVER LIMIT)"}, something-else ${(result.somethingElseRate * 100).toFixed(0)}%`
    )
    for (const m of grade.mustAsk) {
      if (!m.satisfied) say(`     missed: ${m.topic} — ${m.evidence}`)
    }
    for (const m of grade.mustNotAsk) {
      if (m.violated) say(`     violated: ${m.topic} — ${m.evidence}`)
    }

    if (wantBrief) {
      const body = await generateBrief({ apiKey, graph, transcript: history })
      const brief = body + briefAppendix(graph)
      fs.writeFileSync(path.join(OUT, `${name}.brief.md`), brief)
      console.log(`  brief → .eval/${name}.brief.md (${brief.length} chars)`)
    }
  }

  persist()

  if (reps > 1) {
    console.log(`\n=== aggregate over ${reps} reps (sum per rep, mean ± sd)`)
    const repIds = [...new Set(results.map((r) => r.rep))]
    const stat = (f: (r: RunResult) => number) => {
      const per = repIds.map((k) =>
        results.filter((r) => r.rep === k).reduce((a, r) => a + f(r), 0)
      )
      const mean = per.reduce((a, b) => a + b, 0) / per.length
      const sd = Math.sqrt(
        per.reduce((a, b) => a + (b - mean) ** 2, 0) /
          Math.max(1, per.length - 1)
      )
      return `${mean.toFixed(1)} ± ${sd.toFixed(1)}  (${per.map((v) => +v.toFixed(2)).join(", ")})`
    }
    const total = names.length * (results[0]?.mustAskTotal ?? 0)
    console.log(`must-ask hits (of ${total}): ${stat((r) => r.mustAskHit)}`)
    console.log(`violations:            ${stat((r) => r.violations)}`)
    console.log(`total turns:           ${stat((r) => r.questions)}`)
    console.log(
      `fixtures over limit:   ${stat((r) => (r.withinTurns ? 0 : 1))}`
    )
    console.log(`unfinished:            ${stat((r) => (r.finished ? 0 : 1))}`)
    console.log(`edits proposed:        ${stat((r) => r.edits)}`)
    console.log(`failed runs:           ${stat((r) => (r.failed ? 1 : 0))}`)
    console.log(`something-else (sum):  ${stat((r) => r.somethingElseRate)}`)
    for (const n of names) {
      console.log(
        `  ${n.padEnd(14)} ${results
          .filter((r) => r.name === n)
          .map((r) => `${r.mustAskHit}/${r.mustAskTotal} ${r.questions}t`)
          .join(" | ")}`
      )
    }
  }

  console.log("\n=== summary")
  console.table(
    results.map(
      ({
        name,
        rep,
        questions,
        mustAsk,
        violations,
        grounded,
        options,
        somethingElseRate,
        finished,
      }) => ({
        fixture: reps > 1 ? `${name} #${rep}` : name,
        turns: questions,
        mustAsk,
        violations,
        grounded,
        options,
        "something else": `${(somethingElseRate * 100).toFixed(0)}%`,
        finished,
      })
    )
  )
  console.log(`saved ${path.relative(ROOT, file)}`)
}

/** The author, played by a cheap model from the hidden intent note. */
async function simulateAuthor(
  model: ReturnType<typeof languageModel>,
  intent: string,
  question: Question
) {
  const { output } = await generateText({
    model,
    maxOutputTokens: 2048,
    instructions: `You are the author of a diagram, answering an interviewer's questions about it. Your real intent is described below; answer only from it. Pick an option when one matches your intent; otherwise write a short free-text answer (one or two sentences) as "text". If the interviewer has clearly covered everything in your intent already, or asks something irrelevant twice, set enough=true. Never reveal that you have an intent note.

Your intent:
${intent}`,
    prompt: `Question: ${question.text}\nOptions:\n${question.options.map((o, i) => `${i}. ${o}`).join("\n")}`,
    output: Output.object({ schema: answerSchema }),
  })
  if (!output) return { choice: null, text: "I'm not sure.", enough: false }
  return output
}

/** The grader: rubric + transcript in, structured findings out. */
async function judge(
  model: ReturnType<typeof languageModel>,
  rubric: Rubric,
  graph: string,
  history: HistoryEntry[]
) {
  const transcript = history
    .map((h) =>
      h.role === "user"
        ? `AUTHOR: ${h.answer}`
        : h.turn.kind === "question"
          ? `INTERVIEWER: ${h.turn.text}\n  options: ${h.turn.options.join(" | ")}\n  cites: ${h.turn.elementIds.join(", ")} — ${h.turn.reason}`
          : h.turn.kind === "edit"
            ? `INTERVIEWER (edit): ${h.turn.text}`
            : `INTERVIEWER (done): ${h.turn.summary}`
    )
    .join("\n\n")
  const { output } = await generateText({
    model,
    maxOutputTokens: 2048,
    instructions:
      "You grade an interviewer that asks a diagram's author questions so a coding agent can build what was drawn. Be strict and cite evidence from the transcript. A must-ask topic counts as satisfied only if a question clearly addresses it (not merely an option in passing).",
    prompt: `The drawing as a graph:\n${graph}\n\nRubric:\nmust ask about: ${rubric.mustAsk.map((t) => `- ${t}`).join("\n")}\nmust NOT ask about: ${rubric.mustNotAsk.map((t) => `- ${t}`).join("\n")}\n\nTranscript:\n${transcript}`,
    output: Output.object({ schema: gradeSchema }),
  })
  if (!output) throw new Error("judge returned nothing")
  return output
}

/** ANTHROPIC_API_KEY or OPENAI_API_KEY from the env or .env.local; `--openai` prefers the latter. */
function loadKey(): string {
  const ENV: Record<Provider, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  }
  const order = (Object.keys(ENV) as Provider[]).sort((x, y) => {
    const px = process.argv.includes(`--${x}`) ? 0 : 1
    const py = process.argv.includes(`--${y}`) ? 0 : 1
    return px - py
  })
  let env = ""
  try {
    env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8")
  } catch {
    // no .env.local
  }
  for (const provider of order) {
    const name = ENV[provider]
    const fromEnv = process.env[name]
    if (fromEnv) return fromEnv
    const m = env.match(new RegExp("^" + name + "=(.+)$", "m"))
    if (m) return m[1].trim()
  }
  console.error(
    `No API key found (env or .env.local): ${Object.values(ENV).join(", ")}`
  )
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
