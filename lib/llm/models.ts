export type Provider = "anthropic" | "openai" | "google" | "groq" | "openrouter"

export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  groq: "Groq",
  openrouter: "OpenRouter",
}

export const MODELS = [
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    provider: "anthropic",
    vision: true,
  },
  { id: "claude-opus-5", label: "Opus 5", provider: "anthropic", vision: true },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    provider: "anthropic",
    vision: true,
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    provider: "openai",
    vision: true,
  },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "openai", vision: true },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    provider: "openai",
    vision: true,
  },
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    provider: "google",
    vision: true,
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    provider: "google",
    vision: true,
  },
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    provider: "google",
    vision: true,
  },
  // Groq serves text-only models at the moment; the interviewer gets the graph alone.
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B (no image)",
    provider: "groq",
    vision: false,
  },
  {
    id: "qwen/qwen3.8-27b",
    label: "Qwen 3.8 27B (no image)",
    provider: "groq",
    vision: false,
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B (no image)",
    provider: "groq",
    vision: false,
  },
  {
    id: "anthropic/claude-sonnet-5",
    label: "Sonnet 5 (OpenRouter)",
    provider: "openrouter",
    vision: true,
  },
  {
    id: "google/gemini-3.8-flash",
    label: "Gemini 3.8 Flash (OpenRouter)",
    provider: "openrouter",
    vision: true,
  },
  {
    id: "openai/gpt-5.6-terra",
    label: "GPT-5.6 Terra (OpenRouter)",
    provider: "openrouter",
    vision: true,
  },
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Haiku 4.5 (OpenRouter)",
    provider: "openrouter",
    vision: true,
  },
] as const satisfies readonly {
  id: string
  label: string
  provider: Provider
  /** Whether the PNG of the drawing can be sent; text-only models get the graph alone. */
  vision: boolean
}[]

export type ModelId = (typeof MODELS)[number]["id"]

export const DEFAULT_MODEL: Record<Provider, ModelId> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5.6-terra",
  google: "gemini-3.8-flash",
  groq: "openai/gpt-oss-120b",
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
  if (apiKey.startsWith("gsk_")) return "groq"
  if (apiKey.startsWith("AIza")) return "google"
  return "openai"
}

export function modelsFor(provider: Provider) {
  return MODELS.filter((m) => m.provider === provider)
}
