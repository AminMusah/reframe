export const MODELS = [
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
] as const

export type ModelId = (typeof MODELS)[number]["id"]

export const DEFAULT_MODEL: ModelId = "claude-sonnet-5"

export function isModelId(value: string): value is ModelId {
  return MODELS.some((m) => m.id === value)
}
