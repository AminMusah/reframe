export type Provider = "anthropic" | "openai"

export const MODELS = [
  { id: "claude-sonnet-5", label: "Sonnet 5", provider: "anthropic" },
  { id: "claude-opus-5", label: "Opus 5", provider: "anthropic" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", provider: "anthropic" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", provider: "openai" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "openai" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "openai" },
] as const satisfies readonly {
  id: string
  label: string
  provider: Provider
}[]

export type ModelId = (typeof MODELS)[number]["id"]

export const DEFAULT_MODEL: Record<Provider, ModelId> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5.6-terra",
}

export function isModelId(value: string): value is ModelId {
  return MODELS.some((m) => m.id === value)
}

export function providerOf(model: ModelId): Provider {
  return MODELS.find((m) => m.id === model)!.provider
}

/** BYOK: the key's prefix says which provider it belongs to. */
export function providerForKey(apiKey: string): Provider {
  return apiKey.startsWith("sk-ant-") ? "anthropic" : "openai"
}

export function modelsFor(provider: Provider) {
  return MODELS.filter((m) => m.provider === provider)
}
