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
| LLM       | Vercel AI SDK v7. Providers: Anthropic (`sk-ant-`), OpenAI (`sk-`), OpenRouter (`sk-or-`), Google (`AIza`/`AQ.`) — inferred from the key prefix. Dropdown per provider (`lib/llm/models.ts`): Sonnet 5 / Opus 5 / Haiku 4.5; GPT-5.6 Terra / Sol / Luna; Gemini 3.8 Flash / 3.1 Pro / 3.5 Flash Lite; via OpenRouter Sonnet 5 / Gemini 3.8 Flash / Terra / Haiku 4.5. Every listed model must take images. Choice remembered in `localStorage`, pinned to `interviews.model` at Reframe; a model from the wrong provider for the key falls back to that provider's default (`lib/llm/provider.ts`). The model-facing turn schema is one flat object validated into the `question|edit|done` union afterwards, because providers disagree about top-level unions/oneOf. **Groq was tried and dropped** (2026-09-12): its catalogue has no vision models, and a text-only interviewer scored 2/4 must-ask where Sonnet scores 4/4; re-add only when it hosts a vision model. Listing rule: a model earns a dropdown slot by passing the eval (≥ 13/16 must-ask over 3 reps, no fixture over its turn limit); only Sonnet 5 has numbers so far.                                                  |
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
- Each question cites `elementIds`; the client selects them (`updateScene` with `CaptureUpdateAction.NEVER`, so no undo entry) and calls `setViewport({ target, fit: "scale-down", animation: true })` — this Excalidraw build has no `scrollToContent`. Ids the model returns are validated against the graph; unknown ones are dropped.
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

Copy button. Targets (Generic / Claude Code / Cursor) differ only in a framing note appended to the brief prompt; the six sections are identical. One brief per (interview, target); Regenerate inserts a new row, the newest wins. The generic brief auto-starts; others generate on demand.

## Vocabulary (what the author sees)

Four nouns, one verb. Code and model prompts keep the older internal names in parentheses; only the UI copy changed.

| Author sees | Meaning | In code |
|---|---|---|
| **Drawing** | one Excalidraw canvas with its history | `projects` table, `projectId` |
| **Interview** | the one-question-at-a-time Q&A about a drawing | `interviews` |
| **Prompt** | the Markdown the author pastes into a coding agent | `briefs`, `generateBrief`, `BriefView` |
| **Generate prompt** | the verb / the panel trigger (top-right) | Excalidraw `Sidebar.Trigger name="reframe"` |
| Reframe | the product name — never a button label | — |

**One prompt for every agent** (decided 2026-09-13). The per-target variants (Generic / Claude Code / Cursor) differed by three lines of house rules, so they were folded into the standing instructions every prompt ends with: follow the repo's agent-instructions file (CLAUDE.md / AGENTS.md / .cursor/rules), run existing tests and linters, work in small steps; ask before work that depends on an open question, or state the assumption and continue if asking is impossible (Codex). `briefs.target` stays in the schema as a legacy optional field.

## UI

