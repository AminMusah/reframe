import type { LibraryPersistenceAdapter } from "@excalidraw/excalidraw/data/library"

const KEY = "reframe:library"

/** Excalidraw's shape library, kept in this browser (it is not per drawing). */
export const libraryAdapter: LibraryPersistenceAdapter = {
  load() {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as { libraryItems: never }) : null
    } catch {
      return null
    }
  },
  save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data))
    } catch {
      // Storage full or unavailable; the in-memory library still works.
    }
  },
}
