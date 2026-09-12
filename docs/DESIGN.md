# Reframe — Design

_Agreed 2026-09-12. Reframe turns a freeform diagram into a coding-agent prompt by interviewing the author about what they drew._

## Product loop

1. User draws in Excalidraw. That is the only input — no intent field, no diagram-type picker.
2. User clicks **Reframe**. The client exports a PNG and a compacted scene graph; both go to the model.
3. The model **interviews** the user one question at a time. Each question has options plus a free-text "something else" escape hatch. The model decides when it has enough; the user can also end it at any point with a quiet **"Enough — write the brief"** link under the options (no model round-trip). There is no hard cap on turns.
4. A separate call writes a **brief** (streamed) in a fixed structure, ready to paste into Claude Code or Cursor.

Reframe is domain-agnostic: UI sketches, architecture diagrams, flows, data models — anything that describes software to be built. The output shape is the same for all; only what the interviewer asks differs.

## Stack

| Concern   | Choice                                                                                                                                                                                                                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework | Next.js 16 (App Router), React 19, Tailwind 4, shadcn — static export (`output: "export"`), no route handlers or server actions. Single page; the project id is `?p=<id>` (dynamic segments are unsupported under export).                                                                                                                          |
| Canvas    | `@excalidraw/excalidraw` (pinned `0.18.0-afa3a65`, the `next` tag; `latest` is 0.18.1)                                                                                                                                                                                                                                                              |
| Backend   | Convex — DB, file storage, `"use node"` actions (**Node 22** required by AI SDK 7; set in `convex.json`)                                                                                                                                                                                                                                            |
| Auth      | Better Auth via `@convex-dev/better-auth`, handler served from Convex HTTP actions (`convex/http.ts`), **anonymous plugin** for auto sign-in, GitHub + Google as upgrade. Follow the component's **React (Vite SPA)** guide, not the Next.js one: `registerRoutes(http, createAuth, { cors: true })`, `crossDomain` plugin both sides, client `baseURL` = Convex `.site` URL, OAuth callbacks on `*.convex.site`. |
| LLM       | Vercel AI SDK v7 (`ai`, `@ai-sdk/anthropic`). Dropdown: `claude-sonnet-5` (default), `claude-opus-5`, `claude-haiku-4-5`; hardcoded list, choice remembered in `localStorage` and pinned to `interviews.model` when Reframe is clicked; the brief uses its interview's model. Other providers later.                                                  |
| Keys      | BYOK. Key lives in `localStorage`, sent per request to the Convex action, **never persisted**.                                                                                                                                                                                                                                                      |
| Streaming | Reactive doc updates: the brief action buffers tokens and flushes `briefs.text` via mutation every ~250 ms; the client `useQuery`s the doc. (Not `persistent-text-streaming`: it streams from an `httpAction`, which runs in Convex's V8 runtime where AI SDK 7 — Node ≥ 22 — is not guaranteed to load.)                                          |
| Hosting   | Vercel (static `out/`). Convex dev deployment for `npx convex dev`, prod via `npx convex deploy` in the Vercel build. `SITE_URL` per deployment; separate GitHub/Google OAuth apps for dev and prod.                                                                                                                                                 |

### AI SDK v7 notes

- `generateObject` / `streamObject` are deprecated. Use `generateText({ output: Output.object({ schema }) })` and `streamText`.
- Interview turn schema is a Zod discriminated union: `question | edit | done`.
- Requires Node ≥ 22 and ESM.
- Every turn resends the full message history (the API is stateless); the PNG + graph live in the first user message. Prompt-cache the system prompt and that first message via `@ai-sdk/anthropic` provider options.

### Code layout

- `lib/serializer/` — pure, deterministic, Vitest-tested.
- `lib/llm/interview.ts`, `lib/llm/brief.ts` — pure functions `(model, apiKey, graph, pngBase64, history) → typed result`, **no Convex imports**. Convex actions are thin wrappers (load storage → call → write). `scripts/eval.ts` imports the same functions.
- Excalidraw: client-component wrapper importing `@excalidraw/excalidraw/index.css`, loaded with `next/dynamic` + `ssr: false` from a client component.

## Serializer (client, deterministic, unit-tested)

Input: `excalidrawAPI.getSceneElements()`. Output: a compact text graph the model can read, cite, and (later) edit against.

- **Containers:** frames are top-level containers named by their label (`frameId` is authoritative; ≥ 90 % geometric coverage is the fallback). Inside a frame (or at root), build a geometric containment tree (B is inside A if ≥ 90 % of B's box is within A's).
- **Groups:** `groupIds` are emitted as "siblings that belong together".
- **Arrows:** resolve `from → to` via `startBinding` / `endBinding`; when unbound, use nearest endpoint-to-box. Note `elbowed`.
- **Text:** bound text (`containerId`) becomes the container's label; loose text is its own node.
- **Freedraw:** summarized ("scribble near r3"), or "scribble through r3" when it crosses an element — worth a question.
- **Sticky notes:** emitted as author notes.
- **Images / embeds:** noted by type and position only.
- **IDs:** short stable tokens (`r1`/`d1`/`e1` for rectangle/diamond/ellipse, `t1`, `n1`, `i1`, `s1`, `a1`, `f1`, `g1`) mapped to Excalidraw IDs client-side. Assigned by a tree walk (frames → root, parent before children) with siblings in row-clustered reading order, so ids survive cosmetic edits. The model only ever sees the short IDs.
- **Coordinates:** normalized to a coarse 0–100 grid per frame (root otherwise), plus one relative hint per node ("below r3", else "right of r1"). Never raw pixels.

Fixtures in `fixtures/*.excalidraw` drive Vitest for the serializer and the interview evals (below). `pnpm dump-graph <file>` prints the text for a fixture.

## Interview action (Convex `"use node"`)

```
interview.step({ interviewId, apiKey, answer? })
  → { kind: "question", text, options: string[], reason, elementIds: string[] }
  | { kind: "edit", ... }            // v1.1, see below
  | { kind: "done", summary }
```

- First turn sends the PNG (from Convex storage) and the graph; later turns carry conversation history only.
- Each question cites `elementIds`; the client selects them and calls `scrollToContent(..., { fitToViewport })`. Ids the model returns are validated against the graph; unknown ones are dropped.
- `reason` is shown on hover — forces the model to ground questions in the drawing.
- No hard cap. The model is instructed to stop when the brief would be complete, and to treat free text like "just generate it" as a `done` signal. `interview.finish` (a mutation) ends it from the Enough link; the pending question stays unanswered and lands under Open questions.
- **Two-phase write.** (1) mutation appends the user's answer and sets `status: "thinking"` — rejected unless status was `awaiting_answer` (kills double-submits); (2) model call; (3) mutation appends the question and sets `awaiting_answer` or `done`. On failure: `status: "error"`, `lastError: bad_key | rate_limit | invalid_output | network`. Retry re-runs (2)–(3) without resending the answer; `bad_key` also opens the key dialog.
- The Reframe button is disabled while the serializer yields zero nodes.

## Brief generation (separate action)

Own system prompt, streamed into a `briefs` doc (see Streaming above). **Triggered by the client** as soon as it sees the `done` turn — the key is in `localStorage` and must not go through `ctx.scheduler` (scheduled-function args are persisted). If the tab closes mid-way the doc stays `partial`/`error` and a "Generate brief" button appears on reload. Fixed skeleton:

```
# Goal
# Scope            (in / explicitly out)
# Structure        (screens / services / nodes — one section each)
# Behavior         (interactions, transitions, edge cases)
# Constraints      (stack, styling, auth …)
# Open questions   (what the interview did not resolve — tell the agent to ask, not guess)
# Appendix: source diagram   (the compacted graph)
```

Copy button. "Regenerate" and per-target variants (Claude Code / Cursor) are v1.1.

## UI

- Excalidraw ≈ 65 % width, collapsible right panel ≈ 35 % (`react-resizable-panels`).
- Panel shows the transcript, the current question with option buttons + "something else" input + the Enough link, then the streamed brief.
- Canvas stays interactive during the interview.
- Header: Projects sheet (list / create / rename), model dropdown, key dialog.

## Scene change handling

`sceneHash` = SHA-256 of the **serializer output**, so cosmetic nudges within the same coarse grid cell or style changes do not count as a change; anything that alters what the model would read does. Each interview pins `sceneHash` at its first turn. If the scene hash changes mid-interview or after a brief exists, show a banner: **Drawing changed — restart with new drawing / keep going**. The interview is always a pure function of one snapshot. An accepted agent edit (v1.1) becomes the new baseline without a restart.

## Data model (Convex)

```
projects   { ownerId, name, sceneFileId, pngFileId, sceneHash, updatedAt }
interviews { projectId, sceneHash, graph, pngFileId, model, turns: Turn[], status, lastError? }
briefs     { interviewId, target, text, status }
```

Scenes and PNGs go in file storage (docs are capped at 1 MB). Turns live as an array on the interview doc; split into a table only if restart-with-context lands.

- **Projects:** `/` with no `?p=` opens the most-recent project (creating one if none).
- **Autosave:** `onChange` → ignore if no element `version` changed → debounce ~1.5 s idle (max ~10 s) → upload scene JSON to file storage → mutation swaps `sceneFileId`/`sceneHash` and deletes the old file. Every debounced tick also mirrors the scene to `localStorage` so reload is instant and a failed upload loses nothing. PNGs are exported only on Reframe.
- **PNG export:** `exportToBlob`, scaled so the long edge ≤ 1568 px (Anthropic downscales beyond that), light theme + white background regardless of canvas theme, `exportPadding` ~32. Action loads it via `ctx.storage.get` → base64 image part.
- **Interviews per project:** append-only. On load the panel shows the latest interview (+ brief) if its `sceneHash` matches the current scene, else the idle Reframe state. Reframe on an unfinished interview with the same hash focuses it; a different hash creates a new one (after the banner). No history UI in v1.

## Auth

- On first load, `signIn.anonymous()`. Every Convex row has an owner from the start.
- Sign in with GitHub / Google upgrades the account; `onLinkAccount` reassigns `ownerId` on the anonymous user's projects to the new user. Enables cross-device.
- Auth is optional from the user's point of view; there is no logged-out code path.

## Evals

- `fixtures/`: 5–10 `.excalidraw` files (login screen, 3-tier architecture, checkout flow, ambiguous scribble, empty canvas).
- Per fixture, a rubric: must ask about X, must not ask about Y, must cite element IDs, must finish within N turns.
- `scripts/eval.ts` (tsx) imports `lib/llm/*` directly — no Convex deployment involved. A Haiku 4.5 "simulated user" answers from a hidden per-fixture intent note; Sonnet 5 grades against the rubric. Run on every prompt change.
- Track the **"something else" rate** from day one — it is the primary quality metric for the interviewer.
- Later: opt-in recording of real sessions as new fixtures.

## Scope

| #   | Piece                                                                                             | Status |
| --- | ------------------------------------------------------------------------------------------------- | ------ |
| 1   | Excalidraw canvas, autosave to Convex project                                                     | v1     |
| 2   | Serializer                                                                                        | v1     |
| 3   | PNG export → Convex storage                                                                       | v1     |
| 4   | Interview action (`question \| done`), options + "something else", model-decided end + Enough link | v1     |
| 5   | Element highlighting per question                                                                 | v1     |
| 6   | Brief generation, streamed, fixed skeleton + appendix, copy                                       | v1     |
| 7   | Better Auth (anonymous + GitHub/Google), BYOK key, model dropdown                                 | v1     |
| 8   | Scene-changed banner → restart                                                                    | v1     |
| 9   | Fixture evals + serializer unit tests                                                             | v1     |
| 10  | Agent `edit` turn with Accept / Undo                                                              | v1.1   |
| 11  | Restart carrying previous answers as context                                                      | v1.1   |
| 12  | Multiple briefs per interview (regenerate, per-target)                                            | v1.1   |
| 13  | OpenAI / Gemini providers                                                                         | later  |
| 14  | Public share links                                                                                | later  |

### Agent edits (v1.1)

- Turn kind `edit` with constrained ops: `add(skeleton)`, `update(id, patch)`, `connect(from, to)`, `delete(id)`. No raw element JSON.
- Applied via `convertToExcalidrawElements` + `excalidrawAPI.updateScene({ elements, captureUpdate })` so Ctrl+Z works.
- Apply immediately, select + scroll to the changed elements, then **Accept / Undo** in the panel.
- Only in response to something the user said (or as an option on a question) — never unprompted.

## Build order (v1)

1. `lib/serializer` + `fixtures/` + Vitest. ✅
2. Convex + anonymous auth + `?p=` project autosave + Excalidraw mount.
3. `lib/llm/interview` + action + panel (options, "something else", Enough).
4. Brief action + reactive streaming + copy.
5. Highlighting, scene-changed banner, model dropdown, key dialog.
6. `scripts/eval.ts`.
7. GitHub/Google upgrade + Vercel deploy.

## Open items (decide when reached)

- What "something else" does when the user's text implies a redraw before agent edits exist (v1: carry the text forward as an answer).
