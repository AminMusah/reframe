/**
 * localStorage mirror of a project's scene. Written on every autosave tick so a
 * reload is instant and a failed upload loses nothing; `dirty` stays true until
 * Convex has confirmed the upload.
 */
export type SceneMirror = {
  json: string
  sceneHash: string
  dirty: boolean
  savedAt: number
}

const key = (projectId: string) => `reframe:scene:${projectId}`

export function readMirror(projectId: string): SceneMirror | null {
  try {
    const raw = localStorage.getItem(key(projectId))
    return raw ? (JSON.parse(raw) as SceneMirror) : null
  } catch {
    return null
  }
}

export function writeMirror(projectId: string, mirror: SceneMirror): void {
  try {
    localStorage.setItem(key(projectId), JSON.stringify(mirror))
  } catch {
    // Quota or private mode: the server copy is the fallback.
  }
}

export function markMirrorClean(projectId: string): void {
  const mirror = readMirror(projectId)
  if (mirror?.dirty) writeMirror(projectId, { ...mirror, dirty: false })
}
