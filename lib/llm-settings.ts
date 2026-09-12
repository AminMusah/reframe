"use client"

import * as React from "react"

import { DEFAULT_MODEL, isModelId, type ModelId } from "@/lib/llm/models"

// BYOK: the key lives in localStorage only and is sent per request to the
// Convex action, which never stores it (see DESIGN.md).
const KEY = "reframe:anthropic-key"
const MODEL = "reframe:model"

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  window.addEventListener("storage", l)
  return () => {
    listeners.delete(l)
    window.removeEventListener("storage", l)
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Private mode: settings just won't persist.
  }
  notify()
}

export function useApiKey(): [string | null, (key: string | null) => void] {
  const key = React.useSyncExternalStore(
    subscribe,
    () => read(KEY),
    () => null
  )
  return [key, (value) => write(KEY, value?.trim() || null)]
}

export function useModel(): [ModelId, (model: ModelId) => void] {
  const stored = React.useSyncExternalStore(
    subscribe,
    () => read(MODEL),
    () => null
  )
  const model = stored && isModelId(stored) ? stored : DEFAULT_MODEL
  return [model, (value) => write(MODEL, value)]
}