- **One design language.** Excalidraw's chrome (toolbar, ☰ menu, properties island, dialogs, zoom) is themed through its CSS variables, every one of which points at our shadcn tokens (`app/globals.css` → "Excalidraw wears our tokens"): font, surfaces, borders, radius, shadows, and a neutral accent in place of the purple. Change the tokens in `:root` / `.dark` and the editor follows. Excalidraw's help button and dialog are hidden; `components/help-dialog.tsx` (☰ → Keyboard shortcuts, `?`) lists only the shortcuts that matter here. "Save to…" (the `.excalidraw` JSON export) is not offered; "Export image…" is. "Diagram from Mermaid…" (☰) opens the Mermaid tab of Excalidraw's TTD dialog via `appState.openDialog`, reworded through CSS; the AI tab is off (`aiEnabled={false}`) and the toolbar's Web Embed / Mermaid entries are hidden. Rule: never rebuild Excalidraw's panels — theme them.
- **Everything floats.** No drawers: the Drawings list is a dialog; the interview panel, Excalidraw's search and its shape library are undocked sidebars styled as inset cards (`defaultSidebarDockedPreference: false`). Any of them can be pinned.
- **Shape library** works: `useHandleLibrary` with a localStorage adapter (`lib/library-store.ts`) installs libraries arriving via `#addLibrary` from libraries.excalidraw.com, and `libraryReturnUrl` brings the author back to the same drawing. Opened from ☰ → Shape library (Excalidraw's own top-right trigger stays hidden).
- **The canvas is the whole window** (v1.3). There is no app header. Everything else lives in Excalidraw's own slots (`components/canvas/chrome.tsx`):
  - Main menu (☰): project group (Projects…, Rename, Delete project…), Excalidraw's export/find/clear, Model & API key, Dark/Light mode, Sign in/out, Help.
  - Top-right: the drawing's name (opens the Drawings sheet) and the **Generate prompt** trigger for the panel. While the panel is closed and an interview is underway the trigger carries a badge ("Question 4", or "Needs you" on error); while it is open it reads as pressed.
  - Welcome screen on an empty canvas: wordmark, one-line pitch, *Load an example drawing*, *How it works* (opens the panel), hints pointing at the toolbar and menu.
- **The interview panel is an Excalidraw `Sidebar`** (`name="reframe"`, 420 px, floating over the canvas by default as an inset card; the 📌 in its header docks it, remembered in `localStorage`). Docked, Excalidraw shifts its UI and `setViewport({offsets:{ui:true}})` keeps cited elements out from under it; on narrow screens Excalidraw overlays it instead. It opens on its own when a project has an interview underway.
- Panel states: empty (Draw → Answer → Paste, "usually 6–10 questions") with the key form as its footer until a key exists; "Start the interview"; the current question; the prompt with a sticky Copy prompt / Write it again / Interview again bar.
- Canvas stays interactive during the interview. Cited elements are selected, but the shape-properties island stays hidden until the author touches the canvas (`data-highlighting`), and the viewport only moves when they are off-screen.
- Projects auto-name from the drawing's largest free-standing text while still "Untitled" (`lib/scene-title.ts`, applied in `saveScene`). Deleting a project cascades to its files, interviews and briefs.
- Any earlier answer can be changed: *Change* on a transcript line re-asks that question; on send, `interviews.rewind` drops that answer and everything after it (briefs included), the client rebases to the current canvas and answers again.
- From question 5 on, "That's enough — write the brief" is a real button, not a link.

### Design pass (v1.2)

The canvas is the hero; the panel is one calm conversation. Rules that came out of the pass:

- **One thing at a time.** Answered pairs collapse behind an "N answered · Show" toggle (also once the interview is done, so the brief leads). The current question is the only large text in the panel, numbered ("Question 3") so the author feels progress without a cap.
- **Options are a numbered list** answerable with keys 1–5 (ignored while typing in any field). "Something else…" is a link that opens the textarea on demand; the Enough link stays visible in both modes.
- **Drawing changes are a quiet pill** above the question (pencil icon, one line, Undo), not a card. The sketch card keeps its Keep it / Undo pair because it is destructive.
- **Empty state** explains Draw → Answer → Paste; the key form is the panel's first screen when no key is set.
- **Brief is rendered Markdown** (`react-markdown`, plain element styles in `globals.css`, no typography plugin) inside a card with a segmented Generic / Claude Code / Cursor switch, a word count, Regenerate and a Copy → ✓ Copied button. Copy still copies the raw Markdown.
- **Header**: wordmark + project name as a breadcrumb; save state is a coloured dot that fades in only when there is something to say.
- **Motion** (`globals.css`): every `[data-slot=button]` and `.pressable` scales to 0.97 on press over 160 ms with a strong ease-out; new cards use `.enter` (`@starting-style`, 6 px rise, 200 ms) and option lists `.enter-stagger` (40 ms steps); the streaming caret is a blinking bar. Transform/opacity only, nothing over 300 ms, keyboard answers do not animate, and `prefers-reduced-motion` disables all of it.

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
- **Restart with context:** any restart from an existing interview (banner, or "Interview again") passes `priorInterviewId`; the action prepends the earlier graph + transcript to the first message and tells the model not to re-ask what was settled.
- **Interviews per project:** append-only. On load the panel shows the latest interview (+ brief) if its `sceneHash` matches the current scene, else the idle Reframe state. Reframe on an unfinished interview with the same hash focuses it; a different hash creates a new one (after the banner). No history UI in v1.

## Auth

- On first load, `signIn.anonymous()`. Every Convex row has an owner from the start.
- Sign in with GitHub / Google upgrades the account; `onLinkAccount` reassigns `ownerId` on the anonymous user's projects to the new user. Enables cross-device.
- Auth is optional from the user's point of view; there is no logged-out code path.

## Evals

- `fixtures/`: 5–10 `.excalidraw` files (login screen, 3-tier architecture, checkout flow, ambiguous scribble, empty canvas).
- Per fixture, a rubric: must ask about X, must not ask about Y, must cite element IDs, must finish within N turns.
- `scripts/eval.ts` (`pnpm eval [fixture] [--brief]`) imports `lib/llm/*` directly — no Convex deployment involved. Each `fixtures/<name>.eval.json` holds a hidden `intent` note and a `rubric` (`mustAsk`, `mustNotAsk`, `maxTurns`). A Haiku 4.5 "simulated user" answers from the intent (picking an option, writing "something else", or saying enough); Sonnet 5 grades the transcript. Text-only: the interviewer gets the graph but no PNG, since Node cannot render Excalidraw. Results land in `.eval/` (git-ignored). Run on every prompt change.
- Hill-climb log (Sonnet 5, 4 fixtures × 3 reps, `pnpm eval --reps 3`). Baseline: must-ask 15/16 ± 0, total turns 33.7 ± 1.5, 1.7 fixtures over their limit per rep. Round 1 (stopping discipline: per-turn "could an engineer build this now?", no unmotivated stack/auth/hosting questions, one question per topic, batch similar marks): turns 23.3 ± 1.5, 0 over limit, must-ask 14.3 ± 1.2 — kept. Typical remaining miss: scope questions being deferred to Open questions instead of asked.
- Anthropic and OpenAI credit ran out mid-loop, so rounds 2–3 were measured on **GPT-5.6 Terra** (Luna as author, Terra as judge) as an A/B against the round-1 prompt on the same model. Arm A (round 1): must-ask 11.7 ± 0.6, turns 27.7 ± 1.5. Round 2 ("always settle scope"): 12.3 ± 1.5, turns 29.3 — login-screen fixed (4/4 ×3) but three-tier fell to 1/4 because the model fished for product scope instead of asking about drawn elements; rejected. Round 3 (every ambiguous drawn element first, then one bounded scope question, no product-scope fishing): **12.7 ± 0.6**, turns 29.0 ± 1.7; three-tier now asks Redis + auth every rep — kept, **provisional until re-measured on Sonnet 5**. Remaining Terra misses: "which cloud provider" (it asks managed-vs-self-hosted instead) and the schema-scope question. Round 4 (edits only on an explicit request or a chosen "add it for me" option; clarifying answers are not requests; replacements delete what they replace): edits per pass **5.0 → 0.3**, must-ask 13.3 ± 2.1, turns 30.0 ± 6.1 (one three-tier run hit the runner's 12-turn cap) — kept. Loop paused here (OpenAI credit ~spent); next: re-measure rounds 3–4 on Sonnet 5, then look at turn variance.
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
| 10  | Agent `edit` turn with Accept / Undo                                                              | ✅ v1.1 |
| 11  | Restart carrying previous answers as context                                                      | ✅ v1.1 |
| 12  | Multiple briefs per interview (regenerate, per-target)                                            | ✅ v1.1 |
| 13  | OpenAI provider (Gemini later)                                                                    | ✅      |
| 14  | Public share links                                                                                | later  |

### Agent edits (v1.1) — built; auto-applied since 2026-09-13

**The drawing is the living spec.** Whenever an answer changes what the drawing states (a label, a connection, whether a component exists, where a flow goes), the interviewer attaches `ops` + a one-line `change` note to its **next question**. The client applies them the moment the question arrives, pins the interview to the new drawing (hash, graph, PNG — `interviews.rebase` with the turn index), and shows "✎ change · Undo" above the question. Undo restores the snapshot and pins back; either way the outcome travels with the next answer ("(Your drawing change was applied. The drawing is now: …)") so the model's ids stay right. Standalone `edit` turns (explicit asks with nothing to ask back) apply the same way and the client answers for the author automatically. Only **sketches** keep Accept / Undo, because they replace things. This replaced the "edits only on explicit request" rule from eval round 4: that rule cut Terra's tidy-up noise but also stopped the legitimate case — the author saying "Firebase only does storage" and the drawing still claiming auth. The prompt now draws the line at "changes a stated fact" vs "adds detail the drawing never claimed"; tidying and annotations remain off-limits.

Deleting a node deletes the arrows bound to it (and their labels); a one-ended arrow is junk in a diagram.



- Turn kind `edit` = `{ text, ops }`, 1–6 ops: `add { ref, type: rectangle|ellipse|diamond|text, label, place: { relative: right|left|above|below|inside, of } }`, `connect { from, to, label, bidirectional }`, `update { id, label }`, `delete { id }`. Ids are graph ids or refs added earlier in the same edit; the module drops ops with unknown ids and rejects an edit with none left.
- `lib/edits/apply.ts` (client, pure over `(elements, ops, idMap, boxes, convert)`): new shapes via `convertToExcalidrawElements` with ids we pick; placement is next to the anchor, stepping outward until it overlaps nothing of similar size; arrows are bound by hand (`startBinding`/`endBinding` + `boundElements`) because the converter only binds within one call; `update` rebuilds the shape under the same id so bindings survive; `delete` also unbinds arrows and detaches frame children. The serializer exposes `boxes` (pixel boxes by short id) for this.
- Panel applies on arrival with `CaptureUpdateAction.IMMEDIATELY` (so Ctrl+Z works too), selects + scrolls to the changed elements, shows the ops in words with **Accept / Undo**. Accept re-serializes, re-exports the PNG, and `interviews.rebase`s hash/graph/PNG so no banner appears, then answers "Applied. The drawing is now: <graph>"; Undo restores the pre-edit snapshot and answers "Undone". The decision is kept in state until the next turn so the apply effect cannot fire twice. The banner is suppressed while an edit is pending.
- Prompt: edits only when the author's answer implies a drawing change; never unprompted; "Add it to the drawing for me" is a legitimate option to offer.

## Build order (v1)

1. `lib/serializer` + `fixtures/` + Vitest. ✅
2. Convex + anonymous auth + `?p=` project autosave + Excalidraw mount. ✅
3. `lib/llm/interview` + action + panel (options, "something else", Enough). ✅
4. Brief action + reactive streaming + copy. ✅
5. Highlighting, scene-changed banner, model dropdown, key dialog. ✅
6. `scripts/eval.ts`. ✅
7. GitHub/Google upgrade + Vercel deploy. ✅ (code + README; OAuth apps and the Vercel project are set up by hand)

### Sketch from reference (v1.2) — built

The canvas is the input, so the interviewer handles this itself — but it asks first: when the canvas is essentially a picture of a diagram, its first question offers "Redraw it as editable shapes" / "Interview me from the picture as it is"; only when the author picks the redraw (or asks in their own words) does the model return a **`sketch` turn** `{ text, instruction, mode: add|replace }` instead of a question. The client then, behind the scenes: exports the canvas PNG → `sketchActions.fromReference` (Node, stores nothing, deletes the PNG after reading) asks a vision model for `{ canvas: {w,h}, nodes: [{ref,type,label,x,y,w,h}], arrows: [{from,to,label,bidirectional}] }` on a grid whose longer side is 100 (`lib/llm/sketch.ts`) → `lib/edits/sketch-apply.ts` lays it out and builds shapes via `convertToExcalidrawElements` plus hand-bound arrows (`buildArrow`, shared with edits). The card shows progress, then the same **Accept / Undo** as an edit; Accept rebases the interview onto the sketched drawing. `replace` deletes non-image, non-frame elements and places the sketch under the pictures; `add` goes below everything.

Layout is corrected client-side because the model cannot be trusted with it: every box is at least wide/tall enough for its label (~11 px per character, 28 px per line, plus padding); the whole sketch (positions and sizes together, so containers keep containing) is scaled up until no two boxes are within 32 px — or, for boxes joined by a labelled arrow, within the label's width — capped at 2×; container-ish pairs (much larger box holding ≥ 50 % of the smaller) are not crowding. Arrows sharing a pair of boxes (one each way) attach at offset points so they run side by side. Sketches are ≥ 1100 px wide. Text nodes that duplicate an arrow's label are dropped, and the sketch prompt keeps arrow labels to a few words. There is no manual "sketch" box in the UI (tried, removed: it made the author do the deciding).

## Open items (decide when reached)

- What "something else" does when the user's text implies a redraw: v1.1 edits handle small changes; "reproduce this picture" goes to Sketch from reference (the interviewer says so).
