export type Provider = "anthropic" | "openai" | "google" | "openrouter"

export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  openrouter: "OpenRouter",
}

export const MODELS = [
  {
    id: "claude-fable-5-1",
    label: "Fable 5.1",
    provider: "anthropic",
    vision: true,
    note: "Most capable, slowest",
  },
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    provider: "anthropic",
    vision: true,
    note: "Balanced — the default",
  },
  {
    id: "claude-opus-5",
    label: "Opus 5",
    provider: "anthropic",
    vision: true,
    note: "Strong",
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    provider: "anthropic",
    vision: true,
    note: "Fast and cheap",
  },
  {
    id: "gpt-6-astra",
    label: "GPT-6 Astra",
    provider: "openai",
    vision: true,
    note: "Most capable, slowest",
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    provider: "openai",
    vision: true,
    note: "Balanced — the default",
  },
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    provider: "openai",
    vision: true,
    note: "Strong",
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    provider: "openai",
    vision: true,
    note: "Fast and cheap",
  },
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    provider: "google",
    vision: true,
    note: "Fast — the default",
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    provider: "google",
    vision: true,
    note: "Strong",
  },
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    provider: "google",
    vision: true,
    note: "Fastest and cheapest",
  },
  {
    id: "anthropic/claude-fable-5.1",
    label: "Fable 5.1 (OpenRouter)",
    provider: "openrouter",
    vision: true,
    note: "Most capable, slowest",
  },
  {
    id: "openai/gpt-6-astra",
    label: "GPT-6 Astra (OpenRouter)",
    provider: "openrouter",
    vision: true,
    note: "Most capable, slowest",
  },
  {
    id: "anthropic/claude-sonnet-5",
    label: "Sonnet 5 (OpenRouter)",
    provider: "openrouter",
    vision: true,
    note: "Balanced — the default",
  },
  {
    id: "google/gemini-3.8-flash",
    label: "Gemini 3.8 Flash (OpenRouter)",
    provider: "openrouter",
    vision: true,
    note: "Fast",
  },
  {
    id: "openai/gpt-5.6-terra",
    label: "GPT-5.6 Terra (OpenRouter)",
    provider: "openrouter",
    vision: true,
    note: "Balanced",
  },
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Haiku 4.5 (OpenRouter)",
    provider: "openrouter",
    vision: true,
    note: "Fast and cheap",
  },
] as const satisfies readonly {
  id: string
  label: string
  provider: Provider
  /** Whether the PNG of the drawing can be sent; text-only models get the graph alone. */
  vision: boolean
  /** One-line hint shown in the model picker. */
  note?: string
}[]

export type ModelId = (typeof MODELS)[number]["id"]

export const DEFAULT_MODEL: Record<Provider, ModelId> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5.6-terra",
  google: "gemini-3.8-flash",
  openrouter: "anthropic/claude-sonnet-5",
}

export function isModelId(value: string): value is ModelId {
  return MODELS.some((m) => m.id === value)
}

export function modelInfo(model: ModelId) {
  return MODELS.find((m) => m.id === model)!
}

export function providerOf(model: ModelId): Provider {
  return modelInfo(model).provider
}

/** BYOK: the key's prefix says which provider it belongs to. */
export function providerForKey(apiKey: string): Provider {
  if (apiKey.startsWith("sk-ant-")) return "anthropic"
  if (apiKey.startsWith("sk-or-")) return "openrouter"
  // Google AI Studio keys come as AIza… (classic) or AQ.… (newer).
  if (apiKey.startsWith("AIza") || apiKey.startsWith("AQ.")) return "google"
  return "openai"
}

export function modelsFor(provider: Provider) {
  return MODELS.filter((m) => m.provider === provider)
}
