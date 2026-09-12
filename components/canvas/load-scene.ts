import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types"

import { readMirror } from "@/lib/scene-store"

type ProjectScene = { sceneHash?: string; sceneUrl: string | null }

/**
 * Pick the freshest copy of a scene: the local mirror when it holds unsaved
 * work or matches the server hash, otherwise the server file.
 */
export async function loadScene(
  projectId: string,
  project: ProjectScene
): Promise<{ data: ExcalidrawInitialDataState | null; dirty: boolean }> {
  const mirror = readMirror(projectId)
  if (mirror && (mirror.dirty || mirror.sceneHash === project.sceneHash)) {
    return { data: parse(mirror.json), dirty: mirror.dirty }
  }
  if (project.sceneUrl) {
    try {
      const res = await fetch(project.sceneUrl)
      if (res.ok) return { data: parse(await res.text()), dirty: false }
    } catch {
      // Offline: fall through to whatever the mirror has.
    }
  }
  return { data: mirror ? parse(mirror.json) : null, dirty: false }
}

function parse(json: string): ExcalidrawInitialDataState | null {
  try {
    const { elements, appState, files } = JSON.parse(json)
    // Only restore what should survive a reload; the rest of AppState is session state.
    const { viewBackgroundColor, scrollX, scrollY, zoom } = appState ?? {}
    return {
      elements,
      appState: { viewBackgroundColor, scrollX, scrollY, zoom },
      files,
    }
  } catch {
    return null
  }
}
