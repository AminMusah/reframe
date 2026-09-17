/** Names shared by the canvas chrome and the interview panel (no Excalidraw import here: the panel is server-rendered). */
export const PANEL = "reframe"
/** Fired by ⌘/Ctrl+Enter: the panel opens and, when idle, starts the interview. */
export const GENERATE_EVENT = "reframe:generate"

// The panel is mounted only while its sidebar is open, so a shortcut pressed
// with it closed cannot be heard there. The chrome opens the panel and leaves
// this note; the panel reads it on mount.
let requestedAt = 0
export function requestGenerate() {
  requestedAt = Date.now()
  window.dispatchEvent(new CustomEvent(GENERATE_EVENT))
}
/** True once, if a request was made in the last few seconds. */
export function consumeGenerate(): boolean {
  const fresh = Date.now() - requestedAt < 5000
  requestedAt = 0
  return fresh
}
